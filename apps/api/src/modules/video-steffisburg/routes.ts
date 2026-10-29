import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { readFile } from "node:fs/promises";
import { isIP } from "node:net";
import { randomBytes, randomUUID } from "node:crypto";
import type { ModuleServerContext } from "../module-sdk.js";
import { BmdConverterWorker } from "./bmd-converter-worker.js";
import { addYoutubeVideoToPlaylist, createYoutubeBroadcast, decryptYoutubeToken, deleteYoutubeBroadcast, encryptYoutubeToken, ensureYoutubeTokenKey, exchangeYoutubeCode, refreshYoutubeAccessToken, setYoutubeVideoUnlisted, transitionYoutubeBroadcast, updateYoutubeBroadcast, youtubeApi, youtubeAuthorizationUrl, youtubeChannel, youtubeOAuthConfigured, youtubePlaylists } from "./youtube.js";

type VideoPermission = "video_basic" | "streaming_operator" | "stream_admin" | "routing_user" | "routing_admin";
const videoPostOperations = new Set(["command", "restart-site", "encoder-settings", "videohub-route", "videohub-presets"]);
const videoBodySchema = { type: "object", additionalProperties: true, maxProperties: 24 };
const deviceAddressBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["addresses"],
  properties: {
    addresses: {
      type: "array",
      minItems: 1,
      maxItems: 500,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["siteId", "targetType", "targetId", "ip"],
        properties: {
          siteId: { type: "string", minLength: 1, maxLength: 80 },
          targetType: { type: "string", enum: ["router", "encoder", "device"] },
          targetId: { type: "string", maxLength: 80 },
          ip: { type: "string", maxLength: 45 },
        },
      },
    },
  },
};
const youtubeClientSettingSchema = {
  body: {
    type: "object", additionalProperties: false, required: ["clientId"],
    properties: { clientId: { type: "string", maxLength: 512 }, clientSecret: { type: "string", maxLength: 512 } },
  },
};
type DeviceAddressTarget = "router" | "encoder" | "device";
type DeviceAddressEntry = { siteId: string; siteName: string; targetType: DeviceAddressTarget; targetId: string; targetName: string; ip: string };
type YoutubeBroadcast = {
  id?: string;
  snippet?: { title?: string; description?: string; scheduledStartTime?: string };
  status?: { privacyStatus?: "private" | "unlisted" | "public"; lifeCycleStatus?: string; recordingStatus?: string };
  statistics?: { concurrentViewers?: string | number };
  contentDetails?: { boundStreamId?: string; monitorStream?: { embedHtml?: string; enableMonitorStream?: boolean } };
};

function addressKey(entry: Pick<DeviceAddressEntry, "siteId" | "targetType" | "targetId">) {
  return `${entry.siteId}\u0000${entry.targetType}\u0000${entry.targetId}`;
}

function youtubeMonitorUrl(embedHtml?: string) {
  const source = embedHtml?.match(/\bsrc\s*=\s*["']([^"']+)["']/i)?.[1];
  if (!source) return null;
  try {
    const url = new URL(source, "https://www.youtube.com");
    if (!["www.youtube.com", "youtube.com", "www.youtube-nocookie.com"].includes(url.hostname) || !url.pathname.startsWith("/embed/")) return null;
    return url.toString();
  } catch { return null; }
}

