import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { PoolClient } from "pg";
import type { ModuleServerContext } from "../module-sdk.js";

export type MemberStatus = "active" | "paused" | "waitlist";
export type RoutineStep =
  | { kind: "wait"; minutes: number }
  | { kind: "followup"; subject: string; assigneeId: string; dueDays: number }
  | { kind: "membership"; role?: string; status?: MemberStatus };

type Job = {
  id: string; department_id: string; group_id: string; routine_id: string; contact_id: string;
  next_step: number; chain: string[]; enabled: boolean; steps: RoutineStep[];
  trigger_role: string; trigger_status: MemberStatus; actor_id: string | null;
};
type Candidate = Pick<Job, "id" | "group_id" | "contact_id" | "routine_id">;

export async function automaticRoutineAuthority(client: Pick<PoolClient, "query">, departmentId: string, groupId: string, actorId: string | null) {
  const { rows: [grant] } = await client.query<{ manage_group: boolean; manage_members: boolean }>(
    `SELECT (membership.role='site_admin' OR 'groups_manage'=ANY(membership.permissions)) AS manage_members,
            (membership.role='site_admin' OR 'groups_manage'=ANY(membership.permissions) OR
             COALESCE(membership.module_permissions->'group-operations','[]'::jsonb) @> '["manage"]'::jsonb OR EXISTS (
               SELECT 1 FROM group_members member WHERE member.group_id=$2 AND member.contact_id=membership.contact_id AND member.status='active'
                 AND regexp_replace(lower(member.role),'[^a-z]','','g') IN ('leader','coleader','groupowner','groupmanager')
             )) AS manage_group
       FROM department_memberships membership JOIN app_users actor ON actor.id=membership.user_id
      WHERE membership.department_id=$1 AND membership.user_id=$3 AND actor.is_enabled AND NOT actor.is_service_user
        AND NOT (actor.must_change_password AND actor.can_change_password)`,
    [departmentId, groupId, actorId],
  );
  return grant;
}

async function finish(client: PoolClient, id: string, phase: "completed" | "cancelled" | "failed", next: number, explanation: string | null) {
  await client.query("UPDATE group_automatic_routine_runs SET phase=$2,next_step=$3,outcome=$4,updated_at=now() WHERE id=$1",
    [id, phase, next, explanation]);
}

async function processCandidate(client: PoolClient, context: ModuleServerContext, departmentId: string, candidate: Candidate, now: Date) {
  if (!await context.lockDepartmentForWrite(client, departmentId)) return null;
  const { rows: [rule] } = await client.query<Pick<Job, "enabled" | "steps" | "trigger_role" | "trigger_status" | "actor_id"> & { eligible: boolean }>(
    `SELECT rule.enabled,rule.steps,lower(trim(rule.trigger_role)) AS trigger_role,rule.trigger_status,rule.authorized_by AS actor_id,
            (groups.status='active' AND groups.source_system IS NULL AND 'group-operations'=ANY(site.enabled_modules)) AS eligible
       FROM group_automatic_routines rule
       JOIN church_groups groups ON groups.id=rule.group_id AND groups.department_id=rule.department_id
       JOIN departments site ON site.id=rule.department_id
      WHERE rule.id=$1 AND rule.group_id=$2 AND rule.department_id=$3 FOR SHARE OF rule,groups`, [candidate.routine_id, candidate.group_id, departmentId],
  );
  if (!rule) return null;
  const { rows: [member] } = await client.query<{ role: string; status: MemberStatus }>(
    "SELECT lower(trim(role)) AS role,status FROM group_members WHERE group_id=$1 AND contact_id=$2 FOR UPDATE", [candidate.group_id, candidate.contact_id],
  );
  const { rows: [progress] } = await client.query<Omit<Job, keyof typeof rule>>(
    `SELECT * FROM group_automatic_routine_runs WHERE id=$1 AND department_id=$2 AND routine_id=$3
        AND phase IN ('queued','waiting') AND due_at<=$4 FOR UPDATE`, [candidate.id, departmentId, candidate.routine_id, now],
  );
  const job = progress && { ...progress, ...rule };
  if (!job) return null;
  if (!job.enabled || !job.eligible || member?.role !== job.trigger_role || member?.status !== job.trigger_status) {
    await finish(client, job.id, "cancelled", job.next_step, "The membership or routine is no longer eligible.");
    return { groupId: job.group_id, membershipChanged: false };
  }
  const authority = await automaticRoutineAuthority(client, departmentId, job.group_id, job.actor_id);
  if (!authority?.manage_group || (job.steps.some((step) => step.kind === "membership") && !authority.manage_members)) {
    await finish(client, job.id, "failed", job.next_step, "The routine owner no longer has the required permissions.");
    return { groupId: job.group_id, membershipChanged: false };
  }
  for (let next = job.next_step; next < job.steps.length; next += 1) {
    const step = job.steps[next];
    if (step.kind === "wait") {
      await client.query("UPDATE group_automatic_routine_runs SET phase='waiting',next_step=$2,due_at=$3,updated_at=now() WHERE id=$1",
        [job.id, next + 1, new Date(now.getTime() + step.minutes * 60_000)]);
      return { groupId: job.group_id, membershipChanged: false };
    }
    if (step.kind === "followup") {
      const assignee = await client.query(
        `SELECT 1 FROM group_members member JOIN contacts person ON person.id=member.contact_id AND person.department_id=$3
          WHERE member.group_id=$1 AND member.contact_id=$2 AND member.status='active'`,
        [job.group_id, step.assigneeId, departmentId],
      );
      if (!assignee.rowCount) {
        await finish(client, job.id, "failed", next, "The follow-up assignee is no longer an active group member.");
        return { groupId: job.group_id, membershipChanged: false };
      }
      const taskId = randomUUID();
      await client.query(
        `INSERT INTO group_follow_up_tasks(id,department_id,group_id,contact_id,assigned_contact_id,subject,due_date,created_by)
         SELECT $1,$2,$3,$4,$5,$6,(($7::timestamptz AT TIME ZONE COALESCE(zone.name,'UTC'))::date + $8::int),$9
           FROM departments site LEFT JOIN pg_timezone_names zone ON zone.name=site.time_zone WHERE site.id=$2`,
        [taskId, departmentId, job.group_id, job.contact_id, step.assigneeId, step.subject, now, step.dueDays, job.actor_id],
      );
      await client.query(`INSERT INTO group_operations_audit(id,department_id,group_id,actor_user_id,action,record_id,details)
        VALUES($1,$2,$3,$4,'follow_up_created',$5,jsonb_build_object('automaticRoutineRunId',$6::uuid))`,
        [randomUUID(), departmentId, job.group_id, job.actor_id, taskId, job.id]);
    }
    if (step.kind === "membership") {
      await finish(client, job.id, "completed", next + 1, null);
      await client.query("SELECT set_config('smart_church.automatic_routine_chain',$1,true),set_config('smart_church.actor_id',$2,true)",
        ["{" + job.chain.join(",") + "}", job.actor_id]);
      await client.query(`UPDATE group_members SET role=COALESCE($3,role),status=COALESCE($4,status),auto_managed=false
         WHERE group_id=$1 AND contact_id=$2`, [job.group_id, job.contact_id, step.role ?? null, step.status ?? null]);
      return { groupId: job.group_id, membershipChanged: true };
    }
  }
  await finish(client, job.id, "completed", job.steps.length, null);
  return { groupId: job.group_id, membershipChanged: false };
}

