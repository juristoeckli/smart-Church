import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ModuleServerContext } from "../module-sdk.js";
import { BmdConverterWorker } from "./bmd-converter-worker.js";

type VideoPermission = "video_basic" | "streaming_operator" | "stream_admin" | "routing_user" | "routing_admin";
const videoPostOperations = new Set(["command", "restart-site", "encoder-settings", "videohub-route", "videohub-presets"]);
const videoBodySchema = { type: "object", additionalProperties: true, maxProperties: 24 };

export function registerModuleRoutes(app: FastifyInstance, context: ModuleServerContext) {
  const { pool, isDatabaseReady, resolveDepartmentId, validateMutation, getVideoWorker } = context;
  const converterWorkers = new Map<string, BmdConverterWorker>();
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
      const status = await videoWorker.request("status", {}, departmentId, request.authenticatedUser!.username, 8_000) as { sites?: Array<{ id: string; devices?: Array<{ id: string; ip?: string }> }> };
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
      const status = await worker.request("status", {}, selectedDepartmentId, request.authenticatedUser!.username, 8_000);
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
      return await worker.request("videohub-history", { device: request.query.device, ...(request.query.site_id ? { site_id: request.query.site_id } : {}) }, selectedDepartmentId, request.authenticatedUser!.username, 8_000);
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
      return await worker.request(request.params.operation, data, selectedDepartmentId, request.authenticatedUser!.username, 35_000);
    } catch (error) {
      const failure = error as Error & { code?: string };
      const status = failure.code === "UNAVAILABLE" ? 503 : failure.code === "TIMEOUT" ? 504 : failure.code === "BUSY" ? 429 : 400;
      return reply.code(status).send({ error: failure.message });
    }
  });
}