export function registerModuleRoutes(app: FastifyInstance, context: ModuleServerContext) {
  const { pool, isDatabaseReady, resolveDepartmentId, validateMutation, getVideoWorker, realtime } = context;
  const converterWorkers = new Map<string, BmdConverterWorker>();
  const youtubeOAuthStates = new Map<string, { departmentId: string; userId: string; username: string; expiresAt: number }>();
  let statusMonitor: ReturnType<typeof setInterval> | undefined;
  let youtubeArchiveMonitor: ReturnType<typeof setInterval> | undefined;
  let statusMonitorRunning = false;
  let youtubeArchiveMonitorRunning = false;
  let previousStatus = "";
  app.addHook("onReady", async () => {
    await ensureYoutubeTokenKey();
    statusMonitor = setInterval(() => {
      if (statusMonitorRunning) return;
      statusMonitorRunning = true;
      void (async () => {
        const selectedDepartmentId = context.getDefaultDepartmentId();
        const worker = getVideoWorker();
        let snapshot: unknown = { available: false, worker: worker?.state ?? { state: "unavailable", error: "The Video module worker is unavailable." } };
        if (worker) {
          try { snapshot = await worker.request("status", {}, selectedDepartmentId, "realtime-monitor", 8_000); }
          catch (error) { snapshot = { available: false, worker: worker.state, error: error instanceof Error ? error.message : "Video status is unavailable." }; }
        }
        const currentStatus = JSON.stringify(snapshot, (key, value) => /(?:_at|timestamp|checkedAt|updatedAt)$/i.test(key) ? undefined : value);
        if (currentStatus !== previousStatus) {
          previousStatus = currentStatus;
          realtime.publish("module:video-steffisburg:status", selectedDepartmentId);
        }
      })().catch((error) => app.log.warn({ err: error }, "Video status monitor could not publish an update."))
        .finally(() => { statusMonitorRunning = false; });
    }, 5_000);
    statusMonitor.unref?.();
    const syncCompletedRecordings = () => {
      if (youtubeArchiveMonitorRunning) return;
      youtubeArchiveMonitorRunning = true;
      void ensureCompletedRecordingsAreUnlisted()
        .catch((error) => app.log.warn({ err: error }, "YouTube recording privacy sync failed."))
        .finally(() => { youtubeArchiveMonitorRunning = false; });
    };
    syncCompletedRecordings();
    youtubeArchiveMonitor = setInterval(syncCompletedRecordings, 60_000);
    youtubeArchiveMonitor.unref?.();
  });
  app.addHook("onClose", async () => { if (statusMonitor) clearInterval(statusMonitor); });
  app.addHook("onClose", async () => { if (youtubeArchiveMonitor) clearInterval(youtubeArchiveMonitor); });
  app.addHook("onClose", async () => { await Promise.all([...converterWorkers.values()].map((worker) => worker.close())); });

  async function activeVideoDepartment(request: FastifyRequest, reply: FastifyReply, permission: VideoPermission = "video_basic") {
    if (!isDatabaseReady() || !pool) {
      reply.code(503).send({ error: "The account database is unavailable." });
      return null;
    }
    const selectedId = await resolveDepartmentId(request, reply);
    if (!selectedId) return null;
    const result = await pool.query(
      `SELECT d.enabled_modules, m.role, m.video_permissions, m.module_permissions
         FROM departments d
         JOIN department_memberships m ON m.department_id = d.id
        WHERE d.id = $1 AND m.user_id = $2`,
      [selectedId, request.authenticatedUser?.id],
    );
    const access = result.rows[0];
    if (!access?.enabled_modules?.includes("video-steffisburg")) {
      reply.code(404).send({ error: "The Video module is not enabled for this site." });
      return null;
    }
    const grants = new Set<string>(access.module_permissions?.["video-steffisburg"] ?? access.module_permissions?.video ?? access.video_permissions ?? []);
    const hasGrant = permission === "video_basic"
      ? grants.size > 0
      : permission === "streaming_operator"
        ? grants.has("streaming_operator") || grants.has("stream_admin")
        : permission === "routing_user"
          ? grants.has("routing_user") || grants.has("routing_admin")
          : grants.has(permission);
    if (access.role !== "site_admin" && !hasGrant) {
      reply.code(403).send({ error: "Video module access is required." });
      return null;
    }
    return selectedId;
  }

  async function settingsDepartment(request: FastifyRequest, reply: FastifyReply) {
    if (request.authenticatedUser?.role !== "server_admin") {
      reply.code(403).send({ error: "Server administrator access is required." });
      return null;
    }
    if (!pool || !isDatabaseReady()) {
      reply.code(503).send({ error: "The account database is unavailable." });
      return null;
    }
    const selectedId = request.headers["x-department-id"];
    if (typeof selectedId !== "string" || !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(selectedId)) {
      reply.code(400).send({ error: "Choose a valid location." });
      return null;
    }
    const result = await pool.query("SELECT id FROM departments WHERE id=$1", [selectedId]);
    if (!result.rowCount) {
      reply.code(404).send({ error: "Location not found." });
      return null;
    }
    return selectedId;
  }

  async function youtubeOAuthSettings() {
    const result = await pool!.query<{ youtube_client_id: string; youtube_client_secret_encrypted: string | null }>("SELECT youtube_client_id, youtube_client_secret_encrypted FROM video_module_settings WHERE singleton=true");
    const row = result.rows[0];
    let clientSecret = "";
    if (row?.youtube_client_secret_encrypted && process.env.SMART_CHURCH_VIDEO_STEFFISBURG_YOUTUBE_TOKEN_KEY?.trim()) {
      try { clientSecret = decryptYoutubeToken(row.youtube_client_secret_encrypted); } catch { /* reported as incomplete OAuth configuration */ }
    }
    return {
      clientId: row?.youtube_client_id?.trim() ?? "",
      clientSecret,
      clientSecretConfigured: Boolean(row?.youtube_client_secret_encrypted),
    };
  }

  async function youtubeConnection(departmentId: string) {
    const result = await pool!.query<{ encrypted_refresh_token: string; channel_id: string; channel_title: string; oauth_client_id: string }>(
      "SELECT encrypted_refresh_token, channel_id, channel_title, oauth_client_id FROM video_youtube_connections WHERE department_id=$1",
      [departmentId],
    );
    return result.rows[0] ?? null;
  }

  async function youtubeAccessToken(departmentId: string) {
    const connection = await youtubeConnection(departmentId);
    if (!connection) throw new Error("Connect a YouTube channel before scheduling this stream.");
    const settings = await youtubeOAuthSettings();
    const oauthClientId = connection.oauth_client_id || settings.clientId;
    if (!youtubeOAuthConfigured(oauthClientId, settings.clientSecret)) throw new Error("Configure the YouTube client ID and client secret in Video module settings, plus its redirect URL and token key in the server environment.");
    return refreshYoutubeAccessToken(decryptYoutubeToken(connection.encrypted_refresh_token), oauthClientId, settings.clientSecret);
  }

  async function selectedYoutubePlaylist(departmentId: string, playlistId: string | null | undefined) {
    if (!playlistId) return null;
    const playlists = await youtubePlaylists(await youtubeAccessToken(departmentId));
    const playlist = playlists.find((item) => item.id === playlistId);
    if (!playlist) throw new Error("Select a playlist owned by the connected YouTube channel.");
    return playlist;
  }

  async function ensureCompletedRecordingsAreUnlisted() {
    if (!pool || !isDatabaseReady()) return;
    const pending = await pool.query<{ id: string; department_id: string; youtube_broadcast_id: string; youtube_playlist_id: string | null; youtube_playlist_added_at: Date | null }>(
      `SELECT id, department_id, youtube_broadcast_id, youtube_playlist_id, youtube_playlist_added_at
         FROM video_planned_streams
        WHERE youtube_broadcast_id IS NOT NULL
          AND youtube_status='scheduled'
          AND (scheduled_start_at < now() OR (youtube_playlist_id IS NOT NULL AND youtube_playlist_added_at IS NULL))
        ORDER BY scheduled_start_at
        LIMIT 50`,
    );
    const byDepartment = new Map<string, Array<{ id: string; broadcastId: string; playlistId: string | null; playlistAddedAt: Date | null }>>();
    for (const row of pending.rows) {
      const broadcasts = byDepartment.get(row.department_id) ?? [];
      broadcasts.push({ id: row.id, broadcastId: row.youtube_broadcast_id, playlistId: row.youtube_playlist_id, playlistAddedAt: row.youtube_playlist_added_at });
      byDepartment.set(row.department_id, broadcasts);
    }
    for (const [departmentId, broadcasts] of byDepartment) {
      try {
        const accessToken = await youtubeAccessToken(departmentId);
        for (let offset = 0; offset < broadcasts.length; offset += 50) {
          const batch = broadcasts.slice(offset, offset + 50);
          const response = await youtubeApi<{ items?: Array<{ id?: string; status?: { lifeCycleStatus?: string; recordingStatus?: string } }> }>(
            accessToken,
            `liveBroadcasts?part=id,status&id=${encodeURIComponent(batch.map((item) => item.broadcastId).join(","))}`,
          );
          for (const broadcast of response.items ?? []) {
            if (!broadcast.id) continue;
            const planned = batch.find((item) => item.broadcastId === broadcast.id);
            if (!planned) continue;
            if (planned.playlistId && !planned.playlistAddedAt) {
              try {
                await addYoutubeVideoToPlaylist(accessToken, planned.playlistId, broadcast.id);
                await pool.query("UPDATE video_planned_streams SET youtube_playlist_added_at=now(),updated_at=now() WHERE id=$1 AND youtube_playlist_added_at IS NULL", [planned.id]);
                planned.playlistAddedAt = new Date();
              } catch (error) {
                app.log.info({ err: error, departmentId, broadcastId: broadcast.id }, "YouTube playlist insertion is not ready yet; it will retry automatically.");
              }
            }
            if (broadcast.status?.lifeCycleStatus !== "complete" || broadcast.status.recordingStatus !== "recorded") continue;
            try {
              await setYoutubeVideoUnlisted(accessToken, broadcast.id);
              if (planned.playlistId) {
                await addYoutubeVideoToPlaylist(accessToken, planned.playlistId, broadcast.id);
                if (!planned.playlistAddedAt) await pool.query("UPDATE video_planned_streams SET youtube_playlist_added_at=now() WHERE id=$1", [planned.id]);
              }
              await pool.query(
                `UPDATE video_planned_streams
                    SET youtube_status='recorded_unlisted',privacy_status='unlisted',youtube_error=NULL,updated_at=now()
                  WHERE department_id=$1 AND youtube_broadcast_id=$2 AND youtube_status='scheduled'`,
                [departmentId, broadcast.id],
              );
            } catch (error) {
              app.log.warn({ err: error, departmentId, broadcastId: broadcast.id }, "Could not finish post-stream YouTube processing; it will retry automatically.");
            }
          }
        }
      } catch (error) {
        app.log.warn({ err: error, departmentId }, "Could not set completed YouTube recordings to unlisted; it will retry automatically.");
      }
    }
  }

  async function currentOrNextService(departmentId: string) {
    const result = await pool!.query<{
      id: string; title: string; event_date: string; start_time: string; end_time: string | null;
      description: string | null; positions: Array<{ name: string; contactId?: string }>;
      time_plan: Array<{ title: string; notes?: string }>; is_current: boolean;
      starts_at_epoch: string; source_system: string | null;
    }>(
      `SELECT e.id, e.title, e.event_date::text, to_char(e.start_time, 'HH24:MI') AS start_time,
              CASE WHEN e.end_time IS NULL THEN NULL ELSE to_char(e.end_time, 'HH24:MI') END AS end_time,
              e.description, e.positions, e.time_plan, e.source_system,
              ((e.event_date + e.start_time) <= (now() AT TIME ZONE d.time_zone)
                AND (e.event_date + COALESCE(e.end_time, e.start_time + interval '3 hours')) > (now() AT TIME ZONE d.time_zone)) AS is_current,
              (extract(epoch FROM ((e.event_date + e.start_time) AT TIME ZONE d.time_zone)) * 1000)::bigint::text AS starts_at_epoch
         FROM service_events e
         JOIN departments d ON d.id=e.department_id
        WHERE e.department_id=$1 AND e.kind='service'
          AND (e.event_date + COALESCE(e.end_time, e.start_time + interval '3 hours')) >= (now() AT TIME ZONE d.time_zone)
        ORDER BY CASE WHEN (e.event_date + e.start_time) <= (now() AT TIME ZONE d.time_zone)
                           AND (e.event_date + COALESCE(e.end_time, e.start_time + interval '3 hours')) > (now() AT TIME ZONE d.time_zone)
                      THEN 0 ELSE 1 END,
                 e.event_date, e.start_time, e.title
        LIMIT 1`,
      [departmentId],
    );
    const event = result.rows[0];
    if (!event) return null;
    const speakerPositions = (event.positions ?? []).filter((position) => /speaker|preach|predig|pastor|minister|sermon/i.test(position.name));
    const speakerIds = [...new Set(speakerPositions.flatMap((position) => position.contactId ? [position.contactId] : []))];
    const contacts = speakerIds.length
      ? await pool!.query<{ id: string; first_name: string; last_name: string }>("SELECT id, first_name, last_name FROM contacts WHERE department_id=$1 AND id=ANY($2::uuid[])", [departmentId, speakerIds])
      : { rows: [] as Array<{ id: string; first_name: string; last_name: string }> };
    const speakers = new Map(contacts.rows.map((contact) => [contact.id, `${contact.first_name} ${contact.last_name}`.trim()]));
    const speaker = speakerPositions.map((position) => position.contactId ? speakers.get(position.contactId) : "").filter(Boolean).join(", ");
    const themeItem = (event.time_plan ?? []).find((item) => /^(theme|thema)\b/i.test(item.title.trim()));
    const theme = themeItem ? (themeItem.notes?.trim() || themeItem.title.replace(/^(theme|thema)\s*:?\s*/i, "")) : (event.description ?? "").slice(0, 300);
    return {
      id: event.id, title: event.title, eventDate: event.event_date, startTime: event.start_time,
      ...(event.end_time ? { endTime: event.end_time } : {}), speaker, theme, isCurrent: event.is_current,
      source: event.source_system?.trim() || "local",
      startsAt: new Date(Number(event.starts_at_epoch)).toISOString(),
    };
  }

  async function previousAndFollowingServices(departmentId: string) {
    const result = await pool!.query<{
      relation: "previous" | "following"; id: string; title: string; event_date: string; start_time: string; end_time: string | null;
      description: string | null; positions: Array<{ name: string; contactId?: string }>;
      time_plan: Array<{ title: string; notes?: string }>; is_current: boolean;
      starts_at_epoch: string; source_system: string | null;
    }>(
      `WITH eligible AS (
         SELECT e.id, e.title, e.event_date::text AS event_date, to_char(e.start_time, 'HH24:MI') AS start_time,
                e.end_time, e.description, e.positions, e.time_plan, e.source_system,
                e.event_date AS sort_date, e.start_time AS sort_time,
                ((e.event_date + e.start_time) <= (now() AT TIME ZONE d.time_zone)
                  AND (e.event_date + COALESCE(e.end_time, e.start_time + interval '3 hours')) > (now() AT TIME ZONE d.time_zone)) AS is_current,
                (e.event_date + e.start_time) AS starts_local,
                (extract(epoch FROM ((e.event_date + e.start_time) AT TIME ZONE d.time_zone)) * 1000)::bigint::text AS starts_at_epoch
           FROM service_events e JOIN departments d ON d.id=e.department_id
          WHERE e.department_id=$1 AND e.kind='service'
       ), anchor AS (
         SELECT * FROM eligible
          WHERE is_current OR starts_local >= (SELECT now() AT TIME ZONE time_zone FROM departments WHERE id=$1)
          ORDER BY CASE WHEN is_current THEN 0 ELSE 1 END, sort_date, sort_time
          LIMIT 1
       ), previous_event AS (
         SELECT e.* FROM eligible e, anchor a
          WHERE (e.sort_date,e.sort_time) < (a.sort_date,a.sort_time)
          ORDER BY e.sort_date DESC,e.sort_time DESC LIMIT 1
       ), following_event AS (
         SELECT e.* FROM eligible e, anchor a
          WHERE (e.sort_date,e.sort_time) > (a.sort_date,a.sort_time)
          ORDER BY e.sort_date,e.sort_time LIMIT 1
       )
       SELECT 'previous'::text AS relation, p.* FROM previous_event p
       UNION ALL
       SELECT 'following'::text AS relation, f.* FROM following_event f`,
      [departmentId],
    );
    const eventRows = result.rows;
    const speakerPositions = eventRows.flatMap((event) => (event.positions ?? []).filter((position) => /speaker|preach|predig|pastor|minister|sermon/i.test(position.name)));
    const speakerIds = [...new Set(speakerPositions.flatMap((position) => position.contactId ? [position.contactId] : []))];
    const contacts = speakerIds.length
      ? await pool!.query<{ id: string; first_name: string; last_name: string }>("SELECT id, first_name, last_name FROM contacts WHERE department_id=$1 AND id=ANY($2::uuid[])", [departmentId, speakerIds])
      : { rows: [] as Array<{ id: string; first_name: string; last_name: string }> };
    const speakers = new Map(contacts.rows.map((contact) => [contact.id, `${contact.first_name} ${contact.last_name}`.trim()]));
    return eventRows.map((event) => {
      const positions = (event.positions ?? []).filter((position) => /speaker|preach|predig|pastor|minister|sermon/i.test(position.name));
      const speaker = positions.map((position) => position.contactId ? speakers.get(position.contactId) : "").filter(Boolean).join(", ");
      const themeItem = (event.time_plan ?? []).find((item) => /^(theme|thema)\b/i.test(item.title.trim()));
      const theme = themeItem ? (themeItem.notes?.trim() || themeItem.title.replace(/^(theme|thema)\s*:?\s*/i, "")) : (event.description ?? "").slice(0, 300);
      return {
        id: event.id, title: event.title, eventDate: event.event_date, startTime: event.start_time,
        ...(event.end_time ? { endTime: typeof event.end_time === "string" ? event.end_time.slice(0, 5) : event.end_time } : {}),
        speaker, theme, isCurrent: event.is_current, source: event.source_system?.trim() || "local",
        startsAt: new Date(Number(event.starts_at_epoch)).toISOString(), relation: event.relation,
      };
    });
  }

  async function scheduleYoutubeBroadcast(departmentId: string, stream: { title: string; description: string; scheduledStartAt: string; privacyStatus: "private" | "unlisted" | "public" }) {
    const accessToken = await youtubeAccessToken(departmentId);
    return createYoutubeBroadcast(accessToken, { title: stream.title, description: stream.description, scheduledStartTime: stream.scheduledStartAt, privacyStatus: stream.privacyStatus });
  }

  function youtubeServiceDescription(eventDate: string, eventTime: string) {
    const [year, month, day] = eventDate.split("-");
    return `Gottesdienst der Gemeinde für Christus Steffisburg vom ${day}.${month}.${year} ${eventTime.slice(0, 5)}`;
  }

  async function syncUpcomingYoutubeStreams(departmentId: string) {
    const broadcasts: YoutubeBroadcast[] = [];
    const accessToken = await youtubeAccessToken(departmentId);
    let pageToken = "";
    do {
      const params = new URLSearchParams({ part: "id,snippet,status", broadcastStatus: "upcoming", broadcastType: "event", maxResults: "50" });
      if (pageToken) params.set("pageToken", pageToken);
      const page = await youtubeApi<{ items?: YoutubeBroadcast[]; nextPageToken?: string }>(accessToken, `liveBroadcasts?${params.toString()}`);
      broadcasts.push(...(page.items ?? []));
      pageToken = page.nextPageToken ?? "";
    } while (pageToken && broadcasts.length < 500);

    let created = 0;
    let updated = 0;
    for (const broadcast of broadcasts) {
      if (!broadcast.id || !broadcast.snippet?.scheduledStartTime || !broadcast.snippet.title) continue;
      const title = broadcast.snippet.title.slice(0, 100);
      const description = (broadcast.snippet.description ?? "").slice(0, 5000);
      const scheduledStartAt = new Date(broadcast.snippet.scheduledStartTime);
      if (!Number.isFinite(scheduledStartAt.getTime())) continue;
      const privacyStatus = broadcast.status?.privacyStatus ?? "unlisted";
      const existing = await pool!.query<{ id: string }>(
        "SELECT id FROM video_planned_streams WHERE department_id=$1 AND youtube_broadcast_id=$2 LIMIT 1", [departmentId, broadcast.id],
      );
      if (existing.rowCount) {
        await pool!.query(
          `UPDATE video_planned_streams
              SET title=$3,description=$4,scheduled_start_at=$5,privacy_status=$6,youtube_status='scheduled',youtube_error=NULL,updated_at=now()
            WHERE department_id=$1 AND youtube_broadcast_id=$2`,
          [departmentId, broadcast.id, title, description, scheduledStartAt.toISOString(), privacyStatus],
        );
        updated++;
      } else {
        await pool!.query(
          `INSERT INTO video_planned_streams (id,department_id,event_id,title,description,speaker,theme,scheduled_start_at,privacy_status,youtube_broadcast_id,youtube_status,created_by)
           VALUES ($1,$2,NULL,$3,$4,'','',$5,$6,$7,'scheduled','youtube-sync')`,
          [randomUUID(), departmentId, title, description, scheduledStartAt.toISOString(), privacyStatus, broadcast.id],
        );
        created++;
      }
    }
    return { broadcasts, created, updated };
  }

  app.get("/api/video/planned-streams", async (request, reply) => {
    const selectedDepartmentId = await activeVideoDepartment(request, reply);
    if (!selectedDepartmentId) return reply;
    try {
      const connection = await youtubeConnection(selectedDepartmentId);
      const remoteSync = connection ? await syncUpcomingYoutubeStreams(selectedDepartmentId) : { broadcasts: [] as YoutubeBroadcast[], created: 0, updated: 0 };
      const youtubeIds = remoteSync.broadcasts.flatMap((broadcast) => broadcast.id ? [broadcast.id] : []);
      const [streams, nextEvent, adjacentEvents, oauthSettings] = await Promise.all([
        youtubeIds.length ? pool!.query<{ id: string; event_id: string | null; speaker: string; theme: string; youtube_broadcast_id: string; youtube_error: string | null; youtube_playlist_id: string | null; youtube_playlist_title: string | null }>(
          `SELECT id,event_id,speaker,theme,youtube_broadcast_id,youtube_error,youtube_playlist_id,youtube_playlist_title
             FROM video_planned_streams
            WHERE department_id=$1 AND youtube_broadcast_id=ANY($2::text[])`, [selectedDepartmentId, youtubeIds],
        ) : { rows: [] as Array<{ id: string; event_id: string | null; speaker: string; theme: string; youtube_broadcast_id: string; youtube_error: string | null; youtube_playlist_id: string | null; youtube_playlist_title: string | null }> },
        currentOrNextService(selectedDepartmentId),
        previousAndFollowingServices(selectedDepartmentId),
        youtubeOAuthSettings(),
      ]);
      const streamByBroadcastId = new Map(streams.rows.map((stream) => [stream.youtube_broadcast_id, stream]));
      let playlists: Array<{ id: string; title: string }> = [];
      if (connection) {
        try { playlists = await youtubePlaylists(await youtubeAccessToken(selectedDepartmentId)); }
        catch (error) { request.log.warn({ err: error }, "Could not load YouTube playlists for the stream wizard."); }
      }
      return {
        nextEvent,
        adjacentEvents,
        youtube: { configured: youtubeOAuthConfigured(oauthSettings.clientId, oauthSettings.clientSecret), connected: Boolean(connection), ...(connection ? { channelId: connection.channel_id, channelTitle: connection.channel_title } : {}) },
        playlists,
        streams: remoteSync.broadcasts.flatMap((broadcast) => {
          const youtubeBroadcastId = broadcast.id;
          const scheduledStartAt = broadcast.snippet?.scheduledStartTime;
          const local = youtubeBroadcastId ? streamByBroadcastId.get(youtubeBroadcastId) : undefined;
          if (!youtubeBroadcastId || !scheduledStartAt || !broadcast.snippet?.title || !local) return [];
          return [{
            id: local.id, eventId: local.event_id, title: broadcast.snippet.title, description: broadcast.snippet.description ?? "",
            speaker: local.speaker, theme: local.theme, startsAt: scheduledStartAt,
            privacyStatus: broadcast.status?.privacyStatus ?? "unlisted", youtubeBroadcastId,
            youtubeStatus: "scheduled", youtubeError: local.youtube_error,
            youtubePlaylistId: local.youtube_playlist_id, youtubePlaylistTitle: local.youtube_playlist_title,
            studioUrl: `https://studio.youtube.com/video/${encodeURIComponent(youtubeBroadcastId)}/livestreaming`,
          }];
        }).sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime()).slice(0, 5),
      };
    } catch (error) {
      return reply.code(503).send({ error: error instanceof Error ? error.message : "Could not load planned streams." });
    }
  });

  app.get<{ Querystring: { broadcastId?: string } }>("/api/video/youtube/studio-control", {
    schema: { querystring: { type: "object", additionalProperties: false, properties: { broadcastId: { type: "string", minLength: 1, maxLength: 128 } } } },
  }, async (request, reply) => {
    const selectedDepartmentId = await activeVideoDepartment(request, reply);
    if (!selectedDepartmentId) return reply;
    if (!await youtubeConnection(selectedDepartmentId)) return reply.code(409).send({ error: "Connect YouTube to view the Studio preview." });
    try {
      const accessToken = await youtubeAccessToken(selectedDepartmentId);
      if (request.query.broadcastId) {
        const response = await youtubeApi<{ items?: YoutubeBroadcast[] }>(accessToken, `liveBroadcasts?part=id,snippet,status,contentDetails,statistics&id=${encodeURIComponent(request.query.broadcastId)}`);
        const broadcast = response.items?.[0];
        if (!broadcast?.id || !broadcast.snippet?.title) return reply.code(404).send({ error: "The YouTube broadcast was not found on the connected channel." });
        const streamId = broadcast.contentDetails?.boundStreamId;
        let streamStatus = "unavailable";
        let streamQuality: { status: string | null; issues: Array<{ type: string; severity: string; reason: string; description: string }> } = { status: null, issues: [] };
        if (streamId) {
          const streamResponse = await youtubeApi<{ items?: Array<{ status?: { streamStatus?: string; healthStatus?: { status?: string; configurationIssues?: Array<{ type?: string; severity?: string; reason?: string; description?: string }> } } }> }>(accessToken, `liveStreams?part=status&id=${encodeURIComponent(streamId)}`);
          const stream = streamResponse.items?.[0];
          streamStatus = stream?.status?.streamStatus ?? "unavailable";
          streamQuality = {
            status: stream?.status?.healthStatus?.status ?? null,
            issues: (stream?.status?.healthStatus?.configurationIssues ?? []).slice(0, 8).map((issue) => ({
              type: issue.type ?? "unknown",
              severity: issue.severity ?? "info",
              reason: issue.reason ?? "Stream quality issue",
              description: (issue.description ?? "").slice(0, 500),
            })),
          };
        }
        let likeCount: number | null = null;
        try {
          const videoStats = await youtubeApi<{ items?: Array<{ statistics?: { likeCount?: string } }> }>(accessToken, `videos?part=statistics&id=${encodeURIComponent(broadcast.id)}`);
          const count = Number(videoStats.items?.[0]?.statistics?.likeCount);
          if (Number.isFinite(count)) likeCount = count;
        } catch (error) {
          request.log.info({ err: error, broadcastId: broadcast.id }, "Could not load YouTube likes for the selected broadcast.");
        }
        return {
          broadcastId: broadcast.id,
          title: broadcast.snippet.title,
          startsAt: broadcast.snippet.scheduledStartTime ?? null,
          status: broadcast.status?.lifeCycleStatus ?? "unknown",
          privacyStatus: broadcast.status?.privacyStatus ?? "unlisted",
          streamStatus,
          streamQuality,
          concurrentViewers: broadcast.statistics?.concurrentViewers == null ? null : Number(broadcast.statistics.concurrentViewers),
          likeCount,
          previewUrl: youtubeMonitorUrl(broadcast.contentDetails?.monitorStream?.embedHtml),
          studioUrl: `https://studio.youtube.com/video/${encodeURIComponent(broadcast.id)}/livestreaming`,
        };
      }

      const [upcoming, active] = await Promise.all(["upcoming", "active"].map((broadcastStatus) => {
        const query = new URLSearchParams({ part: "id,snippet,status,contentDetails", broadcastStatus, broadcastType: "event", maxResults: "50" });
        return youtubeApi<{ items?: YoutubeBroadcast[] }>(accessToken, `liveBroadcasts?${query}`);
      }));
      const unique = new Map<string, { id: string; title: string; scheduledStartTime?: string; status: string; privacyStatus: string; previewUrl: string | null; studioUrl: string }>();
      for (const broadcast of upcoming.items ?? []) {
        // YouTube also returns ready broadcasts without a schedule (for example, the channel's "Stream now" event).
        // Only scheduled broadcasts belong in this planned-stream picker.
        if (!broadcast.id || !broadcast.snippet?.title || !broadcast.snippet.scheduledStartTime) continue;
        unique.set(broadcast.id, {
          id: broadcast.id,
          title: broadcast.snippet.title,
          scheduledStartTime: broadcast.snippet.scheduledStartTime,
          status: broadcast.status?.lifeCycleStatus ?? "unknown",
          privacyStatus: broadcast.status?.privacyStatus ?? "unlisted",
          previewUrl: youtubeMonitorUrl(broadcast.contentDetails?.monitorStream?.embedHtml),
          studioUrl: `https://studio.youtube.com/video/${encodeURIComponent(broadcast.id)}/livestreaming`,
        });
      }
      const broadcasts = [...unique.values()].sort((a, b) => new Date(a.scheduledStartTime ?? "").getTime() - new Date(b.scheduledStartTime ?? "").getTime()).slice(0, 10).map((broadcast) => ({
        id: broadcast.id, title: broadcast.title, startsAt: broadcast.scheduledStartTime ?? null,
        status: broadcast.status, privacyStatus: broadcast.privacyStatus,
        previewUrl: broadcast.previewUrl, studioUrl: broadcast.studioUrl,
      }));
      const activeBroadcasts = (active.items ?? []).flatMap((broadcast) => {
        const status = broadcast.status?.lifeCycleStatus ?? "unknown";
        if (!broadcast.id || !broadcast.snippet?.title || !/^(?:testing|testStarting|live|liveStarting)$/.test(status)) return [];
        return [{
          id: broadcast.id, title: broadcast.snippet.title, startsAt: broadcast.snippet.scheduledStartTime ?? null,
          status, privacyStatus: broadcast.status?.privacyStatus ?? "unlisted",
          previewUrl: youtubeMonitorUrl(broadcast.contentDetails?.monitorStream?.embedHtml),
          studioUrl: `https://studio.youtube.com/video/${encodeURIComponent(broadcast.id)}/livestreaming`,
        }];
      });
      return { broadcasts, activeBroadcasts };
    } catch (error) {
      request.log.error({ err: error }, "Could not load the YouTube Studio preview.");
      return reply.code(502).send({ error: error instanceof Error ? `YouTube Studio preview failed: ${error.message}` : "YouTube Studio preview failed." });
    }
  });

  app.get("/api/video/youtube/past-streams", async (request, reply) => {
    const selectedDepartmentId = await activeVideoDepartment(request, reply);
    if (!selectedDepartmentId) return reply;
    if (!await youtubeConnection(selectedDepartmentId)) return { streams: [] };
    try {
      const accessToken = await youtubeAccessToken(selectedDepartmentId);
      const query = new URLSearchParams({ part: "id,snippet,status", broadcastStatus: "completed", broadcastType: "event", maxResults: "50" });
      const broadcasts = await youtubeApi<{ items?: YoutubeBroadcast[] }>(accessToken, `liveBroadcasts?${query}`);
      const completed = (broadcasts.items ?? []).filter((broadcast) => broadcast.id && broadcast.snippet?.title);
      if (!completed.length) return { streams: [] };
      const videoQuery = new URLSearchParams({ part: "snippet,statistics,liveStreamingDetails", id: completed.map((broadcast) => broadcast.id!).join(",") });
      const videos = await youtubeApi<{ items?: Array<{ id?: string; snippet?: { publishedAt?: string; thumbnails?: Record<string, { url?: string }> }; statistics?: { viewCount?: string; likeCount?: string }; liveStreamingDetails?: { actualStartTime?: string; actualEndTime?: string } }> }>(accessToken, `videos?${videoQuery}`);
      const videosById = new Map((videos.items ?? []).flatMap((video) => video.id ? [[video.id, video] as const] : []));
      const streams = completed.map((broadcast) => {
        const video = videosById.get(broadcast.id!);
        const numberValue = (value?: string) => value !== undefined && Number.isFinite(Number(value)) ? Number(value) : null;
        const endedAt = video?.liveStreamingDetails?.actualEndTime ?? null;
        const startsAt = video?.liveStreamingDetails?.actualStartTime ?? broadcast.snippet?.scheduledStartTime ?? null;
        return {
          id: broadcast.id!, title: broadcast.snippet!.title!, startsAt, endedAt,
          sortTime: endedAt ?? startsAt ?? video?.snippet?.publishedAt ?? "",
          thumbnailUrl: video?.snippet?.thumbnails?.high?.url ?? video?.snippet?.thumbnails?.medium?.url ?? video?.snippet?.thumbnails?.default?.url ?? null,
          privacyStatus: broadcast.status?.privacyStatus ?? "private",
          viewCount: numberValue(video?.statistics?.viewCount),
          likeCount: numberValue(video?.statistics?.likeCount),
          watchUrl: `https://www.youtube.com/watch?v=${encodeURIComponent(broadcast.id!)}`,
          studioUrl: `https://studio.youtube.com/video/${encodeURIComponent(broadcast.id!)}/livestreaming`,
        };
      }).sort((a, b) => new Date(b.sortTime).getTime() - new Date(a.sortTime).getTime()).slice(0, 6)
        .map(({ sortTime: _sortTime, ...stream }) => stream);
      return { streams };
    } catch (error) {
      request.log.error({ err: error }, "Could not load past YouTube livestreams.");
      return reply.code(502).send({ error: error instanceof Error ? `Could not load past YouTube livestreams: ${error.message}` : "Could not load past YouTube livestreams." });
    }
  });

  app.post<{ Params: { broadcastId: string }; Body: { target: "testing" | "live" | "complete" } }>("/api/video/youtube/studio-control/:broadcastId/transition", {
    schema: {
      params: { type: "object", additionalProperties: false, required: ["broadcastId"], properties: { broadcastId: { type: "string", minLength: 1, maxLength: 128 } } },
      body: { type: "object", additionalProperties: false, required: ["target"], properties: { target: { type: "string", enum: ["testing", "live", "complete"] } } },
    },
  }, async (request, reply) => {
    if (!validateMutation(request, reply)) return reply;
    const selectedDepartmentId = await activeVideoDepartment(request, reply, "streaming_operator");
    if (!selectedDepartmentId) return reply;
    if (!await youtubeConnection(selectedDepartmentId)) return reply.code(409).send({ error: "Connect YouTube before controlling a broadcast." });
    try {
      const accessToken = await youtubeAccessToken(selectedDepartmentId);
      const response = await youtubeApi<{ items?: YoutubeBroadcast[] }>(accessToken, `liveBroadcasts?part=id,snippet,status,contentDetails&id=${encodeURIComponent(request.params.broadcastId)}`);
      const broadcast = response.items?.[0];
      if (!broadcast?.id) return reply.code(404).send({ error: "The YouTube broadcast was not found on the connected channel." });
      const status = broadcast.status?.lifeCycleStatus ?? "unknown";
      if (request.body.target === "testing") {
        if (status === "testing" || status === "testStarting") return { broadcastId: broadcast.id, status };
        if (status !== "ready") return reply.code(409).send({ error: `A preview cannot start from the broadcast's current status: ${status}.` });
        const streamId = broadcast.contentDetails?.boundStreamId;
        if (!streamId) return reply.code(409).send({ error: "This YouTube broadcast is not connected to an encoder stream." });
        const streamResponse = await youtubeApi<{ items?: Array<{ status?: { streamStatus?: string } }> }>(accessToken, `liveStreams?part=status&id=${encodeURIComponent(streamId)}`);
        if (streamResponse.items?.[0]?.status?.streamStatus !== "active") {
          return reply.code(409).send({ error: "YouTube is not receiving video yet. Start the encoder and wait for its signal before starting the preview." });
        }
      } else if (request.body.target === "live") {
        if (status === "live" || status === "liveStarting") return { broadcastId: broadcast.id, status };
        if (status !== "testing" && (status !== "ready" || broadcast.contentDetails?.monitorStream?.enableMonitorStream !== false)) {
          return reply.code(409).send({ error: "Start the preview and verify the incoming video before going live." });
        }
        const streamId = broadcast.contentDetails?.boundStreamId;
        if (!streamId) return reply.code(409).send({ error: "This YouTube broadcast is not connected to an encoder stream." });
        const streamResponse = await youtubeApi<{ items?: Array<{ status?: { streamStatus?: string } }> }>(accessToken, `liveStreams?part=status&id=${encodeURIComponent(streamId)}`);
        if (streamResponse.items?.[0]?.status?.streamStatus !== "active") {
          return reply.code(409).send({ error: "YouTube is not receiving video yet. Start the encoder and wait for its signal before going live." });
        }
      } else if (!["live", "liveStarting", "testing", "testStarting"].includes(status)) {
        return reply.code(409).send({ error: `This broadcast cannot be stopped from its current status: ${status}.` });
      }
      const result = await transitionYoutubeBroadcast(accessToken, broadcast.id, request.body.target);
      return { broadcastId: result.id, status: result.status };
    } catch (error) {
      return reply.code(502).send({ error: error instanceof Error ? `YouTube could not change the broadcast status: ${error.message}` : "YouTube could not change the broadcast status." });
    }
  });

  app.post<{ Body: { eventId: string; title: string; speaker: string; theme: string; scheduledStartAt: string; privacyStatus: "private" | "unlisted" | "public"; playlistId?: string | null } }>("/api/video/planned-streams", {
    schema: { body: { type: "object", additionalProperties: false, required: ["eventId", "title", "speaker", "theme", "scheduledStartAt", "privacyStatus"], properties: { eventId: { type: "string", format: "uuid" }, title: { type: "string", minLength: 1, maxLength: 100 }, speaker: { type: "string", maxLength: 300 }, theme: { type: "string", maxLength: 1000 }, scheduledStartAt: { type: "string", format: "date-time" }, privacyStatus: { type: "string", enum: ["private", "unlisted", "public"] }, playlistId: { anyOf: [{ type: "string", maxLength: 128 }, { type: "null" }] } } } },
  }, async (request, reply) => {
    if (!validateMutation(request, reply)) return reply;
    const selectedDepartmentId = await activeVideoDepartment(request, reply, "stream_admin");
    if (!selectedDepartmentId) return reply;
    const [anchor, adjacent] = await Promise.all([currentOrNextService(selectedDepartmentId), previousAndFollowingServices(selectedDepartmentId)]);
    const event = [anchor, ...adjacent].find((item) => item?.id === request.body.eventId);
    if (!event) return reply.code(409).send({ error: "The selected service is no longer in the overview. Refresh the service details and try again." });
    const title = request.body.title.trim();
    const speaker = request.body.speaker.trim();
    const theme = request.body.theme.trim();
    const scheduledStartAt = new Date(request.body.scheduledStartAt);
    if (!title || !Number.isFinite(scheduledStartAt.getTime())) return reply.code(400).send({ error: "Enter a stream title and valid start time." });
    let playlist: { id: string; title: string } | null;
    try { playlist = await selectedYoutubePlaylist(selectedDepartmentId, request.body.playlistId); }
    catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : "Could not validate the selected YouTube playlist." }); }
    const description = youtubeServiceDescription(event.eventDate, event.startTime);
    const id = randomUUID();
    await pool!.query(
      `INSERT INTO video_planned_streams (id, department_id, event_id, title, description, speaker, theme, scheduled_start_at, privacy_status, youtube_playlist_id, youtube_playlist_title, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING id, event_id, title, description, speaker, theme, scheduled_start_at, privacy_status, youtube_broadcast_id, youtube_status, youtube_error, youtube_playlist_id, youtube_playlist_title`,
      [id, selectedDepartmentId, event.id, title, description, speaker, theme, scheduledStartAt.toISOString(), request.body.privacyStatus, playlist?.id ?? null, playlist?.title ?? null, request.authenticatedUser!.username],
    );
    if (await youtubeConnection(selectedDepartmentId)) {
      try {
        const broadcast = await scheduleYoutubeBroadcast(selectedDepartmentId, { title, description, scheduledStartAt: scheduledStartAt.toISOString(), privacyStatus: request.body.privacyStatus });
        await pool!.query("UPDATE video_planned_streams SET youtube_broadcast_id=$2,youtube_status='scheduled',youtube_error=NULL,updated_at=now() WHERE id=$1", [id, broadcast.id]);
        if (playlist?.id) {
          try {
            const accessToken = await youtubeAccessToken(selectedDepartmentId);
            await addYoutubeVideoToPlaylist(accessToken, playlist.id, broadcast.id);
            await pool!.query("UPDATE video_planned_streams SET youtube_playlist_added_at=now(),updated_at=now() WHERE id=$1", [id]);
          } catch (error) {
            request.log.info({ err: error, broadcastId: broadcast.id }, "Scheduled YouTube event is not available to add to its playlist yet; it will retry automatically.");
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message.slice(0, 500) : "YouTube scheduling failed.";
        await pool!.query("UPDATE video_planned_streams SET youtube_status='error',youtube_error=$2,updated_at=now() WHERE id=$1", [id, message]);
      }
    }
    const result = await pool!.query("SELECT id, event_id, title, description, speaker, theme, scheduled_start_at, privacy_status, youtube_broadcast_id, youtube_status, youtube_error, youtube_playlist_id, youtube_playlist_title FROM video_planned_streams WHERE id=$1", [id]);
    return reply.code(201).send(result.rows[0]);
  });

  app.put<{ Params: { id: string }; Body: { title: string; speaker: string; theme: string; scheduledStartAt: string; privacyStatus: "private" | "unlisted" | "public"; playlistId?: string | null } }>("/api/video/planned-streams/:id", {
    schema: {
      params: { type: "object", additionalProperties: false, required: ["id"], properties: { id: { type: "string", format: "uuid" } } },
      body: { type: "object", additionalProperties: false, required: ["title", "speaker", "theme", "scheduledStartAt", "privacyStatus"], properties: { title: { type: "string", minLength: 1, maxLength: 100 }, speaker: { type: "string", maxLength: 300 }, theme: { type: "string", maxLength: 1000 }, scheduledStartAt: { type: "string", format: "date-time" }, privacyStatus: { type: "string", enum: ["private", "unlisted", "public"] }, playlistId: { anyOf: [{ type: "string", maxLength: 128 }, { type: "null" }] } } },
    },
  }, async (request, reply) => {
    if (!validateMutation(request, reply)) return reply;
    const selectedDepartmentId = await activeVideoDepartment(request, reply, "stream_admin");
    if (!selectedDepartmentId) return reply;
    const existingResult = await pool!.query<{ id: string; event_id: string | null; youtube_broadcast_id: string | null; youtube_playlist_id: string | null }>(
      "SELECT id,event_id,youtube_broadcast_id,youtube_playlist_id FROM video_planned_streams WHERE id=$1 AND department_id=$2", [request.params.id, selectedDepartmentId],
    );
    const existing = existingResult.rows[0];
    if (!existing) return reply.code(404).send({ error: "Planned stream not found." });
    const title = request.body.title.trim();
    const speaker = request.body.speaker.trim();
    const theme = request.body.theme.trim();
    const scheduledStartAt = new Date(request.body.scheduledStartAt);
    if (!title || !Number.isFinite(scheduledStartAt.getTime())) return reply.code(400).send({ error: "Enter a stream title and valid start time." });
    let playlist: { id: string; title: string } | null;
    try { playlist = await selectedYoutubePlaylist(selectedDepartmentId, request.body.playlistId === undefined ? existing.youtube_playlist_id : request.body.playlistId); }
    catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : "Could not validate the selected YouTube playlist." }); }
    const serviceDate = existing.event_id ? await pool!.query<{ event_date: string; start_time: string }>(
      "SELECT to_char(event_date,'YYYY-MM-DD') AS event_date,to_char(start_time,'HH24:MI') AS start_time FROM service_events WHERE id=$1 AND department_id=$2",
      [existing.event_id, selectedDepartmentId],
    ) : null;
    const serviceTime = serviceDate?.rows[0];
    const description = serviceTime ? youtubeServiceDescription(serviceTime.event_date, serviceTime.start_time) : youtubeServiceDescription(
      scheduledStartAt.toLocaleDateString("en-CA", { timeZone: "Europe/Zurich" }),
      scheduledStartAt.toLocaleTimeString("en-GB", { timeZone: "Europe/Zurich", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }),
    );
    if (existing.youtube_broadcast_id) {
      try {
        const broadcast = await youtubeConnection(selectedDepartmentId);
        if (!broadcast) return reply.code(409).send({ error: "Reconnect YouTube before editing this scheduled broadcast." });
        await updateYoutubeBroadcast(await youtubeAccessToken(selectedDepartmentId), existing.youtube_broadcast_id, {
          title, description, scheduledStartTime: scheduledStartAt.toISOString(), privacyStatus: request.body.privacyStatus,
        });
      } catch (error) {
        return reply.code(502).send({ error: error instanceof Error ? `YouTube could not update this broadcast: ${error.message}` : "YouTube could not update this broadcast." });
      }
    }
    const result = await pool!.query(
      `UPDATE video_planned_streams
          SET title=$3,description=$4,speaker=$5,theme=$6,scheduled_start_at=$7,privacy_status=$8,
              youtube_playlist_added_at=CASE WHEN youtube_playlist_id IS DISTINCT FROM $9 THEN NULL ELSE youtube_playlist_added_at END,
              youtube_playlist_id=$9,youtube_playlist_title=$10,updated_at=now()
        WHERE id=$1 AND department_id=$2
        RETURNING id,event_id,title,description,speaker,theme,scheduled_start_at,privacy_status,youtube_broadcast_id,youtube_status,youtube_error,youtube_playlist_id,youtube_playlist_title`,
      [request.params.id, selectedDepartmentId, title, description, speaker, theme, scheduledStartAt.toISOString(), request.body.privacyStatus, playlist?.id ?? null, playlist?.title ?? null],
    );
    return result.rows[0];
  });

  app.post("/api/video/planned-streams/sync-youtube", async (request, reply) => {
    if (!validateMutation(request, reply)) return reply;
    const selectedDepartmentId = await activeVideoDepartment(request, reply, "stream_admin");
    if (!selectedDepartmentId) return reply;
    if (!await youtubeConnection(selectedDepartmentId)) return reply.code(409).send({ error: "Connect YouTube before syncing planned streams." });
    try {
      const { created, updated } = await syncUpcomingYoutubeStreams(selectedDepartmentId);
      return { total: created + updated, created, updated };
    } catch (error) {
      request.log.error({ err: error }, "YouTube broadcast sync failed.");
      const message = error instanceof Error ? error.message : "Unexpected error while syncing YouTube broadcasts.";
      return reply.code(502).send({ error: `YouTube sync failed: ${message}` });
    }
  });

  app.post<{ Params: { id: string } }>("/api/video/planned-streams/:id/sync", {
    schema: { params: { type: "object", additionalProperties: false, required: ["id"], properties: { id: { type: "string", format: "uuid" } } } },
  }, async (request, reply) => {
    if (!validateMutation(request, reply)) return reply;
    const selectedDepartmentId = await activeVideoDepartment(request, reply, "stream_admin");
    if (!selectedDepartmentId) return reply;
    const result = await pool!.query<{ id: string; title: string; description: string; scheduled_start_at: Date; privacy_status: "private" | "unlisted" | "public"; youtube_broadcast_id: string | null }>(
      "SELECT id,title,description,scheduled_start_at,privacy_status,youtube_broadcast_id FROM video_planned_streams WHERE id=$1 AND department_id=$2", [request.params.id, selectedDepartmentId],
    );
    const stream = result.rows[0];
    if (!stream) return reply.code(404).send({ error: "Planned stream not found." });
    if (stream.youtube_broadcast_id) return reply.code(409).send({ error: "This stream is already scheduled on YouTube." });
    try {
      const broadcast = await scheduleYoutubeBroadcast(selectedDepartmentId, { title: stream.title, description: stream.description, scheduledStartAt: stream.scheduled_start_at.toISOString(), privacyStatus: stream.privacy_status });
      await pool!.query("UPDATE video_planned_streams SET youtube_broadcast_id=$2,youtube_status='scheduled',youtube_error=NULL,updated_at=now() WHERE id=$1", [stream.id, broadcast.id]);
      return { synced: true, youtubeBroadcastId: broadcast.id };
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 500) : "YouTube scheduling failed.";
      await pool!.query("UPDATE video_planned_streams SET youtube_status='error',youtube_error=$2,updated_at=now() WHERE id=$1", [stream.id, message]);
      return reply.code(502).send({ error: message });
    }
  });

  app.delete<{ Params: { id: string } }>("/api/video/planned-streams/:id", {
    schema: { params: { type: "object", additionalProperties: false, required: ["id"], properties: { id: { type: "string", minLength: 1, maxLength: 128 } } } },
  }, async (request, reply) => {
    if (!validateMutation(request, reply)) return reply;
    const selectedDepartmentId = await activeVideoDepartment(request, reply, "stream_admin");
    if (!selectedDepartmentId) return reply;
    const streamResult = await pool!.query<{ id: string; youtube_broadcast_id: string | null }>(
      "SELECT id,youtube_broadcast_id FROM video_planned_streams WHERE department_id=$1 AND (id::text=$2 OR youtube_broadcast_id=$2) LIMIT 1",
      [selectedDepartmentId, request.params.id],
    );
    const stream = streamResult.rows[0];
    if (!stream) return reply.code(404).send({ error: "Planned stream not found." });
    if (stream.youtube_broadcast_id) {
      try { await deleteYoutubeBroadcast(await youtubeAccessToken(selectedDepartmentId), stream.youtube_broadcast_id); }
      catch (error) { return reply.code(502).send({ error: error instanceof Error ? error.message : "Could not delete the YouTube broadcast." }); }
    }
    await pool!.query("DELETE FROM video_planned_streams WHERE id=$1 AND department_id=$2", [stream.id, selectedDepartmentId]);
    return { deleted: true };
  });

  app.get("/api/video/settings/youtube-client", async (request, reply) => {
    const selectedDepartmentId = await settingsDepartment(request, reply);
    if (!selectedDepartmentId) return reply;
    try {
      const settings = await youtubeOAuthSettings();
      return { clientId: settings.clientId, clientSecretConfigured: settings.clientSecretConfigured, tokenKeyConfigured: Boolean(process.env.SMART_CHURCH_VIDEO_STEFFISBURG_YOUTUBE_TOKEN_KEY?.trim()) };
    }
    catch (error) { return reply.code(503).send({ error: error instanceof Error ? error.message : "Could not load YouTube client settings." }); }
  });

  app.put<{ Body: { clientId: string; clientSecret?: string } }>("/api/video/settings/youtube-client", {
    schema: youtubeClientSettingSchema,
  }, async (request, reply) => {
    if (!validateMutation(request, reply)) return reply;
    const selectedDepartmentId = await settingsDepartment(request, reply);
    if (!selectedDepartmentId) return reply;
    const clientId = request.body.clientId.trim();
    if (clientId && !/^\d+-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(clientId)) {
      return reply.code(400).send({ error: "Enter a Google OAuth client ID ending in .apps.googleusercontent.com." });
    }
    const clientSecret = request.body.clientSecret?.trim() ?? "";
    try {
      const current = await pool!.query<{ youtube_client_secret_encrypted: string | null }>("SELECT youtube_client_secret_encrypted FROM video_module_settings WHERE singleton=true");
      let encryptedSecret = current.rows[0]?.youtube_client_secret_encrypted ?? null;
      if (clientSecret) {
        if (!process.env.SMART_CHURCH_VIDEO_STEFFISBURG_YOUTUBE_TOKEN_KEY?.trim()) return reply.code(503).send({ error: "Set the module's YOUTUBE_TOKEN_KEY in the server environment before saving a client secret." });
        encryptedSecret = encryptYoutubeToken(clientSecret);
      }
      await pool!.query(
        `INSERT INTO video_module_settings (singleton, youtube_client_id, youtube_client_secret_encrypted, updated_by)
         VALUES (true,$1,$2,$3)
         ON CONFLICT (singleton) DO UPDATE SET youtube_client_id=EXCLUDED.youtube_client_id, youtube_client_secret_encrypted=EXCLUDED.youtube_client_secret_encrypted, updated_by=EXCLUDED.updated_by, updated_at=now()`,
        [clientId, encryptedSecret, request.authenticatedUser!.username],
      );
      return { clientId, clientSecretConfigured: Boolean(encryptedSecret) };
    } catch (error) { return reply.code(503).send({ error: error instanceof Error ? error.message : "Could not save YouTube client settings." }); }
  });

  app.post("/api/modules/video-steffisburg/youtube/connect", async (request, reply) => {
    if (!validateMutation(request, reply)) return reply;
    const selectedDepartmentId = await activeVideoDepartment(request, reply, "stream_admin");
    if (!selectedDepartmentId) return reply;
    const oauthSettings = await youtubeOAuthSettings();
    if (!youtubeOAuthConfigured(oauthSettings.clientId, oauthSettings.clientSecret)) return reply.code(503).send({ error: "Configure the YouTube client ID and client secret in Video module settings, plus the redirect URL and token encryption key in the server environment." });
    const state = randomBytes(32).toString("base64url");
    youtubeOAuthStates.set(state, { departmentId: selectedDepartmentId, userId: request.authenticatedUser!.id, username: request.authenticatedUser!.username, expiresAt: Date.now() + 10 * 60_000 });
    for (const [key, value] of youtubeOAuthStates) if (value.expiresAt <= Date.now()) youtubeOAuthStates.delete(key);
    return { authorizationUrl: youtubeAuthorizationUrl(state, oauthSettings.clientId) };
  });

  app.get<{ Querystring: { state?: string; code?: string; error?: string } }>("/api/auth/modules/video-steffisburg/youtube/callback", {
    schema: { querystring: { type: "object", additionalProperties: true, properties: { state: { type: "string", maxLength: 100 }, code: { type: "string", maxLength: 4096 }, error: { type: "string", maxLength: 200 } } } },
  }, async (request, reply) => {
    const state = typeof request.query.state === "string" ? youtubeOAuthStates.get(request.query.state) : undefined;
    if (!state || state.expiresAt < Date.now()) return reply.code(400).send({ error: "This YouTube connection request expired. Start again from Video overview." });
    youtubeOAuthStates.delete(request.query.state!);
    const overviewUrl = process.env.SMART_CHURCH_WEB_ORIGIN
      ? new URL("/#module-video-steffisburg", process.env.SMART_CHURCH_WEB_ORIGIN).toString()
      : "/#module-video-steffisburg";
    if (request.query.error) return reply.redirect(overviewUrl);
    if (!request.query.code) return reply.code(400).send({ error: "Google did not return an authorization code." });
    try {
      const oauthSettings = await youtubeOAuthSettings();
      if (!youtubeOAuthConfigured(oauthSettings.clientId, oauthSettings.clientSecret)) return reply.code(503).send({ error: "YouTube OAuth settings are incomplete. Check the module Client ID and Client Secret, plus the server redirect URL and token key." });
      const tokens = await exchangeYoutubeCode(request.query.code, oauthSettings.clientId, oauthSettings.clientSecret);
      const accessToken = tokens.access_token!;
      const channel = await youtubeChannel(accessToken);
      const existing = await youtubeConnection(state.departmentId);
      const refreshToken = tokens.refresh_token ?? (existing ? decryptYoutubeToken(existing.encrypted_refresh_token) : "");
      if (!refreshToken) return reply.code(400).send({ error: "Google did not grant offline channel access. Disconnect the app in Google permissions, then connect again." });
      await pool!.query(
        `INSERT INTO video_youtube_connections (department_id, encrypted_refresh_token, channel_id, channel_title, connected_by, oauth_client_id)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (department_id) DO UPDATE SET encrypted_refresh_token=EXCLUDED.encrypted_refresh_token, channel_id=EXCLUDED.channel_id, channel_title=EXCLUDED.channel_title, connected_by=EXCLUDED.connected_by, oauth_client_id=EXCLUDED.oauth_client_id, connected_at=now(), updated_at=now()`,
        [state.departmentId, encryptYoutubeToken(refreshToken), channel.id, channel.title, state.username, oauthSettings.clientId],
      );
      return reply.redirect(overviewUrl);
    } catch (error) {
      request.log.warn({ err: error }, "YouTube channel connection failed.");
      return reply.code(502).send({ error: error instanceof Error ? error.message : "Could not connect the YouTube channel." });
    }
  });

  async function defaultDeviceAddresses(departmentId: string): Promise<DeviceAddressEntry[]> {
    const configPath = process.env.STREAMING_CONFIG_FILE;
    if (!configPath) throw new Error("Video module configuration is unavailable.");
    const config = JSON.parse(await readFile(configPath, "utf8")) as { sites?: Array<Record<string, unknown>> };
    const entries: DeviceAddressEntry[] = [];
    for (const site of config.sites ?? []) {
      const configuredDepartmentId = site.department_id === "$SMART_CHURCH_DEPARTMENT_ID" ? process.env.SMART_CHURCH_DEPARTMENT_ID : site.department_id;
      if (configuredDepartmentId !== departmentId || typeof site.id !== "string") continue;
      const siteName = typeof site.name === "string" ? site.name : site.id;
      if (Object.hasOwn(site, "router_ip")) entries.push({ siteId: site.id, siteName, targetType: "router", targetId: "", targetName: "Router", ip: typeof site.router_ip === "string" ? site.router_ip : "" });
      for (const [targetType, key] of [["encoder", "encoders"], ["device", "devices"]] as const) {
        const targets = Array.isArray(site[key]) ? site[key] as Array<Record<string, unknown>> : [];
        for (const target of targets) {
          if (typeof target.id !== "string") continue;
          if (targetType === "device" && (target.type === "converter" || target.id.startsWith("mini-converter-"))) continue;
          entries.push({ siteId: site.id, siteName, targetType, targetId: target.id, targetName: typeof target.name === "string" ? target.name : target.id, ip: typeof target.ip === "string" ? target.ip : "" });
        }
      }
    }
    return entries;
  }

  async function storedDeviceAddresses(departmentId: string) {
    const result = await pool!.query("SELECT default_addresses, addresses FROM video_device_address_settings WHERE department_id=$1", [departmentId]);
    if (result.rowCount) {
      const settings = result.rows[0] as { default_addresses: DeviceAddressEntry[]; addresses: DeviceAddressEntry[] };
      const isUsbConverter = (entry: DeviceAddressEntry) => entry.targetType === "device" && entry.targetId.startsWith("mini-converter-");
      const defaults = settings.default_addresses.filter((entry) => !isUsbConverter(entry));
      const addresses = settings.addresses.filter((entry) => !isUsbConverter(entry));
      if (defaults.length !== settings.default_addresses.length || addresses.length !== settings.addresses.length) {
        await pool!.query(
          "UPDATE video_device_address_settings SET default_addresses=$2::jsonb, addresses=$3::jsonb, updated_at=now() WHERE department_id=$1",
          [departmentId, JSON.stringify(defaults), JSON.stringify(addresses)],
        );
      }
      return { default_addresses: defaults, addresses };
    }
    const defaults = await defaultDeviceAddresses(departmentId);
    if (!defaults.length) throw new Error("No Video devices are configured for this location.");
    const inserted = await pool!.query(
      `INSERT INTO video_device_address_settings (department_id, default_addresses, addresses)
       VALUES ($1,$2::jsonb,$2::jsonb) ON CONFLICT (department_id) DO NOTHING
       RETURNING default_addresses, addresses`,
      [departmentId, JSON.stringify(defaults)],
    );
    if (inserted.rowCount) return inserted.rows[0] as { default_addresses: DeviceAddressEntry[]; addresses: DeviceAddressEntry[] };
    const raced = await pool!.query("SELECT default_addresses, addresses FROM video_device_address_settings WHERE department_id=$1", [departmentId]);
    return raced.rows[0] as { default_addresses: DeviceAddressEntry[]; addresses: DeviceAddressEntry[] };
  }

  async function syncDeviceAddresses(departmentId: string, actor: string, worker = getVideoWorker()) {
    if (!worker) throw Object.assign(new Error("The Video module worker is unavailable."), { code: "UNAVAILABLE" as const });
    const settings = await storedDeviceAddresses(departmentId);
    await worker.request("set-device-addresses", {
      addresses: settings.addresses.map(({ siteId, targetType, targetId, ip }) => ({ siteId, targetType, targetId, ip })),
    }, departmentId, actor, 8_000);
    return settings;
  }

  async function requestVideo(operation: string, data: Record<string, unknown>, departmentId: string, actor: string, timeout = 15_000) {
    const worker = getVideoWorker();
    if (!worker) throw Object.assign(new Error("The Video module worker is unavailable."), { code: "UNAVAILABLE" as const });
    await syncDeviceAddresses(departmentId, actor, worker);
    return worker.request(operation, data, departmentId, actor, timeout);
  }

  app.get("/api/video/settings/device-addresses", async (request, reply) => {
    const selectedDepartmentId = await settingsDepartment(request, reply);
    if (!selectedDepartmentId) return reply;
    try {
      const settings = await storedDeviceAddresses(selectedDepartmentId);
      return { defaults: settings.default_addresses, addresses: settings.addresses };
    } catch (error) {
      return reply.code(503).send({ error: error instanceof Error ? error.message : "Could not load Video device addresses." });
    }
  });

  app.put<{ Body: { addresses: Array<{ siteId: string; targetType: DeviceAddressTarget; targetId: string; ip: string }> } }>("/api/video/settings/device-addresses", {
    schema: { body: deviceAddressBodySchema },
  }, async (request, reply) => {
    if (!validateMutation(request, reply)) return reply;
    const selectedDepartmentId = await settingsDepartment(request, reply);
    if (!selectedDepartmentId) return reply;
    try {
      const settings = await storedDeviceAddresses(selectedDepartmentId);
      const allowed = new Map(settings.default_addresses.map((entry) => [addressKey(entry), entry]));
      const supplied = new Map<string, DeviceAddressEntry>();
      for (const input of request.body.addresses) {
        const key = addressKey(input);
        const template = allowed.get(key);
        if (!template || supplied.has(key)) return reply.code(400).send({ error: "The device address list does not match this location's configured equipment." });
        const ip = input.ip.trim();
        if (ip && isIP(ip) === 0) return reply.code(400).send({ error: `Enter a valid IP address for ${template.targetName}.` });
        supplied.set(key, { ...template, ip });
      }
      if (supplied.size !== allowed.size) return reply.code(400).send({ error: "Include an address for every configured router, encoder, and device." });
      const addresses = settings.default_addresses.map((entry) => supplied.get(addressKey(entry))!);
      await pool!.query(
        "UPDATE video_device_address_settings SET addresses=$2::jsonb, updated_at=now() WHERE department_id=$1",
        [selectedDepartmentId, JSON.stringify(addresses)],
      );
      try {
        await syncDeviceAddresses(selectedDepartmentId, request.authenticatedUser!.username);
      } catch (error) {
        const failure = error as Error & { code?: string };
        if (failure.code === "UNAVAILABLE") return reply.code(503).send({ error: "Addresses were saved, but the Video worker is unavailable. They will apply when it reconnects." });
        throw error;
      }
      return { defaults: settings.default_addresses, addresses };
    } catch (error) {
      return reply.code(503).send({ error: error instanceof Error ? error.message : "Could not save Video device addresses." });
    }
  });

  async function converterWorkerForSite(siteId: string, converterId: string, departmentId: string, request: FastifyRequest, reply: FastifyReply) {
    if (!["main", "sonnenhof"].includes(siteId)) {
      reply.code(404).send({ error: "Converter controls are not enabled for this location." });
      return null;
    }
    if (!["mini-converter-audio-to-sdi", "mini-converter-sdi-to-audio"].includes(converterId)) {
      reply.code(404).send({ error: "Controls are not enabled for this converter model." });
      return null;
    }
    const videoWorker = getVideoWorker();
    if (!videoWorker) {
      reply.code(503).send({ error: "The Video module worker is unavailable." });
      return null;
    }
    try {
      const status = await requestVideo("status", {}, departmentId, request.authenticatedUser!.username, 8_000) as { sites?: Array<{ id: string; devices?: Array<{ id: string; ip?: string }> }> };
      const site = status.sites?.find((candidate) => candidate.id === siteId);
      const silex = site?.devices?.find((device) => device.id === "silex");
      const converter = site?.devices?.find((device) => device.id === converterId);
      if (!site || !silex?.ip || !converter) {
        reply.code(404).send({ error: "This site does not have a configured Silex DS-700 and selected BMD Mini Converter." });
        return null;
      }
      const workerKey = `${silex.ip}|${converterId}`;
      let worker = converterWorkers.get(workerKey);
      if (!worker) {
        worker = new BmdConverterWorker(silex.ip);
        converterWorkers.set(workerKey, worker);
        worker.start();
      }
      return worker;
    } catch (error) {
      reply.code(503).send({ error: error instanceof Error ? error.message : "Could not load the site's Silex server configuration." });
      return null;
    }
  }

  app.get("/api/video/status", async (request, reply) => {
    const selectedDepartmentId = await activeVideoDepartment(request, reply);
    if (!selectedDepartmentId) return reply;
    const worker = getVideoWorker();
    const workerState = worker?.state ?? { state: "starting", error: null };
    if (!worker || workerState.state === "unconfigured") {
      return { available: false, worker: workerState, message: "Configure the private video settings file and map its sites to location IDs." };
    }
    try {
      const status = await requestVideo("status", {}, selectedDepartmentId, request.authenticatedUser!.username, 8_000);
      return { available: true, worker: worker.state, status };
    } catch (error) {
      const failure = error as Error & { code?: string };
      if (failure.code === "UNAVAILABLE") return reply.code(503).send({ available: false, worker: worker.state, error: failure.message });
      return reply.code(502).send({ available: false, worker: worker.state, error: failure.message });
    }
  });

  app.get<{ Querystring: { site_id?: string; converter_id?: string } }>("/api/video/converter/discover", {
    schema: { querystring: { type: "object", additionalProperties: false, required: ["site_id", "converter_id"], properties: { site_id: { type: "string", minLength: 1, maxLength: 80 }, converter_id: { type: "string", minLength: 1, maxLength: 80 } } } },
  }, async (request, reply) => {
    const selectedDepartmentId = await activeVideoDepartment(request, reply);
    if (!selectedDepartmentId) return reply;
    const converterWorker = await converterWorkerForSite(request.query.site_id!, request.query.converter_id!, selectedDepartmentId, request, reply);
    if (!converterWorker) return reply;
    try {
      return await converterWorker.discover(request.query.converter_id!);
    } catch (error) {
      const message = error instanceof Error ? error.message : "The DS-700 discovery request failed.";
      return reply.code(503).send({ configured: converterWorker.configured, error: message, worker: converterWorker.state });
    }
  });

  app.get<{ Querystring: { site_id?: string; converter_id?: string } }>("/api/video/converter/aes-level", {
    schema: { querystring: { type: "object", additionalProperties: false, required: ["site_id", "converter_id"], properties: { site_id: { type: "string", minLength: 1, maxLength: 80 }, converter_id: { type: "string", minLength: 1, maxLength: 80 } } } },
  }, async (request, reply) => {
    const selectedDepartmentId = await activeVideoDepartment(request, reply);
    if (!selectedDepartmentId) return reply;
    const converterWorker = await converterWorkerForSite(request.query.site_id!, request.query.converter_id!, selectedDepartmentId, request, reply);
    if (!converterWorker) return reply;
    try {
      return await converterWorker.readAesLevel(request.query.converter_id!);
    } catch (error) {
      const message = error instanceof Error ? error.message : "The converter AES/EBU level could not be read.";
      return reply.code(502).send({ configured: converterWorker.configured, error: message, worker: converterWorker.state });
    }
  });

  app.post<{ Body: { level: number; site_id: string; converter_id: string } }>("/api/video/converter/aes-level", {
    schema: {
      body: {
        type: "object",
        additionalProperties: false,
        required: ["level", "site_id", "converter_id"],
        properties: { level: { type: "integer", minimum: 0, maximum: 255 }, site_id: { type: "string", minLength: 1, maxLength: 80 }, converter_id: { type: "string", minLength: 1, maxLength: 80 } },
      },
    },
  }, async (request, reply) => {
    if (!validateMutation(request, reply)) return reply;
    const selectedDepartmentId = await activeVideoDepartment(request, reply, "stream_admin");
    if (!selectedDepartmentId) return reply;
    const converterWorker = await converterWorkerForSite(request.body.site_id, request.body.converter_id, selectedDepartmentId, request, reply);
    if (!converterWorker) return reply;
    try {
      return await converterWorker.setAesLevel(request.body.level, request.body.converter_id);
    } catch (error) {
      const message = error instanceof Error ? error.message : "The converter AES/EBU level could not be applied.";
      return reply.code(502).send({ configured: converterWorker.configured, error: message, worker: converterWorker.state });
    }
  });

  app.get<{ Querystring: { site_id?: string; converter_id?: string } }>("/api/video/converter/audio-levels", {
    schema: { querystring: { type: "object", additionalProperties: false, required: ["site_id", "converter_id"], properties: { site_id: { type: "string", minLength: 1, maxLength: 80 }, converter_id: { type: "string", minLength: 1, maxLength: 80 } } } },
  }, async (request, reply) => {
    const selectedDepartmentId = await activeVideoDepartment(request, reply);
    if (!selectedDepartmentId) return reply;
    const converterWorker = await converterWorkerForSite(request.query.site_id!, request.query.converter_id!, selectedDepartmentId, request, reply);
    if (!converterWorker) return reply;
    try {
      return await converterWorker.readAudioLevels(request.query.converter_id!);
    } catch (error) {
      return reply.code(502).send({ error: error instanceof Error ? error.message : "The converter audio levels could not be read." });
    }
  });

  app.post<{ Body: { levels: number[]; site_id: string; converter_id: string } }>("/api/video/converter/analog-levels", {
    schema: { body: { type: "object", additionalProperties: false, required: ["levels", "site_id", "converter_id"], properties: { levels: { type: "array", minItems: 4, maxItems: 4, items: { type: "integer", minimum: 0, maximum: 255 } }, site_id: { type: "string", minLength: 1, maxLength: 80 }, converter_id: { type: "string", minLength: 1, maxLength: 80 } } } },
  }, async (request, reply) => {
    if (!validateMutation(request, reply)) return reply;
    const selectedDepartmentId = await activeVideoDepartment(request, reply, "stream_admin");
    if (!selectedDepartmentId) return reply;
    const converterWorker = await converterWorkerForSite(request.body.site_id, request.body.converter_id, selectedDepartmentId, request, reply);
    if (!converterWorker) return reply;
    try {
      return await converterWorker.setAnalogLevels(request.body.levels, request.body.converter_id);
    } catch (error) {
      return reply.code(502).send({ error: error instanceof Error ? error.message : "The converter analog levels could not be set." });
    }
  });

  app.get<{ Querystring: { device?: string; site_id?: string } }>("/api/video/history", {
    schema: { querystring: { type: "object", additionalProperties: false, required: ["device"], properties: { device: { type: "string", minLength: 1, maxLength: 80 }, site_id: { type: "string", minLength: 1, maxLength: 80 } } } },
  }, async (request, reply) => {
    const selectedDepartmentId = await activeVideoDepartment(request, reply);
    if (!selectedDepartmentId) return reply;
    const worker = getVideoWorker();
    if (!worker) return reply.code(503).send({ error: "The video worker is not configured." });
    try {
      return await requestVideo("videohub-history", { device: request.query.device, ...(request.query.site_id ? { site_id: request.query.site_id } : {}) }, selectedDepartmentId, request.authenticatedUser!.username, 8_000);
    } catch (error) {
      const failure = error as Error & { code?: string };
      return reply.code(failure.code === "UNAVAILABLE" ? 503 : 502).send({ error: failure.message });
    }
  });

  app.post<{ Params: { operation: string }; Body: Record<string, unknown> }>("/api/video/:operation", {
    bodyLimit: 600_000,
    schema: {
      params: { type: "object", additionalProperties: false, required: ["operation"], properties: { operation: { type: "string", enum: [...videoPostOperations] } } },
      body: videoBodySchema,
    },
  }, async (request, reply) => {
    if (!videoPostOperations.has(request.params.operation)) return reply.code(404).send({ error: "Video operation is unavailable." });
    if (!isDatabaseReady() || !pool) return reply.code(503).send({ error: "The account database is unavailable." });
    if (!validateMutation(request, reply)) return reply;
    const operation = request.params.operation;
    const subOperation = typeof request.body.operation === "string" ? request.body.operation : "";
    const requiredPermission: VideoPermission = operation === "command" || operation === "restart-site"
      ? "streaming_operator"
      : operation === "encoder-settings"
        ? ["read", "read-preset", "xml-preview", "xml-target"].includes(subOperation) ? "video_basic" : "stream_admin"
        : operation === "videohub-route"
          ? "routing_user"
          : operation === "videohub-presets"
            ? ["lock", "rename", "delete"].includes(subOperation) ? "routing_admin" : ["save", "import", "recall"].includes(subOperation) ? "routing_user" : "video_basic"
            : "video_basic";
    const selectedDepartmentId = await activeVideoDepartment(request, reply, requiredPermission);
    if (!selectedDepartmentId) return reply;
    const worker = getVideoWorker();
    if (!worker) return reply.code(503).send({ error: "The video worker is not configured." });
    const { site: _site, actor: _actor, department_id: _departmentId, ...data } = request.body;
    try {
      return await requestVideo(request.params.operation, data, selectedDepartmentId, request.authenticatedUser!.username, 35_000);
    } catch (error) {
      const failure = error as Error & { code?: string };
      const status = failure.code === "UNAVAILABLE" ? 503 : failure.code === "TIMEOUT" ? 504 : failure.code === "BUSY" ? 429 : 400;
      return reply.code(status).send({ error: failure.message });
    }
  });
}
