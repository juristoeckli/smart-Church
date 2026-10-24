import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Pool } from "pg";
import { datasetArchive, installDatasetArchive, listDatasets, readDataset, readDatasetAsset } from "./datasets.js";

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
  
    async function activePresenterDepartment(request: FastifyRequest, reply: FastifyReply, requireAdmin = false, allowQueryLocation = false) {
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
      if (requireAdmin && !isAdmin) {
        reply.code(403).send({ error: "Presenter administrator access is required." });
        return null;
      }
      return selectedId;
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
      return dataset.songs
        .filter((song) => !search || song.name.toLocaleLowerCase().includes(search) || String(song.sourceNumber).includes(search))
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
      if (!await activePresenterDepartment(request, reply, false, true)) return reply;
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
      if (!await activePresenterDepartment(request, reply, true)) return reply;
      if (!Buffer.isBuffer(request.body)) return reply.code(400).send({ error: "Upload a .scdataset.tar.gz package." });
      try {
        const installed = await installDatasetArchive(request.body);
        return reply.code(201).send(installed);
      } catch (error) {
        request.log.warn({ err: error }, "Presenter dataset import rejected");
        return reply.code(400).send({ error: error instanceof Error ? error.message : "The dataset package could not be imported." });
      }
    });
  });
}
