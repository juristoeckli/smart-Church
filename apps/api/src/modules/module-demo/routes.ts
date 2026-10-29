import type { FastifyInstance } from "fastify";
import type { ModuleServerContext } from "../module-sdk.js";
import { ModuleDemoWorker } from "./worker-supervisor.js";

type DemoMessage = { message?: unknown };

export function registerModuleRoutes(app: FastifyInstance, context: ModuleServerContext) {
  const worker = new ModuleDemoWorker((message) => app.log.error({ module: "module-demo" }, message));
  const unregisterWorker = context.workers.register("server-clock", () => worker.diagnostics);
  const stop = context.realtime.onMessage("module:module-demo:send", async ({ departmentId }, payload) => {
    if (!context.pool || !context.isDatabaseReady() || !payload || typeof payload !== "object") return;
    const message = (payload as DemoMessage).message;
    if (typeof message !== "string") return;
    const cleaned = message.trim().replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ");
    if (!cleaned || cleaned.length > 160) return;

    const enabled = await context.pool.query<{ enabled_modules: string[] }>(
      "SELECT enabled_modules FROM departments WHERE id = $1",
      [departmentId],
    );
    if (!(enabled.rows[0]?.enabled_modules ?? []).includes("module-demo")) return;
    context.realtime.publish("module:module-demo:changed", departmentId, { message: cleaned, sentAt: new Date().toISOString() });
  });

  app.get("/api/modules/module-demo/worker/time", async (request, reply) => {
    if (!context.pool || !context.isDatabaseReady()) return reply.code(503).send({ error: "The account database is unavailable." });
    const departmentId = await context.resolveDepartmentId(request, reply);
    if (!departmentId) return reply;
    const result = await context.pool.query<{ enabled_modules: string[] }>("SELECT enabled_modules FROM departments WHERE id = $1", [departmentId]);
    if (!(result.rows[0]?.enabled_modules ?? []).includes("module-demo")) return reply.code(404).send({ error: "Module Demo is not enabled for this site." });
    try { return await worker.getTime(); }
    catch (error) { return reply.code(503).send({ error: error instanceof Error ? error.message : "The demo worker is unavailable." }); }
  });

  app.addHook("onClose", async () => { stop(); unregisterWorker(); await worker.close(); });
}
