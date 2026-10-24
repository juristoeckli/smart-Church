import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Pool } from "pg";
import { createHash, randomBytes } from "node:crypto";
import { datasetArchive, installDatasetArchive, listDatasets, readDataset, readDatasetAsset } from "./datasets.js";

const presenterSessions = [
  { id: "main", name: "Main" },
  ...Array.from({ length: 10 }, (_, index) => ({ id: `aux${index + 1}`, name: `Aux ${index + 1}` })),
];
const sessionIds = new Set(presenterSessions.map(({ id }) => id));
const outputTokenHash = (token: string) => createHash("sha256").update(token).digest("hex");

interface PresenterRouteDependencies {
  pool: Pool | null;
  isDatabaseReady: () => boolean;
  getDefaultDepartmentId: () => string;
  resolveDepartmentId: (request: FastifyRequest, reply: FastifyReply, requireSiteAdmin?: boolean, allowQueryLocation?: boolean) => Promise<string | null>;
  validateMutation: (request: FastifyRequest, reply: FastifyReply) => boolean;
}

export function registerPresenterRoutes(app: FastifyInstance, dependencies: PresenterRouteDependencies) {
  const { pool, isDatabaseReady, getDefaultDepartmentId, resolveDepartmentId, validateMutation } = dependencies;

  app.register(async (presenterRoutes) => {
    const app = presenterRoutes;
    app.addContentTypeParser("application/gzip", { parseAs: "buffer", bodyLimit: 256 * 1024 * 1024 }, (_request, body, done) => done(null, body));
  
    async function activePresenterDepartment(request: FastifyRequest, reply: FastifyReply, requiredAccess: "access" | "operator" | "admin" = "access", allowQueryLocation = false) {
      if (!isDatabaseReady() || !pool) {
        reply.code(503).send({ error: "The account database is unavailable." });
        return null;
      }
      const selectedId = await resolveDepartmentId(request, reply, false, allowQueryLocation);
      if (!selectedId) return null;
      const result = await pool.query(
        `SELECT d.enabled_modules, m.role, m.presenter_permissions
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
      const permissions = new Set<string>(access.presenter_permissions ?? []);
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
      const touched = await pool?.query(
        `UPDATE presenter_output_sessions s SET last_seen_at = now()
          FROM departments d
         WHERE d.id = s.department_id AND (s.token_hash = $1 OR s.previous_token_hash = $1) AND d.enabled_modules @> ARRAY['presenter']::text[]
           AND (s.last_seen_at IS NULL OR s.last_seen_at < now() - interval '5 seconds')
         RETURNING s.state`,
        [hash],
      );
      if (touched?.rows[0]) return touched.rows[0].state;
      const current = await pool?.query(
        `SELECT s.state FROM presenter_output_sessions s JOIN departments d ON d.id = s.department_id
         WHERE (s.token_hash = $1 OR s.previous_token_hash = $1) AND d.enabled_modules @> ARRAY['presenter']::text[]`,
        [hash],
      );
      return current?.rows[0]?.state;
    }
  
    app.get("/api/presenter/datasets", async (request, reply) => {
      if (!await activePresenterDepartment(request, reply)) return reply;
      return listDatasets();
    });
  
    app.get<{ Params: { id: string }; Querystring: { search?: string } }>("/api/presenter/datasets/:id/songs", async (request, reply) => {
      if (!await activePresenterDepartment(request, reply)) return reply;
      const dataset = await readDataset(request.params.id);
      if (!dataset) return reply.code(404).send({ error: "Dataset not found." });
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
  
    app.get<{ Params: { id: string; number: string } }>("/api/presenter/datasets/:id/songs/:number", async (request, reply) => {
      if (!await activePresenterDepartment(request, reply)) return reply;
      const dataset = await readDataset(request.params.id);
      const number = Number(request.params.number);
      const song = dataset?.songs.find((item) => item.number === number);
      if (!song) return reply.code(404).send({ error: "Song not found." });
      const activeLocationId = request.headers["x-department-id"];
      const locationId = typeof activeLocationId === "string" ? activeLocationId : getDefaultDepartmentId();
      return { ...song, slides: song.slides.map((slide) => slide.type === "image" ? { ...slide, imageUrl: `/api/presenter/datasets/${dataset!.id}/assets/${encodeURIComponent(slide.asset.slice("pages/".length))}?departmentId=${encodeURIComponent(locationId)}` } : slide) };
    });
  
    app.get<{ Params: { id: string; asset: string }; Querystring: { departmentId?: string } }>("/api/presenter/datasets/:id/assets/:asset", async (request, reply) => {
      if (!await activePresenterDepartment(request, reply, "access", true)) return reply;
      let asset: string;
      try { asset = `pages/${decodeURIComponent(request.params.asset)}`; }
      catch { return reply.code(400).send({ error: "Invalid dataset asset path." }); }
      const image = await readDatasetAsset(request.params.id, asset);
      if (!image) return reply.code(404).send({ error: "Dataset image not found." });
      reply.type("image/png").header("Cache-Control", "private, max-age=3600");
      return image;
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
        slideIndex: session.state?.slideIndex ?? null,
        slide: session.state?.slide?.type === "image"
          ? {
              ...session.state.slide,
              imageUrl: `/api/presenter/datasets/${encodeURIComponent(session.state.datasetId)}/assets/${encodeURIComponent(session.state.slide.asset.slice("pages/".length))}?departmentId=${encodeURIComponent(department)}`,
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

    app.post<{ Params: { id: string }; Body: { visible: boolean; clear?: boolean; datasetId?: string; songNumber?: number; slideIndex?: number } }>("/api/presenter/sessions/:id/output", {
      schema: {
        body: {
          type: "object", additionalProperties: false, required: ["visible"],
          properties: { visible: { type: "boolean" }, clear: { type: "boolean" }, datasetId: { type: "string", maxLength: 64 }, songNumber: { type: "integer", minimum: 1 }, slideIndex: { type: "integer", minimum: 0 } },
        },
      },
    }, async (request, reply) => {
      if (!validateMutation(request, reply)) return reply;
      const department = await activePresenterDepartment(request, reply, "operator");
      if (!department) return reply;
      if (!sessionIds.has(request.params.id)) return reply.code(404).send({ error: "Presenter session not found." });
      const connected = await pool!.query("SELECT state, token_hash FROM presenter_output_sessions WHERE department_id = $1 AND session_id = $2", [department, request.params.id]);
      if (!connected.rows[0]?.token_hash) return reply.code(409).send({ error: "Connect this session to a display first." });
      let nextState: Record<string, unknown>;
      if (request.body.clear) {
        nextState = { visible: false };
      } else if (request.body.datasetId || request.body.songNumber !== undefined || request.body.slideIndex !== undefined) {
        const { datasetId, songNumber, slideIndex } = request.body;
        if (!request.body.visible) return reply.code(400).send({ error: "A selected slide must be made visible when it is sent." });
        if (!datasetId || songNumber === undefined || slideIndex === undefined) return reply.code(400).send({ error: "Choose a song and slide to send to the output." });
        const dataset = await readDataset(datasetId);
        const song = dataset?.songs.find((item) => item.number === songNumber);
        const slide = song?.slides[slideIndex];
        if (!dataset || !song || !slide) return reply.code(404).send({ error: "The selected song or slide could not be found." });
        nextState = { visible: true, datasetId: dataset.id, songNumber, slideIndex, datasetName: dataset.name, songName: song.name, slide };
      } else {
        nextState = { ...connected.rows[0].state, visible: request.body.visible };
        if (request.body.visible && !nextState.slide) return reply.code(409).send({ error: "Send a slide to this output before showing it." });
      }
      await pool!.query("UPDATE presenter_output_sessions SET state = $3::jsonb, updated_at = now() WHERE department_id = $1 AND session_id = $2", [department, request.params.id, JSON.stringify(nextState)]);
      return { visible: Boolean(nextState.visible) };
    });

    app.get<{ Params: { token: string } }>("/api/modules/presenter/public/output/:token", async (request, reply) => {
      const state = await readPublicSession(request.params.token);
      if (!state) return reply.code(404).send({ error: "This Presenter output link is no longer active." });
      reply.header("Cache-Control", "no-store");
      const slide = state.slide;
      if (state.visible && slide?.type === "image") {
        const assetName = slide.asset.slice("pages/".length);
        return { ...state, slide: { ...slide, imageUrl: `/api/modules/presenter/public/output/${encodeURIComponent(request.params.token)}/assets/${encodeURIComponent(state.datasetId)}/${encodeURIComponent(assetName)}` } };
      }
      return state;
    });

    app.get<{ Params: { token: string } }>("/api/modules/presenter/public/output/:token/preload", async (request, reply) => {
      const state = await readPublicSession(request.params.token);
      if (!state) return reply.code(404).send({ error: "This Presenter output link is no longer active." });
      reply.header("Cache-Control", "no-store");
      if (!state.datasetId || !Number.isSafeInteger(state.songNumber)) return { slides: [] };
      const dataset = await readDataset(state.datasetId);
      const song = dataset?.songs.find((item) => item.number === state.songNumber);
      if (!song) return { slides: [] };
      const slides = song.slides.map((slide) => slide.type === "image"
        ? { ...slide, imageUrl: `/api/modules/presenter/public/output/${encodeURIComponent(request.params.token)}/assets/${encodeURIComponent(dataset!.id)}/${encodeURIComponent(slide.asset.slice("pages/".length))}` }
        : slide);
      return { datasetId: dataset!.id, songNumber: song.number, slides };
    });

    app.get<{ Params: { token: string; datasetId: string; asset: string } }>("/api/modules/presenter/public/output/:token/assets/:datasetId/:asset", async (request, reply) => {
      const found = await pool?.query(
        `SELECT 1 FROM presenter_output_sessions s
          JOIN departments d ON d.id = s.department_id
         WHERE (s.token_hash = $1 OR s.previous_token_hash = $1) AND d.enabled_modules @> ARRAY['presenter']::text[]`,
        [outputTokenHash(request.params.token)],
      );
      if (!found?.rowCount) return reply.code(404).send({ error: "This Presenter output link is no longer active." });
      if (!/^[A-Za-z0-9._-]+\.png$/.test(request.params.asset)) return reply.code(400).send({ error: "Invalid Presenter output image." });
      const image = await readDatasetAsset(request.params.datasetId, `pages/${request.params.asset}`);
      if (!image) return reply.code(404).send({ error: "Presenter output image not found." });
      reply.type("image/png").header("Cache-Control", "private, max-age=3600");
      return image;
    });
  });
}
