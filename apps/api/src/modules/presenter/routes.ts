import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Pool } from "pg";
import type { ServerResponse } from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { datasetArchive, deleteDataset, installDatasetArchive, installLibraryPicture, installPresentationDataset, listDatasets, readDataset, readDatasetAsset, readDatasetHtmlAsset } from "./datasets.js";
import { deletePresenterMedia, installPresenterMedia, listPresenterMedia, readPresenterMedia } from "./media.js";
import { readPowerPointSlides } from "./pptx-import.js";
import type { ModuleServerContext } from "../module-sdk.js";
import { registerPresenterReplication } from "./replication.js";

const presenterSessions = [
  { id: "main", name: "Main" },
  ...Array.from({ length: 10 }, (_, index) => ({ id: `aux${index + 1}`, name: `Aux ${index + 1}` })),
];
const sessionIds = new Set(presenterSessions.map(({ id }) => id));
const presenterMediaUploadLimit = 1024 * 1024 * 1024;
const aktuellAssetVersion = "20261025-layout-6";
const outputTokenHash = (token: string) => createHash("sha256").update(token).digest("hex");

export function registerModuleRoutes(app: FastifyInstance, dependencies: ModuleServerContext) {
  const { pool, isDatabaseReady, getDefaultDepartmentId, resolveDepartmentId, validateMutation } = dependencies;
  registerPresenterReplication(dependencies);
  type OutputClient = { response: ServerResponse; token: string; revision: number; close: () => void };
  const outputClients = new Map<string, Set<OutputClient>>();

  function publicOutputState(state: Record<string, any>, token: string) {
    const slide = state.slide;
    if (state.visible && slide?.type === "media") {
      const mediaUrl = `/api/modules/presenter/public/output/${encodeURIComponent(token)}/media/${encodeURIComponent(slide.mediaId)}`;
      return { ...state, slide: { ...slide, mediaUrl } };
    }
    if (state.visible && (slide?.type === "image" || slide?.type === "html")) {
      const assetName = slide.asset.slice("pages/".length);
      const assetUrl = `/api/modules/presenter/public/output/${encodeURIComponent(token)}/assets/${encodeURIComponent(state.datasetId)}/${encodeURIComponent(assetName)}${state.datasetId === "aktuell" ? `?v=${aktuellAssetVersion}` : ""}`;
      return { ...state, slide: slide.type === "image" ? { ...slide, imageUrl: assetUrl } : { ...slide, htmlUrl: assetUrl } };
    }
    return state;
  }

  function publishOutputState(tokenHash: string, state: Record<string, any>) {
    const clients = outputClients.get(tokenHash);
    if (!clients) return;
    for (const client of clients) {
      client.revision += 1;
      const event = JSON.stringify({ state: publicOutputState(state, client.token), sentAt: Date.now() });
      if (!client.response.write(`data: ${event}\n\n`)) client.response.end();
    }
  }

  app.register(async (app) => {
    app.addContentTypeParser("application/gzip", { parseAs: "buffer", bodyLimit: 256 * 1024 * 1024 }, (_request, body, done) => done(null, body));
    app.addContentTypeParser("application/vnd.openxmlformats-officedocument.presentationml.presentation", { parseAs: "buffer", bodyLimit: 64 * 1024 * 1024 }, (_request, body, done) => done(null, body));
    app.addContentTypeParser("application/octet-stream", { parseAs: "buffer", bodyLimit: presenterMediaUploadLimit }, (_request, body, done) => done(null, body));
    app.addContentTypeParser("image/png", { parseAs: "buffer", bodyLimit: 100 * 1024 * 1024 }, (_request, body, done) => done(null, body));
    for (const mediaType of ["image/jpeg", "image/webp"]) {
      app.addContentTypeParser(mediaType, { parseAs: "buffer", bodyLimit: 100 * 1024 * 1024 }, (_request, body, done) => done(null, body));
    }
    for (const mediaType of ["video/mp4", "video/webm", "video/x-msvideo", "video/x-ms-wmv"]) {
      app.addContentTypeParser(mediaType, { parseAs: "buffer", bodyLimit: presenterMediaUploadLimit }, (_request, body, done) => done(null, body));
    }
  
    async function activePresenterDepartment(request: FastifyRequest, reply: FastifyReply, requiredAccess: "access" | "operator" | "admin" = "access", allowQueryLocation = false) {
      if (!isDatabaseReady() || !pool) {
        reply.code(503).send({ error: "The account database is unavailable." });
        return null;
      }
      const selectedId = await resolveDepartmentId(request, reply, false, allowQueryLocation);
      if (!selectedId) return null;
      const result = await pool.query(
        `SELECT d.enabled_modules, m.role, m.presenter_permissions, m.module_permissions
           FROM departments d
           JOIN department_memberships m ON m.department_id = d.id
          WHERE d.id = $1 AND m.user_id = $2`,
        [selectedId, request.authenticatedUser?.id],
      );
      const access = result.rows[0];
      if (!access?.enabled_modules?.includes("presenter")) {
        reply.code(404).send({ error: "Presenter is not enabled for this location." });
        return null;
      }
      const permissions = new Set<string>(access.module_permissions?.presenter ?? access.presenter_permissions ?? []);
      const isAdmin = access.role === "site_admin" || permissions.has("admin");
      if (!isAdmin && permissions.size === 0) {
        reply.code(403).send({ error: "Presenter access is required." });
        return null;
      }
      const isOperator = isAdmin || permissions.has("operator");
      if (requiredAccess === "admin" && !isAdmin) {
        reply.code(403).send({ error: "Presenter administrator access is required." });
        return null;
      }
      if (requiredAccess === "operator" && !isOperator) {
        reply.code(403).send({ error: "Presenter operator access is required." });
        return null;
      }
      return selectedId;
    }

    async function ensurePresenterSessions(department: string) {
      await pool!.query(
        `INSERT INTO presenter_output_sessions (department_id, session_id, display_name)
         SELECT $1, session_id, display_name FROM unnest($2::text[], $3::text[]) AS sessions(session_id, display_name)
         ON CONFLICT (department_id, session_id) DO NOTHING`,
        [department, presenterSessions.map(({ id }) => id), presenterSessions.map(({ name }) => name)],
      );
    }

    async function readPublicSession(token: string) {
      const hash = outputTokenHash(token);
      const session = await pool?.query<{ department_id: string }>(`SELECT s.department_id FROM presenter_output_sessions s JOIN departments d ON d.id=s.department_id
        WHERE (s.token_hash=$1 OR s.previous_token_hash=$1) AND d.enabled_modules @> ARRAY['presenter']::text[]`, [hash]);
      if (!session?.rowCount) return undefined;
      if (await dependencies.isDepartmentWritable(session.rows[0].department_id)) {
        const touched = await pool?.query(
          `UPDATE presenter_output_sessions s SET last_seen_at = now()
            WHERE s.department_id=$2 AND (s.token_hash=$1 OR s.previous_token_hash=$1)
              AND (s.last_seen_at IS NULL OR s.last_seen_at < now() - interval '5 seconds')
           RETURNING s.state`,
          [hash, session.rows[0].department_id],
        );
        if (touched?.rows[0]) return touched.rows[0].state;
      }
      const current = await pool?.query(
        `SELECT s.state FROM presenter_output_sessions s JOIN departments d ON d.id = s.department_id
         WHERE (s.token_hash = $1 OR s.previous_token_hash = $1) AND d.enabled_modules @> ARRAY['presenter']::text[]`,
        [hash],
      );
      return current?.rows[0]?.state;
    }

    async function aktuellSchedule(department: string) {
      const site = await pool!.query<{ time_zone: string }>("SELECT time_zone FROM departments WHERE id=$1", [department]);
      const timeZone = site.rows[0]?.time_zone || "Europe/Zurich";
      const now = new Date();
      const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
      const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "00";
      const startDate = `${part("year")}-${part("month")}-${part("day")}`;
      const currentTime = `${part("hour")}:${part("minute")}`;
      const startUtc = new Date(`${startDate}T00:00:00Z`);
      // Include the coming week as well as the week leading up to the next Sunday.
      const endUtc = new Date(startUtc.getTime() + 14 * 86400000);
      const endDate = endUtc.toISOString().slice(0, 10);
      const result = await pool!.query<{ id: string; title: string; kind: string; event_date: string; start_time: string; end_time: string | null; location: string; room: string; description: string | null }>(
        `SELECT id,title,kind,event_date::text,to_char(start_time,'HH24:MI') AS start_time,
                CASE WHEN end_time IS NULL THEN NULL ELSE to_char(end_time,'HH24:MI') END AS end_time,
                location,room,description
           FROM service_events
          WHERE department_id=$1 AND event_date >= $2::date AND event_date <= $3::date
            AND (event_date > $2::date OR COALESCE(end_time,start_time) >= $4::time)
          ORDER BY event_date,start_time,title`,
        [department, startDate, endDate, currentTime],
      );
      return { timeZone, startDate, endDate, events: result.rows };
    }

    const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[character]!);
    function aktuellSlideHtml(schedule: Awaited<ReturnType<typeof aktuellSchedule>>) {
      const slideText = (value: string) => value.replace(/\bchurch\s*tools\b/gi, "").replace(/[ \t]{2,}/g, " ").replace(/^\s*[:|–—-]\s*|\s*[:|–—-]\s*$/g, "").trim();
      const dateParts = (value: string) => {
        const date = new Date(`${value}T12:00:00Z`);
        return {
          date: new Intl.DateTimeFormat("de-CH", { day: "2-digit", month: "2-digit", year: "2-digit", timeZone: "UTC" }).format(date),
          weekday: new Intl.DateTimeFormat("de-CH", { weekday: "short", timeZone: "UTC" }).format(date),
        };
      };
      const grouped = new Map<string, typeof schedule.events>();
      for (const event of schedule.events) grouped.set(event.event_date, [...(grouped.get(event.event_date) ?? []), event]);
      const items = [...grouped].map(([eventDate, events]) => {
        const date = dateParts(eventDate);
        const rows = events.map((event) => {
          const location = slideText(event.room && event.location && event.room !== event.location ? `${event.room} · ${event.location}` : event.room || event.location);
          const title = slideText(event.title);
          return `<article class="event"><time datetime="${escapeHtml(event.event_date)}T${escapeHtml(event.start_time)}">${escapeHtml(event.start_time)}${event.end_time ? `–${escapeHtml(event.end_time)}` : ""}</time><div class="event-info">${title ? `<strong>${escapeHtml(title)}</strong>` : ""}${location ? `<small>${escapeHtml(location)}</small>` : ""}</div></article>`;
        }).join("");
        return `<section class="day-group"><time class="day-date" datetime="${escapeHtml(eventDate)}"><strong>${escapeHtml(date.weekday)}</strong><span>${escapeHtml(date.date)}</span></time><div class="day-events">${rows}</div></section>`;
      }).join("");
      const empty = `<div class="empty">Keine Veranstaltungen geplant</div>`;
      return `<!doctype html>
<html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
*{box-sizing:border-box}html,body{width:100%;height:100%;margin:0;overflow:hidden;background:#fff;color:#45443f;font-family:Arial,Helvetica,sans-serif}.slide{display:flex;width:100vw;height:100vh;overflow:hidden;background:#fff}.intro{position:relative;display:flex;flex:0 0 24%;flex-direction:column;justify-content:space-between;min-width:0;overflow:hidden;padding:5vh 3.1vw 4.5vh 4vw;background:linear-gradient(160deg,#f2ddc3 0%,#f5e9d3 50%,#eddbb7 100%)}.intro-art{position:absolute;inset:0;width:100%;height:100%;opacity:.82}.intro-copy,.church-brand{position:relative;z-index:1}.intro-copy h1{max-width:470px;margin:0;color:#a27b54;font-family:'Arial Narrow',Arial,sans-serif;font-size:clamp(27px,3.45vw,54px);font-weight:300;line-height:1.15;letter-spacing:.055em;text-transform:uppercase}.intro-copy p{margin:12px 0 0;color:#b49767;font-family:Georgia,'Times New Roman',serif;font-size:clamp(13px,1.25vw,19px);letter-spacing:.05em;text-transform:uppercase}.church-brand{display:flex;align-items:center;gap:12px;color:#fff;text-shadow:0 1px 4px #44371f70}.church-mark{display:grid;place-items:center;width:41px;height:45px;font-size:42px;font-weight:300;line-height:1}.church-brand strong,.church-brand span{display:block}.church-brand strong{font-family:Georgia,'Times New Roman',serif;font-size:clamp(14px,1.55vw,23px);font-weight:600}.church-brand span{margin-top:2px;font-size:clamp(10px,1vw,14px);letter-spacing:.03em}.schedule{display:flex;flex:1;min-width:0;flex-direction:column;padding:1vh .8vw 2vh .7vw;background:#fff}.events{display:flex;flex:1;min-height:0;flex-direction:column}.day-group{display:grid;grid-template-columns:minmax(72px,9%) minmax(0,1fr);flex:1;min-height:0;border-bottom:1px solid #d6dfd9}.day-date{display:flex;flex-direction:column;justify-content:flex-start;gap:5px;padding:12px 10px;color:#8d9b94;font-size:clamp(11px,1.05vw,15px);font-variant-numeric:tabular-nums}.day-date strong{font-weight:500}.day-date span{font-weight:600}.day-events{display:flex;min-width:0;flex-direction:column}.event{display:grid;grid-template-columns:minmax(68px,9%) minmax(0,1fr);align-items:center;gap:7px;flex:1;min-height:31px;padding:5px 8px;border-bottom:1px solid #edf0ed}.event:last-child{border-bottom:0}.event time{color:#8c9a92;font-size:clamp(10px,1vw,14px);font-variant-numeric:tabular-nums;white-space:nowrap}.event-info{display:grid;gap:3px;min-width:0}.event-info strong{color:#78877f;font-size:clamp(11px,1.03vw,15px);font-weight:500;line-height:1.2;overflow-wrap:anywhere}.event-info small{color:#9ca69f;font-size:clamp(9px,.85vw,12px)}.empty{display:grid;flex:1;place-items:center;color:#9aa49e;font-family:Georgia,'Times New Roman',serif;font-size:clamp(19px,2.2vw,30px)}.dense .schedule{padding-top:0;padding-bottom:1vh}.dense .day-date{gap:3px;padding:7px 7px;font-size:clamp(9px,.85vw,12px)}.dense .event{min-height:24px;gap:8px;padding:3px 5px}.dense .event time,.dense .event-info strong{font-size:clamp(9px,.82vw,12px)}.dense .event-info small{font-size:clamp(8px,.72vw,10px)}@media(max-aspect-ratio:4/3){.intro{flex-basis:27%;padding-left:2vw;padding-right:1vw}.schedule{padding-left:.7vw;padding-right:.7vw}.day-group{grid-template-columns:minmax(62px,11%) minmax(0,1fr)}.event{grid-template-columns:minmax(56px,11%) minmax(0,1fr);gap:5px}}
</style></head><body><main class="slide ${schedule.events.length > 10 ? "dense" : ""}"><aside class="intro"><svg class="intro-art" viewBox="0 0 520 720" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="sky" x1="0" x2="0" y1="0" y2="1"><stop stop-color="#efd3ac"/><stop offset=".43" stop-color="#f8edcf"/><stop offset="1" stop-color="#e9d49f"/></linearGradient><linearGradient id="field" x1="0" x2="1" y1="0" y2="1"><stop stop-color="#f7e69d"/><stop offset="1" stop-color="#c8ad62"/></linearGradient></defs><path fill="url(#sky)" d="M0 0h520v720H0z"/><path fill="#f7edca" opacity=".8" d="M0 280Q80 220 155 264t160 7q92-93 205 6v443H0z"/><path fill="#e5d092" opacity=".74" d="M0 360q94-78 188 8t170-9q83-58 162 11v350H0z"/><path fill="url(#field)" opacity=".8" d="M0 424q110-70 208 27t171-5q72-67 141-14v288H0z"/><path fill="#c4ae6b" opacity=".48" d="M0 540q90-93 178-20t190-7q83-57 152-17v224H0z"/><path fill="#9c996b" opacity=".28" d="M0 633q102-77 205-14t176-6q72-40 139-16v123H0z"/><path fill="none" stroke="#fff7df" stroke-width="5" opacity=".28" d="M-20 480q110-70 230 17t185-8q85-63 145-30M-10 590q110-68 200-5t190-9q66-34 150-8"/></svg><div class="intro-copy"><h1>Menschen ist seine Güte.</h1><p>Psalm 107,1</p></div></aside><section class="schedule">${schedule.events.length ? `<div class="events">${items}</div>` : empty}</section></main></body></html>`;
    }
  
    app.get("/api/presenter/datasets", async (request, reply) => {
      if (!await activePresenterDepartment(request, reply)) return reply;
      return listDatasets();
    });

    app.delete<{ Params: { id: string } }>("/api/presenter/datasets/:id", async (request, reply) => {
      if (!validateMutation(request, reply)) return reply;
      if (!await activePresenterDepartment(request, reply, "admin")) return reply;
      const result = await deleteDataset(request.params.id);
      if (!result.deleted) {
        if (result.reason === "built-in") return reply.code(403).send({ error: "Built-in datasets cannot be deleted." });
        return reply.code(404).send({ error: "Library or presentation not found." });
      }

      // Remove any live output state that references this dataset before its assets disappear.
      const affected = await pool!.query(
        `UPDATE presenter_output_sessions
            SET state = '{"visible":false}'::jsonb
          WHERE state->>'datasetId' = $1 OR state->>'preloadDatasetId' = $1
          RETURNING token_hash, previous_token_hash`,
        [request.params.id],
      );
      for (const session of affected.rows) {
        if (session.token_hash) publishOutputState(session.token_hash, { visible: false });
        if (session.previous_token_hash) publishOutputState(session.previous_token_hash, { visible: false });
      }
      return { deleted: true };
    });
  
    app.get<{ Params: { id: string }; Querystring: { search?: string } }>("/api/presenter/datasets/:id/songs", async (request, reply) => {
      if (!await activePresenterDepartment(request, reply)) return reply;
      const dataset = await readDataset(request.params.id);
      if (!dataset) return reply.code(404).send({ error: "Dataset not found." });
      if (dataset.id === "aktuell") return dataset.songs.map((song) => ({ number: song.number, sourceNumber: song.sourceNumber, name: song.name, slideCount: song.slides.length }));
      const search = (request.query.search ?? "").trim().toLocaleLowerCase();
      const numericSearch = /^\d+$/.test(search) ? search.replace(/^0+(?=\d)/, "") : null;
      return dataset.songs
        .filter((song) => {
          if (!search) return true;
          if (song.name.toLocaleLowerCase().includes(search)) return true;
          if (numericSearch === null) return false;
          return [song.number, song.sourceNumber].some((number) => String(number) === search || String(number).replace(/^0+(?=\d)/, "") === numericSearch);
        })
        .map((song) => ({ number: song.number, sourceNumber: song.sourceNumber, name: song.name, slideCount: song.slides.length }));
    });

    app.get<{ Querystring: { search?: string } }>("/api/presenter/datasets/aktuell/events", async (request, reply) => {
      const department = await activePresenterDepartment(request, reply);
      if (!department) return reply;
      const schedule = await aktuellSchedule(department);
      const search = (request.query.search ?? "").trim().toLocaleLowerCase();
      const events = schedule.events.filter((event) => !search || [event.title, event.kind, event.event_date, event.start_time, event.end_time, event.location, event.room, event.description].some((value) => value?.toLocaleLowerCase().includes(search)));
      return { timeZone: schedule.timeZone, startDate: schedule.startDate, endDate: schedule.endDate, events };
    });
  
    app.get<{ Params: { id: string; number: string } }>("/api/presenter/datasets/:id/songs/:number", async (request, reply) => {
      if (!await activePresenterDepartment(request, reply)) return reply;
      const dataset = await readDataset(request.params.id);
      const number = Number(request.params.number);
      const song = dataset?.songs.find((item) => item.number === number);
      if (!song) return reply.code(404).send({ error: "Song not found." });
      const activeLocationId = request.headers["x-department-id"];
      const locationId = typeof activeLocationId === "string" ? activeLocationId : getDefaultDepartmentId();
      return { ...song, slides: song.slides.map((slide) => {
        if (slide.type === "text") return slide;
        const assetUrl = `/api/presenter/datasets/${dataset!.id}/assets/${encodeURIComponent(slide.asset.slice("pages/".length))}?departmentId=${encodeURIComponent(locationId)}${dataset!.id === "aktuell" ? `&v=${aktuellAssetVersion}` : ""}`;
        return slide.type === "image" ? { ...slide, imageUrl: assetUrl } : slide.type === "html" ? { ...slide, htmlUrl: assetUrl } : slide;
      }) };
    });
  
    app.get<{ Params: { id: string; asset: string }; Querystring: { departmentId?: string } }>("/api/presenter/datasets/:id/assets/:asset", async (request, reply) => {
      const department = await activePresenterDepartment(request, reply, "access", true);
      if (!department) return reply;
      let asset: string;
      try { asset = `pages/${decodeURIComponent(request.params.asset)}`; }
      catch { return reply.code(400).send({ error: "Invalid dataset asset path." }); }
      if (request.params.id === "aktuell" && asset === "pages/slide-1.html") {
        reply.type("text/html; charset=utf-8").header("Content-Security-Policy", "sandbox allow-same-origin; default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline' data:; media-src data:").header("X-Content-Type-Options", "nosniff").header("Cache-Control", "no-store");
        return aktuellSlideHtml(await aktuellSchedule(department));
      }
      const html = asset.endsWith(".html") ? await readDatasetHtmlAsset(request.params.id, asset) : null;
      const image = asset.endsWith(".png") ? await readDatasetAsset(request.params.id, asset) : null;
      if (!html && !image) return reply.code(404).send({ error: "Dataset asset not found." });
      if (html) reply.type("text/html; charset=utf-8").header("Content-Security-Policy", "sandbox allow-same-origin; default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline' data:; media-src data:").header("X-Content-Type-Options", "nosniff");
      else reply.type("image/png");
      reply.header("Cache-Control", "private, max-age=3600");
      return html ?? image;
    });
  
    app.get<{ Params: { id: string } }>("/api/presenter/datasets/:id/export", async (request, reply) => {
      if (!await activePresenterDepartment(request, reply)) return reply;
      const archive = await datasetArchive(request.params.id);
      if (!archive) return reply.code(404).send({ error: "Dataset not found." });
      reply.type("application/gzip").header("Content-Disposition", `attachment; filename=\"${archive.filename}\"`).header("Cache-Control", "no-store");
      return archive.stream;
    });
  
    app.post<{ Body: Buffer }>("/api/presenter/datasets", { bodyLimit: 256 * 1024 * 1024 }, async (request, reply) => {
      if (!validateMutation(request, reply)) return reply;
      if (!await activePresenterDepartment(request, reply, "admin")) return reply;
      if (!Buffer.isBuffer(request.body)) return reply.code(400).send({ error: "Upload a .scdataset.tar.gz package." });
      try {
        const installed = await installDatasetArchive(request.body);
        return reply.code(201).send(installed);
      } catch (error) {
        request.log.warn({ err: error }, "Presenter dataset import rejected");
        return reply.code(400).send({ error: error instanceof Error ? error.message : "The dataset package could not be imported." });
      }
    });

    app.post<{ Body: Buffer; Querystring: { filename?: string } }>("/api/presenter/library/presentations", { bodyLimit: 64 * 1024 * 1024 }, async (request, reply) => {
      if (!validateMutation(request, reply)) return reply;
      if (!await activePresenterDepartment(request, reply, "admin")) return reply;
      if (!Buffer.isBuffer(request.body)) return reply.code(400).send({ error: "Upload a PowerPoint .pptx file." });
      try {
        const slides = await readPowerPointSlides(request.body);
        const filename = request.query.filename?.slice(0, 160) || "Imported presentation.pptx";
        const imported = await installPresentationDataset(filename, slides);
        return reply.code(201).send(imported);
      } catch (error) {
        request.log.warn({ err: error }, "Presenter PowerPoint import rejected");
        return reply.code(400).send({ error: error instanceof Error ? error.message : "The PowerPoint presentation could not be imported." });
      }
    });

    app.post<{ Body: Buffer; Querystring: { filename?: string } }>("/api/presenter/library/pictures", { bodyLimit: 20 * 1024 * 1024 }, async (request, reply) => {
      if (!validateMutation(request, reply)) return reply;
      if (!await activePresenterDepartment(request, reply, "admin")) return reply;
      if (!Buffer.isBuffer(request.body)) return reply.code(400).send({ error: "Upload a PNG picture." });
      try {
        const filename = request.query.filename?.slice(0, 160) || "Picture.png";
        return reply.code(201).send(await installLibraryPicture(filename, request.body));
      } catch (error) {
        request.log.warn({ err: error }, "Presenter picture import rejected");
        return reply.code(400).send({ error: error instanceof Error ? error.message : "The picture could not be imported." });
      }
    });

    app.get("/api/presenter/media", async (request, reply) => {
      const department = await activePresenterDepartment(request, reply);
      if (!department) return reply;
      const media = await listPresenterMedia(department);
      return media.map((item) => ({
        ...item,
        url: `/api/presenter/media/${encodeURIComponent(item.id)}/file?departmentId=${encodeURIComponent(department)}`,
      }));
    });

    app.delete<{ Params: { id: string } }>("/api/presenter/media/:id", async (request, reply) => {
      if (!validateMutation(request, reply)) return reply;
      const department = await activePresenterDepartment(request, reply, "admin");
      if (!department) return reply;
      if (!await deletePresenterMedia(department, request.params.id)) return reply.code(404).send({ error: "Presenter media not found." });

      const affected = await pool!.query(
        `UPDATE presenter_output_sessions
            SET state = '{"visible":false}'::jsonb, updated_at = now()
          WHERE department_id = $1 AND state->'slide'->>'mediaId' = $2
          RETURNING token_hash, previous_token_hash`,
        [department, request.params.id],
      );
      for (const session of affected.rows) {
        if (session.token_hash) publishOutputState(session.token_hash, { visible: false });
        if (session.previous_token_hash) publishOutputState(session.previous_token_hash, { visible: false });
      }
      return { deleted: true };
    });

    app.post<{ Body: Buffer; Querystring: { filename?: string } }>("/api/presenter/media", { bodyLimit: presenterMediaUploadLimit }, async (request, reply) => {
      if (!validateMutation(request, reply)) return reply;
      const department = await activePresenterDepartment(request, reply, "admin");
      if (!department) return reply;
      if (!Buffer.isBuffer(request.body)) return reply.code(400).send({ error: "Upload a PNG, JPEG, or WebP image, or an MP4 or WebM video." });
      try {
        const mimeType = request.headers["content-type"]?.split(";")[0] ?? "";
        const item = await installPresenterMedia(department, request.query.filename?.slice(0, 200) || "Media", mimeType, request.body);
        return reply.code(201).send({
          ...item,
          url: `/api/presenter/media/${encodeURIComponent(item.id)}/file?departmentId=${encodeURIComponent(department)}`,
        });
      } catch (error) {
        request.log.warn({ err: error }, "Presenter media import rejected");
        return reply.code(400).send({ error: error instanceof Error ? error.message : "The media file could not be imported." });
      }
    });

    app.get<{ Params: { id: string } }>("/api/presenter/media/:id/file", async (request, reply) => {
      const department = await activePresenterDepartment(request, reply, "access", true);
      if (!department) return reply;
      const media = await readPresenterMedia(department, request.params.id);
      if (!media) return reply.code(404).send({ error: "Presenter media not found." });
      reply.type(media.item.mimeType).header("Cache-Control", "private, max-age=3600").header("X-Content-Type-Options", "nosniff");
      return media.file;
    });

    app.get("/api/presenter/sessions", async (request, reply) => {
      const department = await activePresenterDepartment(request, reply);
      if (!department) return reply;
      await ensurePresenterSessions(department);
      const sessions = await pool!.query(
        "SELECT session_id, display_name, COALESCE(last_seen_at > now() - interval '10 seconds', false) AS connected, state FROM presenter_output_sessions WHERE department_id = $1 ORDER BY CASE WHEN session_id = 'main' THEN 0 ELSE substring(session_id FROM 4)::int END",
        [department],
      );
      return sessions.rows.map((session) => ({
        id: session.session_id,
        name: session.display_name,
        connected: session.connected,
        visible: Boolean(session.state?.visible),
        songName: session.state?.songName ?? null,
        datasetId: session.state?.datasetId ?? null,
        songNumber: session.state?.songNumber ?? null,
        setNumber: session.state?.setNumber ?? null,
        slideIndex: session.state?.slideIndex ?? null,
        mediaPlayback: session.state?.mediaPlayback ?? null,
        slide: session.state?.slide?.type === "media"
          ? {
              ...session.state.slide,
              mediaUrl: `/api/presenter/media/${encodeURIComponent(session.state.slide.mediaId)}/file?departmentId=${encodeURIComponent(department)}`,
            }
          : session.state?.slide?.type === "image" || session.state?.slide?.type === "html"
          ? {
              ...session.state.slide,
              [session.state.slide.type === "image" ? "imageUrl" : "htmlUrl"]: `/api/presenter/datasets/${encodeURIComponent(session.state.datasetId)}/assets/${encodeURIComponent(session.state.slide.asset.slice("pages/".length))}?departmentId=${encodeURIComponent(department)}${session.state.datasetId === "aktuell" ? `&v=${aktuellAssetVersion}` : ""}`,
            }
          : session.state?.slide ?? null,
      }));
    });

    app.patch<{ Params: { id: string }; Body: { name: string } }>("/api/presenter/sessions/:id", { schema: {
      body: { type: "object", additionalProperties: false, required: ["name"], properties: { name: { type: "string", minLength: 1, maxLength: 32 } } },
    } }, async (request, reply) => {
      if (!validateMutation(request, reply)) return reply;
      const department = await activePresenterDepartment(request, reply, "operator");
      if (!department) return reply;
      if (!sessionIds.has(request.params.id)) return reply.code(404).send({ error: "Presenter session not found." });
      if (request.params.id === "main") return reply.code(400).send({ error: "The Main session name cannot be changed." });
      const name = request.body.name.trim();
      if (!name || name.length > 32) return reply.code(400).send({ error: "Aux session names must contain 1 to 32 characters." });
      await ensurePresenterSessions(department);
      await pool!.query("UPDATE presenter_output_sessions SET display_name = $3, updated_at = now() WHERE department_id = $1 AND session_id = $2", [department, request.params.id, name]);
      return { id: request.params.id, name };
    });

    app.post<{ Params: { id: string } }>("/api/presenter/sessions/:id/connect", async (request, reply) => {
      if (!validateMutation(request, reply)) return reply;
      const department = await activePresenterDepartment(request, reply, "operator");
      if (!department) return reply;
      if (!sessionIds.has(request.params.id)) return reply.code(404).send({ error: "Presenter session not found." });
      await ensurePresenterSessions(department);
      const candidate = randomBytes(32).toString("base64url");
      const connected = await pool!.query(
        `UPDATE presenter_output_sessions
            SET previous_token_hash = CASE WHEN output_token IS NULL THEN COALESCE(previous_token_hash, token_hash) ELSE previous_token_hash END,
                output_token = COALESCE(output_token, $3),
                token_hash = CASE WHEN output_token IS NULL THEN $4 ELSE token_hash END,
                updated_at = now()
          WHERE department_id = $1 AND session_id = $2
          RETURNING output_token`,
        [department, request.params.id, candidate, outputTokenHash(candidate)],
      );
      return { token: connected.rows[0].output_token as string };
    });

    app.post<{ Params: { id: string }; Body: { datasetId: string; setNumber?: number; songNumber?: number } }>("/api/presenter/sessions/:id/preload", { schema: {
      body: {
        type: "object", additionalProperties: false, required: ["datasetId"],
        properties: { datasetId: { type: "string", maxLength: 64 }, setNumber: { type: "integer", minimum: 1 }, songNumber: { type: "integer", minimum: 1 } },
      },
    } }, async (request, reply) => {
      if (!validateMutation(request, reply)) return reply;
      const department = await activePresenterDepartment(request, reply, "operator");
      if (!department) return reply;
      if (!sessionIds.has(request.params.id)) return reply.code(404).send({ error: "Presenter session not found." });
      await ensurePresenterSessions(department);
      const dataset = await readDataset(request.body.datasetId);
      const setMatches = request.body.setNumber === undefined ? [] : dataset?.songs.filter((item) => item.sourceNumber === request.body.setNumber) ?? [];
      const song = setMatches.length === 1 ? setMatches[0] : setMatches.length > 1 ? undefined : request.body.songNumber === undefined ? undefined : dataset?.songs.find((item) => item.number === request.body.songNumber);
      if (!dataset || !song) return reply.code(404).send({ error: "The selected set number could not be found or is ambiguous." });
      const connected = await pool!.query<{ state: Record<string, any>; token_hash: string | null }>("SELECT state, token_hash FROM presenter_output_sessions WHERE department_id = $1 AND session_id = $2", [department, request.params.id]);
      await pool!.query(
        `UPDATE presenter_output_sessions
            SET state = state || jsonb_build_object('preloadDatasetId', $3::text, 'preloadSongNumber', $4::int, 'preloadSetNumber', $5::int), updated_at = now()
          WHERE department_id = $1 AND session_id = $2`,
        [department, request.params.id, dataset.id, song.number, song.sourceNumber],
      );
      if (connected.rows[0]?.token_hash) publishOutputState(connected.rows[0].token_hash, { ...connected.rows[0].state, preloadDatasetId: dataset.id, preloadSongNumber: song.number, preloadSetNumber: song.sourceNumber });
      return { ok: true };
    });

    app.post<{ Params: { id: string }; Body: { visible: boolean; clear?: boolean; datasetId?: string; setNumber?: number; songNumber?: number; slideIndex?: number; mediaId?: string; mediaAction?: "play" | "pause" | "seek"; currentTime?: number } }>("/api/presenter/sessions/:id/output", {
      schema: {
        body: {
          type: "object", additionalProperties: false, required: ["visible"],
          properties: { visible: { type: "boolean" }, clear: { type: "boolean" }, datasetId: { type: "string", maxLength: 64 }, setNumber: { type: "integer", minimum: 1 }, songNumber: { type: "integer", minimum: 1 }, slideIndex: { type: "integer", minimum: 0 }, mediaId: { type: "string", maxLength: 64 }, mediaAction: { type: "string", enum: ["play", "pause", "seek"] }, currentTime: { type: "number", minimum: 0 } },
        },
      },
    }, async (request, reply) => {
      if (!validateMutation(request, reply)) return reply;
      const department = await activePresenterDepartment(request, reply, "operator");
      if (!department) return reply;
      if (!sessionIds.has(request.params.id)) return reply.code(404).send({ error: "Presenter session not found." });
      await ensurePresenterSessions(department);
      const candidate = randomBytes(32).toString("base64url");
      const connected = await pool!.query<{ state: Record<string, any>; token_hash: string | null }>(
        `UPDATE presenter_output_sessions
            SET previous_token_hash = CASE WHEN output_token IS NULL THEN COALESCE(previous_token_hash, token_hash) ELSE previous_token_hash END,
                output_token = COALESCE(output_token, $3),
                token_hash = CASE WHEN output_token IS NULL THEN $4 ELSE token_hash END,
                updated_at = now()
          WHERE department_id = $1 AND session_id = $2
          RETURNING state, token_hash`,
        [department, request.params.id, candidate, outputTokenHash(candidate)],
      );
      if (!connected.rows[0]) return reply.code(404).send({ error: "Presenter session not found." });
      let nextState: Record<string, unknown>;
      if (request.body.clear) {
        nextState = { visible: false };
      } else if (request.body.mediaId) {
        if (!request.body.visible) return reply.code(400).send({ error: "Media must be made visible when it is sent." });
        const media = await readPresenterMedia(department, request.body.mediaId);
        if (!media) return reply.code(404).send({ error: "The selected media could not be found." });
        nextState = {
          ...connected.rows[0].state,
          visible: true,
          datasetId: null,
          songNumber: null,
          setNumber: null,
          preloadDatasetId: null,
          preloadSetNumber: null,
          preloadSongNumber: null,
          slideIndex: 0,
          songName: media.item.name,
          slide: { type: "media", mediaId: media.item.id, kind: media.item.kind, label: media.item.name },
          mediaPlayback: media.item.kind === "video" ? { action: "play", currentTime: 0, revision: Date.now() } : null,
        };
      } else if (request.body.mediaAction) {
        const currentState = connected.rows[0].state;
        if (currentState?.slide?.type !== "media" || currentState.slide.kind !== "video") return reply.code(409).send({ error: "A video must be on the output before controlling playback." });
        if (request.body.mediaAction === "seek" && (typeof request.body.currentTime !== "number" || !Number.isFinite(request.body.currentTime))) return reply.code(400).send({ error: "Choose a valid playback position." });
        const previousRevision = Number(currentState.mediaPlayback?.revision) || 0;
        const mediaPlayback = {
          action: request.body.mediaAction,
          currentTime: typeof request.body.currentTime === "number" && Number.isFinite(request.body.currentTime) ? request.body.currentTime : Number(currentState.mediaPlayback?.currentTime) || 0,
          revision: Math.max(Date.now(), previousRevision + 1),
        };
        nextState = { ...currentState, visible: request.body.visible, mediaPlayback };
      } else if (request.body.datasetId || request.body.setNumber !== undefined || request.body.songNumber !== undefined || request.body.slideIndex !== undefined) {
        const { datasetId, setNumber, songNumber, slideIndex } = request.body;
        if (!request.body.visible) return reply.code(400).send({ error: "A selected slide must be made visible when it is sent." });
        if (!datasetId || (setNumber === undefined && songNumber === undefined) || slideIndex === undefined) return reply.code(400).send({ error: "Choose a song and slide to send to the output." });
        const dataset = await readDataset(datasetId);
        const setMatches = setNumber === undefined ? [] : dataset?.songs.filter((item) => item.sourceNumber === setNumber) ?? [];
        const song = setMatches.length === 1 ? setMatches[0] : setMatches.length > 1 ? undefined : dataset?.songs.find((item) => item.number === songNumber);
        const slide = song?.slides[slideIndex];
        if (!dataset || !song || !slide) return reply.code(404).send({ error: "The selected set number or slide could not be found or is ambiguous." });
        nextState = { ...connected.rows[0].state, visible: true, datasetId: dataset.id, songNumber: song.number, setNumber: song.sourceNumber, slideIndex, datasetName: dataset.name, songName: song.name, slide, mediaPlayback: null };
      } else {
        nextState = { ...connected.rows[0].state, visible: request.body.visible };
        if (request.body.visible && !nextState.slide) return reply.code(409).send({ error: "Send a slide to this output before showing it." });
      }
      await pool!.query("UPDATE presenter_output_sessions SET state = $3::jsonb, updated_at = now() WHERE department_id = $1 AND session_id = $2", [department, request.params.id, JSON.stringify(nextState)]);
      if (connected.rows[0].token_hash) publishOutputState(connected.rows[0].token_hash, nextState);
      return { visible: Boolean(nextState.visible), mediaPlayback: nextState.mediaPlayback ?? null };
    });

    app.get<{ Params: { token: string } }>("/api/modules/presenter/public/output/:token", async (request, reply) => {
      const state = await readPublicSession(request.params.token);
      if (!state) return reply.code(404).send({ error: "This Presenter output link is no longer active." });
      reply.header("Cache-Control", "no-store");
      return publicOutputState(state, request.params.token);
    });

    app.get<{ Params: { token: string; id: string } }>("/api/modules/presenter/public/output/:token/media/:id", async (request, reply) => {
      const hash = outputTokenHash(request.params.token);
      const session = await pool?.query(
        `SELECT s.department_id FROM presenter_output_sessions s JOIN departments d ON d.id = s.department_id
         WHERE (s.token_hash = $1 OR s.previous_token_hash = $1) AND d.enabled_modules @> ARRAY['presenter']::text[]`,
        [hash],
      );
      const department = session?.rows[0]?.department_id as string | undefined;
      if (!department) return reply.code(404).send({ error: "This Presenter output link is no longer active." });
      const media = await readPresenterMedia(department, request.params.id);
      if (!media) return reply.code(404).send({ error: "Presenter media not found." });
      reply.type(media.item.mimeType).header("Cache-Control", "private, max-age=3600").header("X-Content-Type-Options", "nosniff");
      return media.file;
    });

    app.get<{ Params: { token: string } }>("/api/modules/presenter/public/output/:token/events", async (request, reply) => {
      const { token } = request.params;
      if (!await readPublicSession(token)) return reply.code(404).send({ error: "This Presenter output link is no longer active." });

      reply.hijack();
      const response = reply.raw;
      response.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      response.flushHeaders();

      const tokenHash = outputTokenHash(token);
      let heartbeat: NodeJS.Timeout | undefined;
      const client: OutputClient = {
        response,
        token,
        revision: 0,
        close: () => {
          clearInterval(heartbeat);
          response.off("close", client.close);
          response.off("error", client.close);
          const clients = outputClients.get(tokenHash);
          clients?.delete(client);
          if (clients?.size === 0) outputClients.delete(tokenHash);
        },
      };
      const clients = outputClients.get(tokenHash) ?? new Set<OutputClient>();
      clients.add(client);
      outputClients.set(tokenHash, clients);
      response.on("close", client.close);
      response.on("error", client.close);

      heartbeat = setInterval(async () => {
        try {
          const session = await pool?.query<{ department_id: string }>(`SELECT s.department_id FROM presenter_output_sessions s JOIN departments d ON d.id=s.department_id
            WHERE (s.token_hash=$1 OR s.previous_token_hash=$1) AND d.enabled_modules @> ARRAY['presenter']::text[]`, [tokenHash]);
          if (!session?.rowCount) return response.end();
          if (!(await dependencies.isDepartmentWritable(session.rows[0].department_id))) {
            response.write(": keep-alive\n\n");
            return;
          }
          const touched = await pool?.query(
            `UPDATE presenter_output_sessions s SET last_seen_at = now()
               FROM departments d
              WHERE d.id = s.department_id AND s.department_id=$2 AND (s.token_hash = $1 OR s.previous_token_hash = $1)
                AND d.enabled_modules @> ARRAY['presenter']::text[]
              RETURNING s.state`,
            [tokenHash, session.rows[0].department_id],
          );
          if (!touched?.rowCount) return response.end();
          response.write(": keep-alive\n\n");
        } catch { response.end(); }
      }, 5000);
      heartbeat.unref();

      try {
        const state = await readPublicSession(token);
        if (state && client.revision === 0 && !response.destroyed) {
          response.write(`data: ${JSON.stringify({ state: publicOutputState(state, token), sentAt: Date.now() })}\n\n`);
        }
      } catch { response.end(); }
    });

    app.get<{ Params: { token: string } }>("/api/modules/presenter/public/output/:token/preload", async (request, reply) => {
      const state = await readPublicSession(request.params.token);
      if (!state) return reply.code(404).send({ error: "This Presenter output link is no longer active." });
      reply.header("Cache-Control", "no-store");
      const datasetId = state.preloadDatasetId ?? state.datasetId;
      const setNumber = state.preloadSetNumber;
      const songNumber = state.preloadSongNumber ?? state.songNumber;
      if (!datasetId || (!Number.isSafeInteger(setNumber) && !Number.isSafeInteger(songNumber))) return { slides: [] };
      const dataset = await readDataset(datasetId);
      const matches = Number.isSafeInteger(setNumber) ? dataset?.songs.filter((item) => item.sourceNumber === setNumber) ?? [] : [];
      const song = matches.length === 1 ? matches[0] : matches.length > 1 ? undefined : dataset?.songs.find((item) => item.number === songNumber);
      if (!dataset || !song) return { slides: [] };
      const slides = song.slides.map((slide) => {
        if (slide.type === "text") return slide;
        const assetUrl = `/api/modules/presenter/public/output/${encodeURIComponent(request.params.token)}/assets/${encodeURIComponent(dataset!.id)}/${encodeURIComponent(slide.asset.slice("pages/".length))}${dataset!.id === "aktuell" ? `?v=${aktuellAssetVersion}` : ""}`;
        return slide.type === "image" ? { ...slide, imageUrl: assetUrl } : { ...slide, htmlUrl: assetUrl };
      });
      return { datasetId: dataset.id, songNumber: song.number, slides };
    });

    app.get<{ Params: { token: string; datasetId: string; asset: string } }>("/api/modules/presenter/public/output/:token/assets/:datasetId/:asset", async (request, reply) => {
      const found = await pool?.query(
        `SELECT s.department_id FROM presenter_output_sessions s
          JOIN departments d ON d.id = s.department_id
         WHERE (s.token_hash = $1 OR s.previous_token_hash = $1) AND d.enabled_modules @> ARRAY['presenter']::text[]`,
        [outputTokenHash(request.params.token)],
      );
      if (!found?.rows[0]) return reply.code(404).send({ error: "This Presenter output link is no longer active." });
      if (!/^[A-Za-z0-9._-]+\.(?:png|html)$/.test(request.params.asset)) return reply.code(400).send({ error: "Invalid Presenter output asset." });
      const asset = `pages/${request.params.asset}`;
      if (request.params.datasetId === "aktuell" && asset === "pages/slide-1.html") {
        reply.type("text/html; charset=utf-8").header("Content-Security-Policy", "sandbox allow-same-origin; default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline' data:; media-src data:").header("X-Content-Type-Options", "nosniff").header("Cache-Control", "no-store");
        return aktuellSlideHtml(await aktuellSchedule(found.rows[0].department_id));
      }
      const html = asset.endsWith(".html") ? await readDatasetHtmlAsset(request.params.datasetId, asset) : null;
      const image = asset.endsWith(".png") ? await readDatasetAsset(request.params.datasetId, asset) : null;
      if (!html && !image) return reply.code(404).send({ error: "Presenter output asset not found." });
      if (html) reply.type("text/html; charset=utf-8").header("Content-Security-Policy", "sandbox allow-same-origin; default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline' data:; media-src data:").header("X-Content-Type-Options", "nosniff");
      else reply.type("image/png");
      reply.header("Cache-Control", "private, max-age=3600");
      return html ?? image;
    });
  });
}