export async function runAutomaticGroupRoutines(context: ModuleServerContext, now = new Date(), onError: (error: unknown) => void = () => {}) {
  if (!context.pool || !context.isDatabaseReady() || !context.activation.isEnabled()) return;
  const { rows: sites } = await context.pool.query<{ department_id: string }>(
    `SELECT DISTINCT progress.department_id FROM group_automatic_routine_runs progress JOIN departments site ON site.id=progress.department_id
      WHERE progress.phase IN ('queued','waiting') AND progress.due_at<=$1 AND 'group-operations'=ANY(site.enabled_modules)`, [now],
  );
  for (const { department_id: departmentId } of sites) {
    if (!await context.isDepartmentWritable(departmentId)) continue;
    const { rows: candidates } = await context.pool.query<Candidate>(
      `SELECT id,group_id,contact_id,routine_id FROM group_automatic_routine_runs WHERE department_id=$1
        AND phase IN ('queued','waiting') AND due_at<=$2 ORDER BY due_at,id LIMIT 100`, [departmentId, now],
    );
    for (const candidate of candidates) {
      const client = await context.pool.connect();
      try {
        await client.query("BEGIN");
        const change = await processCandidate(client, context, departmentId, candidate, now);
        await client.query("COMMIT");
        if (change) {
          context.realtime.publish("module:group-operations:changed", departmentId, { action: "automatic-routine-progress", groupId: change.groupId });
          if (change.membershipChanged) context.realtime.publish("core:groups:changed", departmentId, { groupId: change.groupId });
        }
      } catch (error) {
        await client.query("ROLLBACK");
        onError(error);
      } finally {
        client.release();
      }
    }
  }
}

export function startAutomaticGroupRoutineWorker(app: FastifyInstance, context: ModuleServerContext) {
  let timer: NodeJS.Timeout | undefined;
  let running: Promise<void> | undefined;
  app.addHook("onReady", async () => {
    const onError = (err: unknown) => app.log.error({ err }, "Group automatic routine worker failed.");
    timer = setInterval(() => {
      if (running) return;
      running = runAutomaticGroupRoutines(context, new Date(), onError).catch(onError).finally(() => { running = undefined; });
    }, 60_000);
    timer.unref();
  });
  app.addHook("onClose", async () => {
    clearInterval(timer);
    await running;
  });
}
