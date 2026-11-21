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

const matrixPermissionSources = ["site_role", "direct", "via_people_manage"] as const;
const matrixAccountStatuses = ["enabled", "disabled", "service", "password_required"] as const;
type MatrixQuery = {
  q?: string;
  withGrants?: boolean;
  page?: number;
  permission?: LocationPermission;
  permissionSource?: typeof matrixPermissionSources[number];
  accountStatus?: typeof matrixAccountStatuses[number];
};

export function registerLocationAccessPreview(app: FastifyInstance, getPool: () => Pool | null | undefined,
  resolveLocation: (request: FastifyRequest, reply: FastifyReply) => Promise<string | null>) {
  app.get<{ Querystring: MatrixQuery }>("/api/location-access/matrix", {
    schema: { querystring: { type: "object", additionalProperties: false, properties: {
      q: { type: "string", maxLength: 80 },
      withGrants: { type: "boolean" },
      permission: { type: "string", enum: locationPermissions },
      permissionSource: { type: "string", enum: matrixPermissionSources },
      accountStatus: { type: "string", enum: matrixAccountStatuses },
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
    const permission = request.query.permission ?? null;
    const permissionSource = request.query.permissionSource ?? null;
    if (permissionSource && !permission) return reply.code(400).send({ error: "Choose a permission before filtering by source." });
    const { rows: [matching] } = await pool.query<{ total: number; accounts: LocationGrant[] }>(
      `WITH candidates AS (
         ${grantSelect}
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
       ), effective AS (
         SELECT *,CASE
           WHEN role='site_admin' THEN 'site_role'
           WHEN $6::text=ANY(permissions) THEN 'direct'
           WHEN $6='people_view_private' AND 'people_manage'=ANY(permissions) THEN 'via_people_manage'
         END AS permission_source,
         CASE
           WHEN NOT is_enabled THEN 'disabled' WHEN is_service_user THEN 'service'
           WHEN requires_password_change THEN 'password_required' ELSE 'enabled'
         END AS account_status FROM candidates
       ), filtered AS (
         SELECT * FROM effective
         WHERE ($8::text IS NULL OR $8=account_status)
           AND ($6 IS NULL OR (permission_source IS NOT NULL AND ($7::text IS NULL OR $7=permission_source)))
       ), selected_page AS (
         SELECT * FROM filtered ORDER BY lower(display_name),id LIMIT $9 OFFSET $10
       )
       SELECT (SELECT count(*)::int FROM filtered) AS total,
              COALESCE((SELECT jsonb_agg(to_jsonb(selected_page) ORDER BY lower(display_name), id) FROM selected_page),'[]'::jsonb) AS accounts`,
      [departmentId, request.query.q?.trim() ?? "", reviewerId, request.query.withGrants ?? false, locationPermissions,
        permission, permissionSource, request.query.accountStatus ?? null, pageSize, (page - 1) * pageSize],
    );
    return reply.header("Cache-Control", "private, no-store").send({
      page,
      total: matching.total,
      hasNext: matching.total > page * pageSize && page < 2000,
      accounts: matching.accounts.map((grant) => ({
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
