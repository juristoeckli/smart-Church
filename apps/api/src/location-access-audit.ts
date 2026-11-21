import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Pool, PoolClient } from "pg";

type Role = "site_admin" | "member";
type AuditSource = "location_access" | "server_accounts";
type AuditAction = "granted" | "changed" | "revoked";
type Actor = { id: string; displayName: string };
type GrantRow = {
  department_id: string;
  role: Role;
  contact_id: string | null;
  permissions: string[] | null;
  video_permissions: string[] | null;
  presenter_permissions: string[] | null;
  module_permissions: Record<string, string[]> | null;
};

export const locationAccessWriteLock = "SELECT pg_advisory_xact_lock(1196571730, 4)";

export async function lockLocationAccessAdministrator(client: Pick<PoolClient, "query">, departmentId: string, userId: string) {
  const result = await client.query(
    `SELECT location.id FROM departments location
       JOIN department_memberships membership ON membership.department_id=location.id
      WHERE location.id=$1 AND membership.user_id=$2 AND membership.role='site_admin'
      FOR UPDATE OF location,membership`, [departmentId, userId],
  );
  return Boolean(result.rowCount);
}

export async function readLocationAccessGrants(client: Pick<PoolClient, "query">, userId: string, departmentId?: string) {
  const result = await client.query<GrantRow>(
    `SELECT department_id,role,contact_id,permissions,video_permissions,presenter_permissions,module_permissions
       FROM department_memberships WHERE user_id=$1 AND ($2::uuid IS NULL OR department_id=$2)
      ORDER BY department_id FOR UPDATE`, [userId, departmentId ?? null],
  );
  return result.rows;
}

function sortedGrants(value: unknown) {
  return Array.isArray(value) ? [...new Set(value.filter((grant): grant is string => typeof grant === "string"))].sort() : [];
}

function grantState(row: GrantRow) {
  const modules = row.module_permissions ?? {};
  const effective: Record<string, string[] | null> = { ...modules, "video-steffisburg": modules["video-steffisburg"] ?? modules.video ?? row.video_permissions,
    presenter: modules.presenter ?? row.presenter_permissions };
  const modulePermissions = row.role === "site_admin" ? {} : Object.fromEntries(Object.keys(effective).sort().filter((name) => name !== "video").flatMap((name) => {
    const grants = sortedGrants(effective[name]);
    return grants.length ? [[name, grants]] : [];
  }));
  return { role: row.role, contactId: row.contact_id, permissions: row.role === "site_admin" ? [] : sortedGrants(row.permissions), modulePermissions };
}

export async function recordLocationAccessChanges(client: Pick<PoolClient, "query">, actor: Actor, target: Actor, source: AuditSource, before: GrantRow[], after: GrantRow[]) {
  const oldState = new Map(before.map((row) => [row.department_id, grantState(row)]));
  const newState = new Map(after.map((row) => [row.department_id, grantState(row)]));
  const changes = [...new Set([...oldState.keys(), ...newState.keys()])].sort().flatMap((departmentId) => {
    const previous = oldState.get(departmentId) ?? null;
    const current = newState.get(departmentId) ?? null;
    if (JSON.stringify(previous) === JSON.stringify(current)) return [];
    return [{ department_id: departmentId, action: previous ? current ? "changed" : "revoked" : "granted", before_access: previous, after_access: current }];
  });
  if (!changes.length) return;
  await client.query(
    `INSERT INTO location_access_audit(id,department_id,actor_user_id,actor_name,target_user_id,target_name,source,action,before_access,after_access)
       SELECT gen_random_uuid(),change.department_id,$2,$3,$4,$5,$6,change.action,change.before_access,change.after_access
         FROM jsonb_to_recordset($1::jsonb) AS change(department_id uuid,action text,before_access jsonb,after_access jsonb)`,
    [JSON.stringify(changes), actor.id, actor.displayName, target.id, target.displayName, source],
  );
}

export function registerLocationAccessHistory(app: FastifyInstance, getPool: () => Pool | null | undefined, resolveSiteAdminDepartment: (request: FastifyRequest, reply: FastifyReply) => Promise<string | null>) {
  app.get<{ Querystring: { q?: string; action?: AuditAction } }>("/api/location-access/history", {
    schema: { querystring: { type: "object", additionalProperties: false, properties: {
      q: { type: "string", maxLength: 80 }, action: { type: "string", enum: ["granted", "changed", "revoked"] },
    } } },
  }, async (request, reply) => {
    const pool = getPool();
    if (!pool) return reply.code(503).send({ error: "The account database is unavailable." });
    const departmentId = await resolveSiteAdminDepartment(request, reply);
    if (!departmentId) return reply;
    const result = await pool.query(
      `SELECT id,actor_name AS "actorName",target_name AS "targetName",action,source,
              before_access AS "beforeAccess",after_access AS "afterAccess",created_at AS "createdAt"
         FROM location_access_audit WHERE department_id=$1 AND ($2::text IS NULL OR action=$2)
          AND ($3='' OR strpos(lower(actor_name),lower($3))>0 OR strpos(lower(target_name),lower($3))>0)
          AND EXISTS (SELECT 1 FROM department_memberships WHERE department_id=$1 AND user_id=$4 AND role='site_admin')
        ORDER BY created_at DESC,id DESC LIMIT 100`, [departmentId, request.query.action ?? null, request.query.q?.trim() ?? "", request.authenticatedUser!.id],
    );
    return reply.header("cache-control", "private, no-store").send(result.rows);
  });
}
