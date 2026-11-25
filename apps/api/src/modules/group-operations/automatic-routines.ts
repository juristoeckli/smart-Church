import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { PoolClient } from "pg";
import type { ModuleServerContext } from "../module-sdk.js";
import { automaticRoutineAuthority, isTerminalMembershipStep, requiresMembershipAuthority, startAutomaticGroupRoutineWorker, type MemberStatus, type RoutineStep } from "./automatic-routine-worker.js";

type GroupParams = { groupId: string };
type RoutineInput = { name: string; role: string; status: MemberStatus; steps: RoutineStep[] };
type Scope = { departmentId: string; groupId: string; actorId: string; active: boolean };
const uuid = { type: "string", format: "uuid" } as const;
const membershipStatus = { type: "string", enum: ["active", "paused", "waitlist"] } as const;
const roleText = { type: "string", minLength: 1, maxLength: 80 } as const;
const groupParams = { type: "object", additionalProperties: false, required: ["groupId"], properties: { groupId: uuid } } as const;
const base = "/api/modules/group-operations/automatic-routines/:groupId";
const stepSchema = { type: "object", additionalProperties: false, required: ["kind"], properties: {
  kind: { type: "string", enum: ["wait", "followup", "membership", "addToGroup", "removeMembership"] },
  minutes: { type: "integer", minimum: 1, maximum: 525600 },
  subject: { type: "string", minLength: 1, maxLength: 160 },
  assigneeId: uuid, dueDays: { type: "integer", minimum: 0, maximum: 365 },
  role: roleText, status: membershipStatus, targetGroupId: uuid,
}, oneOf: [
  { properties: { kind: { const: "wait" } }, required: ["minutes"] },
  { properties: { kind: { const: "followup" } }, required: ["subject", "assigneeId", "dueDays"] },
  { properties: { kind: { const: "membership" } }, anyOf: [{ required: ["role"] }, { required: ["status"] }] },
  { properties: { kind: { const: "addToGroup" } }, required: ["targetGroupId", "role", "status"] },
  { properties: { kind: { const: "removeMembership" } } },
] } as const;

