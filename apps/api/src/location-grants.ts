import type { LocationPermission } from "@smart-church/contracts";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Pool } from "pg";

export const locationPermissions = [
  "people_view_private", "people_manage", "events_manage", "groups_manage", "resources_manage",
] as const satisfies readonly LocationPermission[];

type LocationGrant = {
  id: string;
  username: string;
  role: "site_admin" | "member";
  permissions: LocationPermission[] | null;
  module_permissions: Record<string, string[]> | null;
  video_permissions: string[] | null;
  presenter_permissions: string[] | null;
  display_name: string;
  is_enabled: boolean;
  is_service_user: boolean;
  requires_password_change: boolean;
};

const grantSelect = `SELECT u.id, u.username, m.role, m.permissions, m.module_permissions, m.video_permissions, m.presenter_permissions,
            u.display_name, u.is_enabled, u.is_service_user,
            (u.must_change_password AND u.can_change_password) AS requires_password_change
       FROM department_memberships m
       JOIN departments d ON d.id = m.department_id
       JOIN app_users u ON u.id = m.user_id`;

const reviewerCanRead = `EXISTS (
    SELECT 1 FROM department_memberships reviewer
    JOIN app_users actor ON actor.id = reviewer.user_id
    WHERE reviewer.department_id = m.department_id AND reviewer.user_id = $3 AND reviewer.role = 'site_admin'
      AND actor.is_enabled AND NOT actor.is_service_user AND NOT (actor.must_change_password AND actor.can_change_password)
  )`;

export async function readLocationGrant(pool: Pick<Pool, "query">, departmentId: string, userId: string | undefined, reviewerId?: string) {
  const { rows } = await pool.query<LocationGrant>(
    `${grantSelect}
      WHERE m.department_id = $1 AND m.user_id = $2
        AND ($3::uuid IS NULL OR ${reviewerCanRead})`,
    [departmentId, userId, reviewerId ?? null],
  );
  return rows[0];
}

export function hasLocationPermission(role: LocationGrant["role"] | null, grants: readonly LocationPermission[] | null, permission: LocationPermission) {
  return role === "site_admin" || Boolean(grants?.includes(permission));
}

export function canReadPrivateContactDetails(role: LocationGrant["role"] | null, grants: readonly LocationPermission[] | null) {
  return hasLocationPermission(role, grants, "people_view_private") || hasLocationPermission(role, grants, "people_manage");
}

function describeLocationGrant(grant: LocationGrant) {
  const status = !grant.is_enabled ? "disabled" : grant.is_service_user ? "service" : grant.requires_password_change ? "password_required" : "enabled";
  const { video, ...modulePermissions } = grant.module_permissions ?? {};
  return {
    displayName: grant.display_name,
    role: grant.role,
    status,
    permissions: locationPermissions.map((permission) => ({
      permission,
      source: grant.role === "site_admin" ? "site_role" : grant.permissions?.includes(permission) ? "direct" : "none",
    })),
    canViewPrivateContactDetails: canReadPrivateContactDetails(grant.role, grant.permissions),
    modulePermissions: {
      ...modulePermissions,
      "video-steffisburg": modulePermissions["video-steffisburg"] ?? video ?? grant.video_permissions ?? [],
      presenter: modulePermissions.presenter ?? grant.presenter_permissions ?? [],
    },
  };
}

export function registerLocationAccessPreview(app: FastifyInstance, getPool: () => Pool | null | undefined,
  resolveLocation: (request: FastifyRequest, reply: FastifyReply) => Promise<string | null>) {
  app.get<{ Querystring: { q?: string; withGrants?: boolean; page?: number } }>("/api/location-access/matrix", {
    schema: { querystring: { type: "object", additionalProperties: false, properties: {
      q: { type: "string", maxLength: 80 },
      withGrants: { type: "boolean" },
      page: { type: "integer", minimum: 1, maximum: 2000 },
    } } },
  }, async (request, reply) => {
    const reviewerId = request.authenticatedUser?.id;
    if (!reviewerId || request.headers.authorization) return reply.code(403).send({ error: "A site administrator browser session is required." });
    const pool = getPool();
    if (!pool) return reply.code(503).send({ error: "The account database is unavailable." });
    const departmentId = await resolveLocation(request, reply);
    if (!departmentId) return reply;
    const page = request.query.page ?? 1;
    const pageSize = 50;
    const { rows } = await pool.query<LocationGrant>(
      `${grantSelect}
       WHERE m.department_id = $1 AND ${reviewerCanRead}
         AND ($2 = '' OR strpos(lower(u.display_name), lower($2)) > 0
               OR (NOT u.is_service_user AND strpos(lower(u.username), lower($2)) > 0))
         AND (NOT $4::boolean OR m.role = 'site_admin'
              OR m.permissions && $5::text[]
              OR COALESCE(NULLIF(m.module_permissions->'video-steffisburg', 'null'::jsonb), NULLIF(m.module_permissions->'video', 'null'::jsonb), to_jsonb(m.video_permissions), '[]'::jsonb) <> '[]'::jsonb
              OR COALESCE(NULLIF(m.module_permissions->'presenter', 'null'::jsonb), to_jsonb(m.presenter_permissions), '[]'::jsonb) <> '[]'::jsonb
              OR EXISTS (SELECT 1 FROM jsonb_each(CASE WHEN jsonb_typeof(m.module_permissions) = 'object' THEN m.module_permissions ELSE '{}'::jsonb END) grants
                         WHERE grants.key NOT IN ('video-steffisburg', 'video', 'presenter')
                           AND jsonb_typeof(grants.value) = 'array' AND grants.value <> '[]'::jsonb))
       ORDER BY lower(u.display_name), u.id LIMIT $6 OFFSET $7`,
      [departmentId, request.query.q?.trim() ?? "", reviewerId, request.query.withGrants ?? false, locationPermissions, pageSize + 1, (page - 1) * pageSize],
    );
    return reply.header("Cache-Control", "private, no-store").send({
      page,
      hasNext: rows.length > pageSize && page < 2000,
      accounts: rows.slice(0, pageSize).map((grant) => ({
        id: grant.id,
        ...(!grant.is_service_user ? { username: grant.username } : {}),
        ...describeLocationGrant(grant),
      })),
    });
  });

  app.get<{ Params: { userId: string } }>("/api/location-access/:userId/preview", {
    schema: { params: { type: "object", required: ["userId"], properties: { userId: { type: "string", format: "uuid" } } } },
  }, async (request, reply) => {
    const reviewerId = request.authenticatedUser?.id;
    if (!reviewerId || request.headers.authorization) return reply.code(403).send({ error: "A site administrator browser session is required." });
    const pool = getPool();
    if (!pool) return reply.code(503).send({ error: "The account database is unavailable." });
    const departmentId = await resolveLocation(request, reply);
    if (!departmentId) return reply;

    reply.header("Cache-Control", "private, no-store");
    const grant = await readLocationGrant(pool, departmentId, request.params.userId, reviewerId);
    if (!grant) return reply.code(404).send({ error: "This account has no membership at the selected location." });
    return describeLocationGrant(grant);
  });
}
