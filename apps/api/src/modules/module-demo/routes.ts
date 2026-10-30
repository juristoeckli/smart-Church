import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import type { ModuleServerContext } from "../module-sdk.js";
import { ModuleDemoWorker } from "./worker-supervisor.js";

type DemoMessage = { message?: unknown };
type DemoNoteRow = { id: string; message: string; created_at: Date | string };

function mapDemoNote(row: DemoNoteRow) {
  return { id: row.id, message: row.message, createdAt: new Date(row.created_at).toISOString() };
}

export function registerModuleRoutes(app: FastifyInstance, context: ModuleServerContext) {
  context.replication.register({
    schemaVersion: "1",
    inspect: async (departmentId) => {
      if (!context.pool || !context.isDatabaseReady()) return { ready: false, blockers: ["Module Demo database is unavailable."], recordCount: 0 };
      try {
        const result = await context.pool.query<{ count: number; bytes: string }>("SELECT count(*)::int AS count,COALESCE(sum(pg_column_size(note)),0)::text AS bytes FROM module_demo_notes note WHERE department_id=$1", [departmentId]);
        return Number(result.rows[0].bytes) <= 10 * 1024 * 1024
          ? { ready: true, blockers: [], recordCount: result.rows[0].count }
          : { ready: false, blockers: ["Module Demo notes exceed the 10 MiB snapshot limit."], recordCount: result.rows[0].count };
      } catch { return { ready: false, blockers: ["Module Demo storage is not initialized."], recordCount: 0 }; }
    },
    exportSnapshot: async (client, departmentId) => ({ version: 1, notes: (await client.query("SELECT id,message,created_at FROM module_demo_notes WHERE department_id=$1 ORDER BY id", [departmentId])).rows }),
    restoreSnapshot: async (client, departmentId, input) => {
      const snapshot = input as { version?: unknown; notes?: Array<{ id: string; message: string; created_at: Date | string }> };
      if (!snapshot || snapshot.version !== 1 || !Array.isArray(snapshot.notes) || snapshot.notes.length > 100_000) throw new Error("The Module Demo snapshot is invalid or exceeds the supported limits.");
      await client.query("DELETE FROM module_demo_notes WHERE department_id=$1", [departmentId]);
      for (const note of snapshot.notes) await client.query("INSERT INTO module_demo_notes(id,department_id,message,created_at) VALUES($1,$2,$3,$4)", [note.id, departmentId, note.message, note.created_at]);
      return { recordCount: snapshot.notes.length };
    },
    verifySnapshot: async (client, departmentId, input) => {
      const snapshot = input as { version?: unknown; notes?: Array<{ id: string; message: string; created_at: Date | string }> };
      if (!snapshot || snapshot.version !== 1 || !Array.isArray(snapshot.notes)) return { ready: false, blockers: ["No supported Module Demo snapshot is available."] };
      const actual = (await client.query("SELECT id,message,created_at FROM module_demo_notes WHERE department_id=$1 ORDER BY id", [departmentId])).rows;
      const expected = [...snapshot.notes].sort((left, right) => left.id.localeCompare(right.id));
      return JSON.stringify(actual) === JSON.stringify(expected) ? { ready: true, blockers: [] } : { ready: false, blockers: ["Module Demo notes do not match the verified snapshot."] };
    },
  });
  const worker = new ModuleDemoWorker((message) => app.log.error({ module: "module-demo" }, message));
  worker.setEnabled(context.activation.isEnabled());
  const removeActivationListener = context.activation.onChange((enabled) => worker.setEnabled(enabled));
  const unregisterWorker = context.workers.register("server-clock", () => worker.diagnostics, () => worker.restart());
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

  app.get("/api/modules/module-demo/notes", async (request, reply) => {
    if (!context.pool || !context.isDatabaseReady()) return reply.code(503).send({ error: "The account database is unavailable." });
    const departmentId = await context.resolveDepartmentId(request, reply);
    if (!departmentId) return reply;
    const enabled = await context.pool.query<{ enabled_modules: string[] }>("SELECT enabled_modules FROM departments WHERE id = $1", [departmentId]);
    if (!(enabled.rows[0]?.enabled_modules ?? []).includes("module-demo")) return reply.code(404).send({ error: "Module Demo is not enabled for this site." });
    const result = await context.pool.query<DemoNoteRow>(
      "SELECT id,message,created_at FROM module_demo_notes WHERE department_id=$1 ORDER BY created_at DESC,id DESC LIMIT 100",
      [departmentId],
    );
    return result.rows.map(mapDemoNote);
  });

  app.post<{ Body: { message: string } }>("/api/modules/module-demo/notes", { schema: {
    body: { type: "object", additionalProperties: false, required: ["message"], properties: { message: { type: "string", minLength: 1, maxLength: 200 } } },
  } }, async (request, reply) => {
    if (!context.pool || !context.isDatabaseReady()) return reply.code(503).send({ error: "The account database is unavailable." });
    if (!context.validateMutation(request, reply)) return reply;
    const departmentId = await context.resolveDepartmentId(request, reply, false, false, "groups_manage");
    if (!departmentId) return reply;
    const enabled = await context.pool.query<{ enabled_modules: string[] }>("SELECT enabled_modules FROM departments WHERE id = $1", [departmentId]);
    if (!(enabled.rows[0]?.enabled_modules ?? []).includes("module-demo")) return reply.code(404).send({ error: "Module Demo is not enabled for this site." });
    const message = request.body.message.trim();
    if (!message) return reply.code(400).send({ error: "Enter a note before saving." });
    const result = await context.pool.query<DemoNoteRow>(
      "INSERT INTO module_demo_notes (id,department_id,message) VALUES ($1,$2,$3) RETURNING id,message,created_at",
      [randomUUID(), departmentId, message],
    );
    const note = mapDemoNote(result.rows[0]!);
    context.realtime.publish("module:module-demo:notes-changed", departmentId, { action: "created", noteId: note.id });
    return reply.code(201).send(note);
  });

  app.delete<{ Params: { id: string } }>("/api/modules/module-demo/notes/:id", { schema: {
    params: { type: "object", additionalProperties: false, required: ["id"], properties: { id: { type: "string", format: "uuid" } } },
  } }, async (request, reply) => {
    if (!context.pool || !context.isDatabaseReady()) return reply.code(503).send({ error: "The account database is unavailable." });
    if (!context.validateMutation(request, reply)) return reply;
    const departmentId = await context.resolveDepartmentId(request, reply, false, false, "groups_manage");
    if (!departmentId) return reply;
    const enabled = await context.pool.query<{ enabled_modules: string[] }>("SELECT enabled_modules FROM departments WHERE id = $1", [departmentId]);
    if (!(enabled.rows[0]?.enabled_modules ?? []).includes("module-demo")) return reply.code(404).send({ error: "Module Demo is not enabled for this site." });
    const result = await context.pool.query("DELETE FROM module_demo_notes WHERE id=$1 AND department_id=$2 RETURNING id", [request.params.id, departmentId]);
    if (!result.rowCount) return reply.code(404).send({ error: "The note was not found in this site." });
    context.realtime.publish("module:module-demo:notes-changed", departmentId, { action: "deleted", noteId: request.params.id });
    return { deleted: true };
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

  app.addHook("onClose", async () => { removeActivationListener(); stop(); unregisterWorker(); await worker.close(); });
}