export function registerAutomaticGroupRoutines(app: FastifyInstance, context: ModuleServerContext,
  canManageGroup: (request: FastifyRequest, groupId: string, departmentId: string) => Promise<boolean>) {
  startAutomaticGroupRoutineWorker(app, context);
  const { pool } = context;
  async function scope(request: FastifyRequest<{ Params: GroupParams }>, reply: FastifyReply): Promise<Scope | null> {
    if (!pool || !context.isDatabaseReady()) { reply.code(503).send({ error: "Group Operations is unavailable." }); return null; }
    const departmentId = await context.resolveDepartmentId(request, reply);
    if (!departmentId) return null;
    const groupId = request.params.groupId;
    const { rows: [group] } = await pool.query<{ active: boolean }>(
      `SELECT groups.status='active' AS active FROM church_groups groups JOIN departments site ON site.id=groups.department_id
        WHERE groups.id=$1 AND groups.department_id=$2 AND groups.source_system IS NULL AND 'group-operations'=ANY(site.enabled_modules)`, [groupId, departmentId],
    );
    if (!group) { reply.code(404).send({ error: "Native group not found in this location." }); return null; }
    if (!await canManageGroup(request, groupId, departmentId)) {
      reply.code(403).send({ error: "Group leadership or management access is required to manage automatic routines." }); return null;
    }
    return { departmentId, groupId, actorId: request.authenticatedUser!.id, active: group.active };
  }
  async function mutate(request: FastifyRequest<{ Params: GroupParams }>, reply: FastifyReply,
    write: (client: PoolClient, scope: Scope, membershipAuthority: boolean) => Promise<{ action: string; response: object } | null>) {
    if (!context.validateMutation(request, reply)) return reply;
    const selection = await scope(request, reply);
    if (!selection) return reply;
    const { departmentId, groupId, actorId } = selection;
    const client = await pool!.connect();
    try {
      await client.query("BEGIN");
      if (!await context.lockDepartmentForWrite(client, departmentId)) {
        await client.query("ROLLBACK");
        return reply.code(423).send({ error: "This location is read-only." });
      }
      const { rows: [group] } = await client.query<{ active: boolean }>(
        `SELECT groups.status='active' AS active FROM church_groups groups JOIN departments site ON site.id=groups.department_id
          WHERE groups.id=$1 AND groups.department_id=$2 AND groups.source_system IS NULL AND 'group-operations'=ANY(site.enabled_modules) FOR SHARE OF groups`,
        [groupId, departmentId],
      );
      const authority = group && await automaticRoutineAuthority(client, departmentId, groupId, actorId);
      if (!authority?.manage_group) {
        await client.query("ROLLBACK");
        return reply.code(403).send({ error: "Group leadership or management access is required to manage automatic routines." });
      }
      const result = await write(client, { ...selection, active: group.active }, authority.manage_members);
      if (!result) { await client.query("ROLLBACK"); return reply; }
      await client.query("COMMIT");
      context.realtime.publish("module:group-operations:changed", departmentId, { action: result.action, groupId });
      return reply.send(result.response);
    } catch (error) {
      await client.query("ROLLBACK");
      if (error && typeof error === "object" && "code" in error && error.code === "23505") {
        return reply.code(409).send({ error: "An enabled routine already exists for this role and status." });
      }
      throw error;
    } finally {
      client.release();
    }
  }

  app.get<{ Params: GroupParams }>(base, { schema: { params: groupParams } }, async (request, reply) => {
    const selection = await scope(request, reply);
    if (!selection) return reply;
    const { departmentId, groupId, actorId, active } = selection;
    const args = [departmentId, groupId];
    const [routines, runs, members, authority] = await Promise.all([
      pool!.query(`SELECT id,name,trigger_role AS role,trigger_status AS status,steps,enabled
         FROM group_automatic_routines WHERE department_id=$1 AND group_id=$2 ORDER BY lower(trigger_role),trigger_status`, args),
      pool!.query(`SELECT progress.id,progress.routine_id AS "routineId",progress.contact_id AS "contactId",
          person.first_name || ' ' || person.last_name AS "memberName",progress.phase,progress.next_step AS "nextStep",
          progress.due_at AS "dueAt",progress.outcome
        FROM group_automatic_routine_runs progress
        JOIN contacts person ON person.id=progress.contact_id AND person.department_id=progress.department_id
        WHERE progress.department_id=$1 AND progress.group_id=$2
        ORDER BY (progress.phase IN ('queued','waiting')) DESC,progress.updated_at DESC,progress.id LIMIT 200`, args),
      pool!.query(`SELECT person.id,person.first_name || ' ' || person.last_name AS name,member.status,member.role
         FROM group_members member JOIN contacts person ON person.id=member.contact_id AND person.department_id=$1
        WHERE member.group_id=$2 ORDER BY lower(person.last_name),lower(person.first_name),person.id LIMIT 2000`, args),
      automaticRoutineAuthority(pool!, departmentId, groupId, actorId),
    ]);
    const targets = authority?.manage_members ? await pool!.query(
      `SELECT id,name FROM church_groups WHERE department_id=$1 AND id<>$2 AND status='active' AND source_system IS NULL
        ORDER BY lower(name),id LIMIT 2000`, args,
    ) : null;
    reply.header("Cache-Control", "private, no-store");
    return { active, canChangeMembership: Boolean(authority?.manage_members), routines: routines.rows, runs: runs.rows, targetGroups: targets?.rows ?? [],
      assignees: members.rows.filter((member) => member.status === "active").map(({id, name}) => ({ id, name })),
      roles: [...new Set(members.rows.map((member) => String(member.role).trim()))].sort((a, b) => a.localeCompare(b)) };
  });

  app.post<{ Params: GroupParams; Body: RoutineInput }>(base, { schema: { params: groupParams, body: {
    type: "object", additionalProperties: false, required: ["name", "role", "status", "steps"], properties: {
      name: { type: "string", minLength: 1, maxLength: 120 }, role: roleText, status: membershipStatus,
      steps: { type: "array", minItems: 1, maxItems: 12, items: stepSchema },
    },
  } } }, async (request, reply) => mutate(request, reply, async (client, { departmentId, groupId, actorId, active }, canChangeMembership) => {
    const { name, role, status, steps } = request.body;
    if (!active) { reply.code(409).send({ error: "Activate the group before creating an automatic routine." }); return null; }
    if (!name.trim() || !role.trim()) { reply.code(400).send({ error: "Enter a routine name and trigger role." }); return null; }
    const final = steps.findIndex(isTerminalMembershipStep);
    if (final !== -1 && final !== steps.length - 1) {
      reply.code(400).send({ error: "A membership change must be the last action in the routine." }); return null;
    }
    if (steps.some(requiresMembershipAuthority) && !canChangeMembership) {
      reply.code(403).send({ error: "Group membership management is required for automatic changes to group memberships." }); return null;
    }
    const change = steps[final];
    if (change?.kind === "membership" && !change.role?.trim() && !change.status) {
      reply.code(400).send({ error: "Choose a new membership role or status." }); return null;
    }
    const destinations = steps.filter((step) => step.kind === "addToGroup");
    if (destinations.some((step) => !step.role.trim())) { reply.code(400).send({ error: "Enter a destination role." }); return null; }
    const destinationIds = [...new Set(destinations.map((step) => step.targetGroupId.toLowerCase()))];
    if (destinationIds.length) {
      const targets = await client.query(`SELECT id FROM church_groups WHERE department_id=$1 AND id<>$2 AND id=ANY($3::uuid[])
        AND status='active' AND source_system IS NULL`, [departmentId, groupId, destinationIds]);
      if (targets.rowCount !== destinationIds.length) {
        reply.code(400).send({ error: "Choose a different active native group from this location for each destination." }); return null;
      }
    }
    const followups = steps.filter((step) => step.kind === "followup");
    if (followups.some((step) => !step.subject.trim())) { reply.code(400).send({ error: "Enter a follow-up subject." }); return null; }
    const assigneeIds = [...new Set(followups.map(({ assigneeId }) => assigneeId.toLowerCase()))];
    if (assigneeIds.length) {
      const result = await client.query(
        `SELECT member.contact_id FROM group_members member JOIN contacts person ON person.id=member.contact_id AND person.department_id=$3
          WHERE member.group_id=$1 AND member.contact_id=ANY($2::uuid[]) AND member.status='active'`, [groupId, assigneeIds, departmentId],
      );
      if (result.rowCount !== assigneeIds.length) { reply.code(400).send({ error: "Each follow-up must be assigned to an active member of this group." }); return null; }
    }
    const cleaned = steps.map((step) => {
      if (step.kind === "followup") return { kind: step.kind, subject: step.subject.trim(), assigneeId: step.assigneeId, dueDays: step.dueDays };
      if (step.kind === "membership") return { kind: step.kind, role: step.role?.trim() || undefined, status: step.status };
      if (step.kind === "addToGroup") return { kind: step.kind, targetGroupId: step.targetGroupId.toLowerCase(), role: step.role.trim(), status: step.status };
      if (step.kind === "removeMembership") return { kind: step.kind };
      return { kind: step.kind, minutes: step.minutes };
    });
    const id = randomUUID();
    const saved = await client.query(`INSERT INTO group_automatic_routines
      (id,department_id,group_id,name,trigger_role,trigger_status,steps,created_by,authorized_by)
      VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$8) ON CONFLICT DO NOTHING RETURNING id`,
      [id, departmentId, groupId, name.trim(), role.trim(), status, JSON.stringify(cleaned), actorId],
    );
    if (!saved.rowCount) { reply.code(409).send({ error: "An enabled routine already exists for this role and status." }); return null; }
    reply.code(201);
    return { action: "automatic-routine-created", response: { id } };
  }));

  app.patch<{ Params: GroupParams & { routineId: string }; Body: { enabled: boolean } }>(base + "/:routineId", { schema: {
    params: { ...groupParams, required: ["groupId", "routineId"], properties: { groupId: uuid, routineId: uuid } },
    body: { type: "object", additionalProperties: false, required: ["enabled"], properties: { enabled: { type: "boolean" } } },
  } }, async (request, reply) => mutate(request, reply, async (client, { departmentId, groupId, actorId, active }, canChangeMembership) => {
    const { enabled } = request.body;
    const { routineId } = request.params;
    const { rows: [routine] } = await client.query<{ steps: RoutineStep[]; enabled: boolean; trigger_role: string; trigger_status: MemberStatus }>(
      "SELECT steps,enabled,trigger_role,trigger_status FROM group_automatic_routines WHERE id=$1 AND department_id=$2 AND group_id=$3 FOR UPDATE", [routineId, departmentId, groupId],
    );
    if (!routine) { reply.code(404).send({ error: "Routine not found in this group." }); return null; }
    if (enabled && (!active || (routine.steps.some(requiresMembershipAuthority) && !canChangeMembership))) {
      reply.code(403).send({ error: "An active group and the required management permissions are needed to enable this routine." }); return null;
    }
    if (enabled && !routine.enabled) {
      const occupied = await client.query(`SELECT 1 FROM group_automatic_routines WHERE group_id=$1
        AND lower(trim(trigger_role))=lower(trim($2)) AND trigger_status=$3 AND enabled LIMIT 1`,
        [groupId, routine.trigger_role, routine.trigger_status]);
      if (occupied.rowCount) { reply.code(409).send({ error: "An enabled routine already exists for this role and status." }); return null; }
    }
    if (routine.enabled !== enabled) {
      await client.query("UPDATE group_automatic_routines SET enabled=$2,authorized_by=CASE WHEN $2 THEN $3 ELSE authorized_by END,updated_at=now() WHERE id=$1", [routineId, enabled, actorId]);
      if (!enabled) await client.query(`UPDATE group_automatic_routine_runs SET phase='cancelled',outcome='Routine disabled.',updated_at=now()
        WHERE department_id=$1 AND group_id=$2 AND routine_id=$3 AND phase IN ('queued','waiting')`, [departmentId, groupId, routineId]);
    }
    return { action: "automatic-routine-activation", response: { enabled } };
  }));

  app.post<{ Params: GroupParams & { runId: string } }>(base + "/runs/:runId/skip-wait", { schema: {
    params: { ...groupParams, required: ["groupId", "runId"], properties: { groupId: uuid, runId: uuid } },
  } }, async (request, reply) => mutate(request, reply, async (client, { departmentId, groupId }) => {
    const waiting = await client.query(`UPDATE group_automatic_routine_runs SET due_at=LEAST(due_at,now()),updated_at=now()
      WHERE id=$1 AND department_id=$2 AND group_id=$3 AND phase='waiting' RETURNING id`, [request.params.runId, departmentId, groupId]);
    if (!waiting.rowCount) { reply.code(409).send({ error: "This member is no longer waiting in the routine." }); return null; }
    return { action: "automatic-routine-wait-released", response: { released: true } };
  }));
}
