import { createHash, randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Pool, PoolClient } from "pg";
import type { LiveRunSheetAction, LiveRunSheetStatus, ServicePlanItem } from "@smart-church/contracts";

type Dependencies = {
  pool: Pool | null;
  available: () => boolean;
  resolveScope: (request: FastifyRequest, reply: FastifyReply, manage: boolean) => Promise<string | null>;
  validateMutation: (request: FastifyRequest, reply: FastifyReply) => boolean;
  lockDepartmentForWrite: (client: PoolClient, departmentId: string) => Promise<boolean>;
  now?: () => number;
};
type StoredState = {
  revision: string;
  planHash: string;
  active: { mode: "running" | "paused"; index: number; remainingMs: number | null; startedAt: number } | null;
};
type EventRow = { time_plan: ServicePlanItem[] | null; live_run_sheet: StoredState | null; source_system: string | null; cancelled_at: Date | null };
type Params = { id: string };
type Command = { action: LiveRunSheetAction; expectedRevision: string | null };
const path = "/api/events/:id/live-run-sheet";
const maxDurationMs = 86_400_000;
const params = { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } } as const;
const body = { type: "object", additionalProperties: false, required: ["action", "expectedRevision"], properties: {
  action: { type: "string", enum: ["start", "previous", "next", "pause", "resume", "stop"] },
  expectedRevision: { anyOf: [{ type: "string", format: "uuid" }, { type: "null" }] },
} } as const;
const eventQuery = "SELECT time_plan, live_run_sheet, source_system, cancelled_at FROM service_events WHERE department_id=$1 AND id=$2";

function agenda(row: EventRow) {
  const plan = !row.source_system && !row.cancelled_at && Array.isArray(row.time_plan) && row.time_plan.length <= 100
    ? row.time_plan : [];
  const planHash = createHash("sha256").update(JSON.stringify(plan)).digest("hex");
  const saved = row.live_run_sheet;
  const active = saved?.active;
  const state = saved?.planHash === planHash && typeof saved.revision === "string" && (!active
    || ((active.mode === "running" || active.mode === "paused") && Number.isInteger(active.index)
    && Boolean(plan[active.index]) && Number.isFinite(active.startedAt)
    && (active.remainingMs === null || (Number.isFinite(active.remainingMs) && Math.abs(active.remainingMs) <= maxDurationMs))))
    ? saved : null;
  return { plan, planHash, state };
}

function remainingTime(active: NonNullable<StoredState["active"]>, now: number) {
  if (active.remainingMs === null) return null;
  const elapsed = active.mode === "running" ? Math.max(0, now - active.startedAt) : 0;
  return Math.max(-maxDurationMs, active.remainingMs - elapsed);
}

function status(plan: ServicePlanItem[], state: StoredState | null, now: number): LiveRunSheetStatus {
  const active = state?.active;
  return { revision: state?.revision ?? null, active: active ? {
    mode: active.mode, index: active.index, title: plan[active.index].title,
    previous: active.index > 0, nextTitle: plan[active.index + 1]?.title ?? null,
    remainingMs: remainingTime(active, now),
  } : null };
}

function startItem(plan: ServicePlanItem[], index: number, now: number): NonNullable<StoredState["active"]> {
  const minutes = plan[index].durationMinutes;
  return { mode: "running", index, startedAt: now,
    remainingMs: typeof minutes === "number" && Number.isInteger(minutes) && minutes > 0 && minutes <= 1440 ? minutes * 60_000 : null };
}

function transition(plan: ServicePlanItem[], active: StoredState["active"], action: LiveRunSheetAction, now: number) {
  if (!plan.length) return undefined;
  if (action === "start") return active ? undefined : startItem(plan, 0, now);
  if (!active) return undefined;
  if (action === "stop") return null;
  if (action === "pause" && active.mode === "running") {
    return { ...active, mode: "paused" as const, remainingMs: remainingTime(active, now) };
  }
  if (action === "resume" && active.mode === "paused") return { ...active, mode: "running" as const, startedAt: now };
  if (action === "previous" || action === "next") {
    const index = active.index + (action === "previous" ? -1 : 1);
    if (!plan[index]) return undefined;
    return { ...startItem(plan, index, now), mode: active.mode };
  }
  return undefined;
}

export function registerLiveRunSheetRoutes(app: FastifyInstance, { pool, available, resolveScope, validateMutation, lockDepartmentForWrite, now = Date.now }: Dependencies) {
  async function scope(request: FastifyRequest, reply: FastifyReply, manage: boolean) {
    reply.header("Cache-Control", "private, no-store");
    if (!pool || !available()) {
      reply.code(503).send({ error: "The live run sheet is unavailable." });
      return null;
    }
    return resolveScope(request, reply, manage);
  }

  app.get<{ Params: Params }>(path, { schema: { params } }, async (request, reply) => {
    const departmentId = await scope(request, reply, false);
    if (!departmentId) return reply;
    const { rows: [row] } = await pool!.query<EventRow>(eventQuery, [departmentId, request.params.id]);
    if (!row) return reply.code(404).send({ error: "Event not found." });
    const { plan, state } = agenda(row);
    return status(plan, state, now());
  });

  app.put<{ Params: Params; Body: Command }>(path, { schema: { params, body } }, async (request, reply) => {
    const departmentId = await scope(request, reply, true);
    if (!departmentId || !validateMutation(request, reply)) return reply;
    const client = await pool!.connect();
    try {
      await client.query("BEGIN");
      if (!await lockDepartmentForWrite(client, departmentId)) {
        await client.query("ROLLBACK");
        return reply.code(423).send({ error: "This location is read-only." });
      }
      const { rows: [row] } = await client.query<EventRow>(eventQuery + " FOR UPDATE", [departmentId, request.params.id]);
      if (!row) {
        await client.query("ROLLBACK");
        return reply.code(404).send({ error: "Event not found." });
      }
      const { plan, planHash, state } = agenda(row);
      const timestamp = now();
      const active = transition(plan, state?.active ?? null, request.body.action, timestamp);
      if (row.cancelled_at || row.source_system || active === undefined
        || request.body.expectedRevision !== (state?.revision ?? null)) {
        await client.query("ROLLBACK");
        return reply.code(409).send({ error: "Live run-sheet controls changed or are unavailable. The view will refresh." });
      }
      const next: StoredState = { revision: randomUUID(), planHash, active };
      await client.query("UPDATE service_events SET live_run_sheet=$3::jsonb WHERE department_id=$1 AND id=$2",
        [departmentId, request.params.id, JSON.stringify(next)]);
      await client.query("COMMIT");
      return status(plan, next, timestamp);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  });
}
