import { createHash, randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ModuleServerContext } from "../module-sdk.js";

type JsonObject = Record<string, unknown>;
type PreviewResolution = "use_elvanto" | "keep_local" | "skip";
type PreviewRow = { sourceId: string; title: string; fingerprint: string; linked: boolean; resolution?: PreviewResolution; action: "import" | "update" | "already_linked" | "local_changed" | "baseline_missing" | "title_conflict" | "duplicate_source_title" | "changed" | "missing" };
const reviewActions = new Set<PreviewRow["action"]>(["local_changed", "baseline_missing", "title_conflict", "duplicate_source_title"]);
function text(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return String(value);
  return "";
}
function objectRows(value: unknown): JsonObject[] {
  if (Array.isArray(value)) return value.filter((row): row is JsonObject => Boolean(row) && typeof row === "object" && !Array.isArray(row));
  if (value && typeof value === "object") return Object.values(value).filter((row): row is JsonObject => Boolean(row) && typeof row === "object" && !Array.isArray(row));
  return [];
}
function fingerprint(song: unknown, arrangements: unknown): string {
  return createHash("sha256").update(JSON.stringify({ song, arrangements })).digest("hex");
}
function localFingerprint(song: { title: string; authors: string; default_key: string; notes: string; active: boolean; arrangements: JsonObject[] }): string {
  const arrangements = song.arrangements.map((row) => ({
    name: text(row.name), key: text(row.musical_key), chartUrl: text(row.chart_url), audioUrl: text(row.audio_url), active: row.active === true,
  })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return fingerprint({
    title: song.title, authors: song.authors, defaultKey: song.default_key, notes: song.notes, active: song.active,
  }, arrangements);
}
function normalizeTitle(value: string): string { return value.trim().normalize("NFKC").toLocaleLowerCase(); }
function mapKeys(arrangement: JsonObject) {
  const raw = arrangement.keys;
  const keys = Array.isArray(raw) ? raw.map((key, index) => typeof key === "string" ? { id: `key-${index + 1}`, name: key } : key as JsonObject)
    : objectRows(raw);
  return keys.length ? keys.map((key, index) => ({
    id: text(key.id) || text(key.key_id) || `key-${index + 1}`,
    name: text(key.name) || text(key.key) || text(key.value),
  })) : [{ id: "default", name: text(arrangement.musical_key) || text(arrangement.key) }];
}
function toArrangementName(name: string, key: string, keyCount: number): string {
  const suffix = keyCount > 1 && key ? ` (${key})` : "";
  return `${name.slice(0, Math.max(1, 160 - suffix.length))}${suffix}`;
}

export function registerElvantoSongLibraryRoutes(app: FastifyInstance, context: ModuleServerContext) {
  const { pool, isDatabaseReady, resolveDepartmentId, validateMutation } = context;
  app.register(async (routes) => {
    async function department(request: FastifyRequest, reply: FastifyReply) {
      if (!isDatabaseReady() || !pool) {
        reply.code(503).send({ error: "The song library import is unavailable because the database is not ready." });
        return null;
      }
      return resolveDepartmentId(request, reply, false, false, "events_manage");
    }

    async function checkDirection(departmentId: string, reply: FastifyReply) {
      const settings = await pool!.query<{ enabled: boolean; directions: Record<string, string> }>(
        "SELECT enabled,directions FROM elvanto_sync_settings WHERE department_id=$1", [departmentId],
      );
      const setting = settings.rows[0];
      if (!setting?.enabled) {
        reply.code(404).send({ error: "Connect and enable Elvanto Sync before importing songs into the library." });
        return false;
      }
      const direction = setting.directions?.songs;
      if (direction !== "elvanto_to_smart_church" && direction !== "bidirectional") {
        reply.code(400).send({ error: "Set Songs direction to Elvanto → Smart Church or bidirectional before importing to the library." });
        return false;
      }
      return true;
    }

    routes.get("/api/modules/sync/elvanto/songs-library-preview", async (request, reply) => {
      const departmentId = await department(request, reply);
      if (!departmentId) return reply;
      if (!await checkDirection(departmentId, reply)) return reply;
      const result = await pool!.query<{ preview_id: string; rows: PreviewRow[]; cursor: number; created_count: number; updated_count: number; skipped_count: number; review_count: number; expires_at: Date | string }>(
        "SELECT preview_id,rows,cursor,created_count,updated_count,skipped_count,review_count,expires_at FROM elvanto_worship_song_import_previews WHERE department_id=$1", [departmentId],
      );
      const saved = result.rows[0];
      if (!saved || new Date(saved.expires_at).getTime() <= Date.now()) return { preview: null };
      const rows = Array.isArray(saved.rows) ? saved.rows : [];
      const reviewCount = rows.filter((row) => reviewActions.has(row.action)).length;
      return {
        preview: {
          previewId: saved.preview_id, total: rows.length,
          importCount: rows.filter((row) => row.action === "import").length,
          updateCount: rows.filter((row) => row.action === "update").length,
          alreadyLinkedCount: rows.filter((row) => row.action === "already_linked").length,
          reviewCount, expiresAt: saved.expires_at,
        },
        progress: { cursor: Number(saved.cursor), total: rows.length, created: Number(saved.created_count), updated: Number(saved.updated_count), skipped: Number(saved.skipped_count), review: Number(saved.review_count), complete: Number(saved.cursor) >= rows.length, processedThisBatch: 0 },
      };
    });

    routes.post("/api/modules/sync/elvanto/songs-library-preview", async (request, reply) => {
      const departmentId = await department(request, reply);
      if (!departmentId) return reply;
      if (!validateMutation(request, reply)) return reply;
      if (!await checkDirection(departmentId, reply)) return reply;
      const [snapshots, linked, localSongs] = await Promise.all([
        pool!.query<{ source_id: string; title: string; song: JsonObject; arrangements: JsonObject[] }>(
          "SELECT source_id,title,song,arrangements FROM elvanto_songs_import WHERE department_id=$1 ORDER BY lower(title),source_id", [departmentId],
        ),
        pool!.query<{ source_song_id: string; song_id: string; source_fingerprint: string; local_fingerprint: string | null; title: string; authors: string; default_key: string; notes: string; active: boolean; arrangements: JsonObject[] }>(
          `SELECT link.source_song_id,link.song_id,link.source_fingerprint,link.local_fingerprint,song.title,song.authors,song.default_key,song.notes,song.active,
                  COALESCE(jsonb_agg(jsonb_build_object('name',arrangement.name,'musical_key',arrangement.musical_key,'chart_url',arrangement.chart_url,'audio_url',arrangement.audio_url,'active',arrangement.active)
                    ORDER BY lower(arrangement.name),arrangement.id) FILTER (WHERE arrangement.id IS NOT NULL),'[]'::jsonb) AS arrangements
             FROM elvanto_worship_song_links link
             JOIN worship_songs song ON song.id=link.song_id AND song.department_id=link.department_id
             LEFT JOIN worship_song_arrangements arrangement ON arrangement.song_id=song.id
            WHERE link.department_id=$1 GROUP BY link.source_song_id,link.song_id,link.source_fingerprint,link.local_fingerprint,song.id`, [departmentId],
        ),
        pool!.query<{ id: string; title: string }>("SELECT id,title FROM worship_songs WHERE department_id=$1 AND active=TRUE", [departmentId]),
      ]);
      const linkedBySource = new Map(linked.rows.map((row) => [row.source_song_id, row]));
      const localTitles = new Map(localSongs.rows.map((row) => [normalizeTitle(row.title), row.id]));
      const titleCounts = new Map<string, number>();
      for (const snapshot of snapshots.rows) {
        const title = text(snapshot.title);
        const key = normalizeTitle(title);
        if (key) titleCounts.set(key, (titleCounts.get(key) ?? 0) + 1);
      }
      const previewRows: PreviewRow[] = snapshots.rows.map((snapshot) => {
        const sourceId = text(snapshot.source_id);
        const title = text(snapshot.title);
        const titleKey = normalizeTitle(title);
        const link = linkedBySource.get(sourceId);
        let action: PreviewRow["action"];
        if (link) {
          const remoteChanged = link.source_fingerprint !== fingerprint(snapshot.song, snapshot.arrangements);
          const localChanged = Boolean(link.local_fingerprint && link.local_fingerprint !== localFingerprint(link));
          if (!remoteChanged) action = "already_linked";
          else if (!link.local_fingerprint) action = "baseline_missing";
          else if (localChanged) action = "local_changed";
          else action = "update";
          const titleOwner = localTitles.get(titleKey);
          if (action === "update" && titleOwner && titleOwner !== link.song_id) action = "title_conflict";
          if (action === "update" && (titleCounts.get(titleKey) ?? 0) > 1) action = "duplicate_source_title";
        } else if ((titleCounts.get(titleKey) ?? 0) > 1) action = "duplicate_source_title";
        else if (localTitles.has(titleKey)) action = "title_conflict";
        else action = "import";
        return { sourceId, title, fingerprint: fingerprint(snapshot.song, snapshot.arrangements), linked: Boolean(link), action };
      });
      const snapshotIds = new Set(snapshots.rows.map((snapshot) => text(snapshot.source_id)));
      for (const link of linked.rows) {
        if (!snapshotIds.has(link.source_song_id)) previewRows.push({ sourceId: link.source_song_id, title: link.title, fingerprint: link.source_fingerprint, linked: true, action: "missing" });
      }
      const encoded = JSON.stringify(previewRows);
      if (Buffer.byteLength(encoded) > 50 * 1024 * 1024) return reply.code(413).send({ error: "The song import preview exceeds 50 MiB. Import fewer Elvanto songs and create a new preview." });
      const previewId = randomUUID();
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      await pool!.query(
        `INSERT INTO elvanto_worship_song_import_previews(department_id,preview_id,rows,cursor,created_count,updated_count,review_count,expires_at,updated_at)
         VALUES($1,$2,$3::jsonb,0,0,0,0,$4,now())
         ON CONFLICT(department_id) DO UPDATE SET preview_id=EXCLUDED.preview_id,rows=EXCLUDED.rows,cursor=0,created_count=0,updated_count=0,skipped_count=0,review_count=0,expires_at=EXCLUDED.expires_at,updated_at=now()`,
        [departmentId, previewId, encoded, expiresAt],
      );
      const importCount = previewRows.filter((row) => row.action === "import").length;
      const updateCount = previewRows.filter((row) => row.action === "update").length;
      const alreadyLinkedCount = previewRows.filter((row) => row.action === "already_linked").length;
      const reviewCount = previewRows.length - importCount - updateCount - alreadyLinkedCount;
      await pool!.query(
        "INSERT INTO elvanto_sync_audit(department_id,area,action,outcome,details) VALUES($1,'songs','preview','success',$2::jsonb)",
        [departmentId, JSON.stringify({ total: previewRows.length, create: importCount, update: updateCount, alreadyLinked: alreadyLinkedCount, review: reviewCount })],
      ).catch(() => {});
      return { previewId, total: previewRows.length, importCount, updateCount, alreadyLinkedCount, reviewCount, expiresAt, sample: previewRows.slice(0, 50).map(({ sourceId, title, action }) => ({ sourceId, title, action })) };
    });

    routes.get<{ Params: { previewId: string }; Querystring: { offset?: number; limit?: number } }>("/api/modules/sync/elvanto/songs-library-preview/:previewId", {
      schema: {
        params: { type: "object", additionalProperties: false, required: ["previewId"], properties: { previewId: { type: "string", format: "uuid" } } },
        querystring: { type: "object", additionalProperties: false, properties: { offset: { type: "integer", minimum: 0, maximum: 1000000 }, limit: { type: "integer", minimum: 1, maximum: 100 } } },
      },
    }, async (request, reply) => {
      const departmentId = await department(request, reply);
      if (!departmentId) return reply;
      if (!await checkDirection(departmentId, reply)) return reply;
      const result = await pool!.query<{ preview_id: string; rows: PreviewRow[]; cursor: number; expires_at: Date | string }>(
        "SELECT preview_id,rows,cursor,expires_at FROM elvanto_worship_song_import_previews WHERE department_id=$1", [departmentId],
      );
      const preview = result.rows[0];
      if (!preview || preview.preview_id !== request.params.previewId) return reply.code(404).send({ error: "Create a fresh song-library preview before reviewing rows." });
      if (new Date(preview.expires_at).getTime() <= Date.now()) return reply.code(409).send({ error: "The song-library preview expired. Create a fresh preview before importing." });
      const rows = Array.isArray(preview.rows) ? preview.rows : [];
      const offset = request.query.offset ?? 0;
      const limit = request.query.limit ?? 50;
      return { previewId: preview.preview_id, offset, total: rows.length, cursor: Number(preview.cursor), rows: rows.slice(offset, offset + limit).map(({ sourceId, title, action, linked, resolution }) => ({ sourceId, title, action, linked, resolution: resolution ?? null })) };
    });

    routes.put<{ Body: { previewId: string; sourceId: string; resolution: PreviewResolution } }>("/api/modules/sync/elvanto/songs-library-resolution", {
      schema: { body: { type: "object", additionalProperties: false, required: ["previewId", "sourceId", "resolution"], properties: { previewId: { type: "string", format: "uuid" }, sourceId: { type: "string", minLength: 1, maxLength: 200 }, resolution: { type: "string", enum: ["use_elvanto", "keep_local", "skip"] } } } },
    }, async (request, reply) => {
      const departmentId = await department(request, reply);
      if (!departmentId) return reply;
      if (!validateMutation(request, reply)) return reply;
      if (!await checkDirection(departmentId, reply)) return reply;
      const client = await pool!.connect();
      try {
        await client.query("BEGIN");
        const selected = await client.query<{ preview_id: string; rows: PreviewRow[]; cursor: number; expires_at: Date | string }>(
          "SELECT preview_id,rows,cursor,expires_at FROM elvanto_worship_song_import_previews WHERE department_id=$1 FOR UPDATE", [departmentId],
        );
        const preview = selected.rows[0];
        if (!preview || preview.preview_id !== request.body.previewId) { await client.query("ROLLBACK"); return reply.code(409).send({ error: "Create a fresh song-library preview before reviewing rows." }); }
        if (new Date(preview.expires_at).getTime() <= Date.now()) { await client.query("ROLLBACK"); return reply.code(409).send({ error: "The song-library preview expired. Create a fresh preview before importing." }); }
        const rows = Array.isArray(preview.rows) ? preview.rows : [];
        const index = rows.findIndex((row) => row.sourceId === request.body.sourceId);
        if (index < Number(preview.cursor)) { await client.query("ROLLBACK"); return reply.code(409).send({ error: "This song row has already been processed. Create a fresh preview to change its resolution." }); }
        const row = rows[index];
        if (!row || !reviewActions.has(row.action)) { await client.query("ROLLBACK"); return reply.code(400).send({ error: "This song row does not need a conflict resolution." }); }
        const { resolution } = request.body;
        if (resolution === "use_elvanto" && !(row.linked && ["local_changed", "baseline_missing"].includes(row.action))) { await client.query("ROLLBACK"); return reply.code(400).send({ error: "Use Elvanto is available only for a linked song with local changes or a missing baseline." }); }
        if (resolution === "keep_local" && !row.linked) { await client.query("ROLLBACK"); return reply.code(400).send({ error: "Keep local is available only for a song already linked to Elvanto." }); }
        row.resolution = resolution;
        await client.query("UPDATE elvanto_worship_song_import_previews SET rows=$2::jsonb,updated_at=now() WHERE department_id=$1", [departmentId, JSON.stringify(rows)]);
        await client.query("INSERT INTO elvanto_sync_audit(department_id,area,action,outcome,details) VALUES($1,'songs','conflict_resolution','success',$2::jsonb)", [departmentId, JSON.stringify({ resolution })]);
        await client.query("COMMIT");
        return { sourceId: row.sourceId, resolution: row.resolution };
      } catch (error) { await client.query("ROLLBACK"); throw error; }
      finally { client.release(); }
    });

    routes.post<{ Body: { previewId: string } }>("/api/modules/sync/elvanto/songs-library-import", {
      schema: { body: { type: "object", additionalProperties: false, required: ["previewId"], properties: { previewId: { type: "string", format: "uuid" } } } },
    }, async (request, reply) => {
      const departmentId = await department(request, reply);
      if (!departmentId) return reply;
      if (!validateMutation(request, reply)) return reply;
      if (!await checkDirection(departmentId, reply)) return reply;
      const client = await pool!.connect();
      try {
        await client.query("BEGIN");
        const selected = await client.query<{ preview_id: string; rows: PreviewRow[]; cursor: number; created_count: number; updated_count: number; skipped_count: number; review_count: number; expires_at: Date | string }>(
          "SELECT preview_id,rows,cursor,created_count,updated_count,skipped_count,review_count,expires_at FROM elvanto_worship_song_import_previews WHERE department_id=$1 FOR UPDATE", [departmentId],
        );
        const preview = selected.rows[0];
        if (!preview || preview.preview_id !== request.body.previewId) {
          await client.query("ROLLBACK");
          return reply.code(409).send({ error: "Create a fresh song-library preview before importing." });
        }
        if (new Date(preview.expires_at).getTime() <= Date.now()) {
          await client.query("ROLLBACK");
          return reply.code(409).send({ error: "The song-library preview expired. Create a fresh preview before importing." });
        }
        const previewRows = Array.isArray(preview.rows) ? preview.rows : [];
        const unresolved = previewRows.filter((row) => reviewActions.has(row.action) && !row.resolution).length;
        if (unresolved) { await client.query("ROLLBACK"); return reply.code(409).send({ error: "Review or skip all song conflicts before importing.", unresolvedCount: unresolved }); }
        let cursor = Number(preview.cursor);
        let createdCount = Number(preview.created_count);
        let updatedCount = Number(preview.updated_count);
        let skippedCount = Number(preview.skipped_count);
        let reviewCount = Number(preview.review_count);
        let processed = 0;
        const limit = Math.min(cursor + 5, previewRows.length);
        for (; cursor < limit; cursor += 1) {
          const row = previewRows[cursor];
          processed += 1;
          if (row.resolution === "skip") { skippedCount += 1; continue; }
          if (row.action === "already_linked") continue;
          if (row.action !== "import" && row.action !== "update" && !(row.linked && row.resolution === "use_elvanto")) { reviewCount += 1; continue; }
          const snapshotResult = await client.query<{ source_id: string; title: string; song: JsonObject; arrangements: JsonObject[] }>(
            "SELECT source_id,title,song,arrangements FROM elvanto_songs_import WHERE department_id=$1 AND source_id=$2 FOR SHARE", [departmentId, row.sourceId],
          );
          const snapshot = snapshotResult.rows[0];
          if (!snapshot || fingerprint(snapshot.song, snapshot.arrangements) !== row.fingerprint || text(snapshot.title) !== row.title) {
            row.action = snapshot ? "changed" : "missing";
            reviewCount += 1;
            continue;
          }
          const existingLink = await client.query("SELECT 1 FROM elvanto_worship_song_links WHERE department_id=$1 AND source_song_id=$2", [departmentId, row.sourceId]);
          if (existingLink.rowCount && row.action === "import") { row.action = "already_linked"; continue; }

          const forceRemote = row.resolution === "use_elvanto";
          if (row.resolution === "keep_local") {
            const linkResult = await client.query<{ song_id: string }>("SELECT song_id FROM elvanto_worship_song_links WHERE department_id=$1 AND source_song_id=$2 FOR UPDATE", [departmentId, row.sourceId]);
            const link = linkResult.rows[0];
            if (!link) { row.action = "missing"; reviewCount += 1; continue; }
            const localResult = await client.query<{ id: string; title: string; authors: string; default_key: string; notes: string; active: boolean }>("SELECT id,title,authors,default_key,notes,active FROM worship_songs WHERE department_id=$1 AND id=$2 FOR UPDATE", [departmentId, link.song_id]);
            const localSong = localResult.rows[0];
            if (!localSong) { row.action = "missing"; reviewCount += 1; continue; }
            const arrangements = await client.query<{ id: string; name: string; musical_key: string; chart_url: string; audio_url: string; active: boolean }>("SELECT id,name,musical_key,chart_url,audio_url,active FROM worship_song_arrangements WHERE song_id=$1 ORDER BY lower(name),id FOR UPDATE", [localSong.id]);
            const currentLocal = { ...localSong, arrangements: arrangements.rows as unknown as JsonObject[] };
            await client.query("UPDATE elvanto_worship_song_links SET source_fingerprint=$3,local_fingerprint=$4 WHERE department_id=$1 AND source_song_id=$2", [departmentId, row.sourceId, row.fingerprint, localFingerprint(currentLocal)]);
            skippedCount += 1;
            continue;
          }

          const songData = snapshot.song ?? {};
          const authors = text(songData.artist) || text(songData.author) || text(songData.authors);
          const notes = text(songData.notes).slice(0, 2000);
          const arrangementRows = objectRows(snapshot.arrangements);
          const firstArrangement = arrangementRows[0];
          const firstKey = firstArrangement ? mapKeys(firstArrangement)[0] : null;
          const defaultKey = firstKey?.name.slice(0, 16) ?? "";

          if (row.action === "update" || forceRemote) {
            const linkResult = await client.query<{ song_id: string; local_fingerprint: string | null }>(
              "SELECT song_id,local_fingerprint FROM elvanto_worship_song_links WHERE department_id=$1 AND source_song_id=$2 FOR UPDATE", [departmentId, row.sourceId],
            );
            const link = linkResult.rows[0];
            if (!link || (!link.local_fingerprint && !forceRemote)) { row.action = "baseline_missing"; reviewCount += 1; continue; }
            const currentSource = await client.query<{ source_fingerprint: string }>("SELECT source_fingerprint FROM elvanto_worship_song_links WHERE department_id=$1 AND source_song_id=$2", [departmentId, row.sourceId]);
            if (currentSource.rows[0]?.source_fingerprint === row.fingerprint) { row.action = "already_linked"; continue; }
            const localResult = await client.query<{ id: string; title: string; authors: string; default_key: string; notes: string; active: boolean }>(
              "SELECT id,title,authors,default_key,notes,active FROM worship_songs WHERE department_id=$1 AND id=$2 FOR UPDATE", [departmentId, link.song_id],
            );
            const localSong = localResult.rows[0];
            if (!localSong) { row.action = "missing"; reviewCount += 1; continue; }
            const localArrangementResult = await client.query<{ id: string; name: string; musical_key: string; chart_url: string; audio_url: string; active: boolean }>(
              "SELECT id,name,musical_key,chart_url,audio_url,active FROM worship_song_arrangements WHERE song_id=$1 ORDER BY lower(name),id FOR UPDATE", [localSong.id],
            );
            const currentLocal = { ...localSong, arrangements: localArrangementResult.rows as unknown as JsonObject[] };
            if (localFingerprint(currentLocal) !== link.local_fingerprint && !forceRemote) { row.action = "local_changed"; reviewCount += 1; continue; }
            const titleCollision = await client.query("SELECT 1 FROM worship_songs WHERE department_id=$1 AND active=TRUE AND id<>$2 AND lower(title)=lower($3) LIMIT 1", [departmentId, localSong.id, row.title]);
            if (titleCollision.rowCount) { row.action = "title_conflict"; reviewCount += 1; continue; }

            await client.query(
              "UPDATE worship_songs SET title=$3,authors=$4,default_key=$5,notes=$6,active=TRUE,updated_at=now() WHERE department_id=$1 AND id=$2",
              [departmentId, localSong.id, row.title.slice(0, 200), authors.slice(0, 500), defaultKey, notes],
            );
            const mappingResult = await client.query<{ source_arrangement_id: string; source_key_id: string; arrangement_id: string }>(
              "SELECT source_arrangement_id,source_key_id,arrangement_id FROM elvanto_worship_arrangement_links WHERE department_id=$1 AND source_song_id=$2 FOR UPDATE", [departmentId, row.sourceId],
            );
            const mappingBySource = new Map(mappingResult.rows.map((mapping) => [`${mapping.source_arrangement_id}\0${mapping.source_key_id}`, mapping.arrangement_id]));
            const localArrangements = [...localArrangementResult.rows];
            for (const sourceArrangement of arrangementRows) {
              const remoteArrangementId = text(sourceArrangement.id);
              if (!remoteArrangementId) continue;
              const name = text(sourceArrangement.name) || text(sourceArrangement.title) || "Arrangement";
              const keys = mapKeys(sourceArrangement);
              for (const key of keys) {
                const mappingKey = `${remoteArrangementId}\0${key.id}`;
                const arrangementId = mappingBySource.get(mappingKey);
                const arrangementName = toArrangementName(name, key.name, keys.length);
                const chartUrl = text(sourceArrangement.chart_url).startsWith("https://") ? text(sourceArrangement.chart_url).slice(0, 2048) : "";
                const audioUrl = text(sourceArrangement.audio_url).startsWith("https://") ? text(sourceArrangement.audio_url).slice(0, 2048) : "";
                if (arrangementId) {
                  const updatedArrangement = await client.query("UPDATE worship_song_arrangements SET name=$3,musical_key=$4,chart_url=$5,audio_url=$6,active=TRUE,updated_at=now() WHERE id=$1 AND song_id=$2 RETURNING id", [arrangementId, localSong.id, arrangementName, key.name.slice(0, 16), chartUrl, audioUrl]);
                  if (!updatedArrangement.rowCount) throw new Error("A linked local arrangement is missing. Review the song before importing updates.");
                  const localIndex = localArrangements.findIndex((entry) => entry.id === arrangementId);
                  const value = { id: arrangementId, name: arrangementName, musical_key: key.name.slice(0, 16), chart_url: chartUrl, audio_url: audioUrl, active: true };
                  if (localIndex >= 0) localArrangements[localIndex] = value;
                  else localArrangements.push(value);
                } else {
                  const newArrangementId = randomUUID();
                  await client.query("INSERT INTO worship_song_arrangements(id,song_id,name,musical_key,chart_url,audio_url) VALUES($1,$2,$3,$4,$5,$6)", [newArrangementId, localSong.id, arrangementName, key.name.slice(0, 16), chartUrl, audioUrl]);
                  await client.query("INSERT INTO elvanto_worship_arrangement_links(department_id,source_song_id,source_arrangement_id,source_key_id,arrangement_id) VALUES($1,$2,$3,$4,$5)", [departmentId, row.sourceId, remoteArrangementId, key.id, newArrangementId]);
                  localArrangements.push({ id: newArrangementId, name: arrangementName, musical_key: key.name.slice(0, 16), chart_url: chartUrl, audio_url: audioUrl, active: true });
                }
              }
            }
            const updatedLocal = { ...localSong, title: row.title.slice(0, 200), authors: authors.slice(0, 500), default_key: defaultKey, notes, active: true, arrangements: localArrangements as unknown as JsonObject[] };
            const updatedLocalFingerprint = localFingerprint(updatedLocal);
            await client.query("UPDATE elvanto_worship_song_links SET source_fingerprint=$3,local_fingerprint=$4 WHERE department_id=$1 AND source_song_id=$2", [departmentId, row.sourceId, row.fingerprint, updatedLocalFingerprint]);
            updatedCount += 1;
            continue;
          }

          const collision = await client.query("SELECT 1 FROM worship_songs WHERE department_id=$1 AND active=TRUE AND lower(title)=lower($2) LIMIT 1", [departmentId, row.title]);
          if (collision.rowCount) { row.action = "title_conflict"; reviewCount += 1; continue; }

          const songId = randomUUID();
          await client.query(
            "INSERT INTO worship_songs(id,department_id,title,authors,default_key,notes) VALUES($1,$2,$3,$4,$5,$6)",
            [songId, departmentId, row.title.slice(0, 200), authors.slice(0, 500), defaultKey, notes],
          );
          await client.query(
            "INSERT INTO elvanto_worship_song_links(department_id,source_song_id,song_id,source_fingerprint) VALUES($1,$2,$3,$4)",
            [departmentId, row.sourceId, songId, row.fingerprint],
          );
          const importedLocalArrangements: JsonObject[] = [];
          for (const sourceArrangement of arrangementRows) {
            const remoteArrangementId = text(sourceArrangement.id);
            if (!remoteArrangementId) continue;
            const name = text(sourceArrangement.name) || text(sourceArrangement.title) || "Arrangement";
            const keys = mapKeys(sourceArrangement);
            for (const key of keys) {
              const arrangementId = randomUUID();
              const arrangementName = toArrangementName(name, key.name, keys.length);
              const chartUrl = text(sourceArrangement.chart_url);
              const audioUrl = text(sourceArrangement.audio_url);
              const storedChartUrl = chartUrl.startsWith("https://") ? chartUrl.slice(0, 2048) : "";
              const storedAudioUrl = audioUrl.startsWith("https://") ? audioUrl.slice(0, 2048) : "";
              await client.query(
                "INSERT INTO worship_song_arrangements(id,song_id,name,musical_key,chart_url,audio_url) VALUES($1,$2,$3,$4,$5,$6)",
                [arrangementId, songId, arrangementName, key.name.slice(0, 16), storedChartUrl, storedAudioUrl],
              );
              importedLocalArrangements.push({ id: arrangementId, name: arrangementName, musical_key: key.name.slice(0, 16), chart_url: storedChartUrl, audio_url: storedAudioUrl, active: true });
              await client.query(
                "INSERT INTO elvanto_worship_arrangement_links(department_id,source_song_id,source_arrangement_id,source_key_id,arrangement_id) VALUES($1,$2,$3,$4,$5)",
                [departmentId, row.sourceId, remoteArrangementId, key.id, arrangementId],
              );
            }
          }
          await client.query("UPDATE elvanto_worship_song_links SET local_fingerprint=$3 WHERE department_id=$1 AND source_song_id=$2", [departmentId, row.sourceId, localFingerprint({ title: row.title.slice(0, 200), authors: authors.slice(0, 500), default_key: defaultKey, notes, active: true, arrangements: importedLocalArrangements })]);
          createdCount += 1;
        }
        const complete = cursor >= previewRows.length;
        await client.query(
          "UPDATE elvanto_worship_song_import_previews SET rows=$2::jsonb,cursor=$3,created_count=$4,updated_count=$5,skipped_count=$6,review_count=$7,updated_at=now() WHERE department_id=$1",
          [departmentId, JSON.stringify(previewRows), cursor, createdCount, updatedCount, skippedCount, reviewCount],
        );
        await client.query("INSERT INTO elvanto_sync_audit(department_id,area,action,outcome,details) VALUES($1,'songs','import',$2,$3::jsonb)", [departmentId, cursor >= previewRows.length ? "complete" : "success", JSON.stringify({ processed, created: createdCount - Number(preview.created_count), updated: updatedCount - Number(preview.updated_count), skipped: skippedCount - Number(preview.skipped_count), review: reviewCount - Number(preview.review_count), complete: cursor >= previewRows.length })]);
        await client.query("COMMIT");
        return { import: { cursor, total: previewRows.length, created: createdCount, updated: updatedCount, skipped: skippedCount, review: reviewCount, complete, processedThisBatch: processed } };
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally { client.release(); }
    });
  });
}
