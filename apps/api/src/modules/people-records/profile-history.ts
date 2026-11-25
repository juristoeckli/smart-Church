import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ModuleServerContext } from "../module-sdk.js";
import { canManagePeopleFields } from "./field-privacy.js";

const categories = ["profile", "privacy", "relationships", "household", "attachments", "lifecycle", "membership"] as const;
type Category = typeof categories[number];
type TimelineQuery = { category?: Category; from?: string; through?: string; beforeTime?: string; beforeKey?: string };
const pageSize = 50;

export const visibleProfileHistory = `($3::boolean OR NOT h.managers_only) AND ($3::boolean OR h.action NOT IN ('relationship_added','relationship_removed') OR NOT EXISTS (
  SELECT 1 FROM people_record_relationship_types kind
   WHERE kind.department_id=h.department_id AND kind.visibility='people_managers'
     AND kind.id::text IN (h.before_value->>'relationship_type_id',h.after_value->>'relationshipTypeId')
)) AND ($3::boolean OR h.action<>'field_updated' OR EXISTS (
  SELECT 1 FROM people_record_fields field
   WHERE field.department_id=h.department_id AND field.visibility='private_people'
     AND h.subject IN (field.id::text,field.field_key,'bulk:'||field.field_key)
))`;

export function canManageMembershipHistory(request: FastifyRequest) {
  return request.activeDepartmentRole === "site_admin"
    || (request.activeDepartmentPermissions ?? []).includes("groups_manage")
    || (request.activeDepartmentModulePermissions?.["group-hierarchy"] ?? []).includes("manage");
}

export function accessiblePeopleGroups(managerParameter: number, accountParameter: number) {
  return `SELECT g.id,g.name,COALESCE(to_jsonb(g)->>'status','active') AS status
    FROM church_groups g WHERE g.department_id=$1 AND ($${managerParameter}::boolean OR EXISTS (
      SELECT 1 FROM department_memberships account
      JOIN group_members own ON own.contact_id=account.contact_id AND own.group_id=g.id
      WHERE account.department_id=g.department_id AND account.user_id=$${accountParameter} AND own.status='active'
        AND regexp_replace(lower(own.role),'[^a-z]','','g') IN ('leader','coleader','groupowner','groupmanager')
    ))`;
}

const profileHistory = `SELECT h.id,'profile:'||h.id::text AS cursor_key,h.action,
    CASE WHEN h.action='consent_recorded' THEN 'privacy'
         WHEN h.action IN ('relationship_added','relationship_removed') THEN 'relationships'
         WHEN h.action IN ('household_linked','household_unlinked','household_updated') THEN 'household'
         WHEN h.action IN ('attachment_added','attachment_removed','attachment_access_changed') THEN 'attachments'
         WHEN h.action IN ('person_archived','person_restored','person_merged','csv_import_created') THEN 'lifecycle'
         ELSE 'profile' END AS category,
    COALESCE(field.label,h.subject) AS subject,NULL::uuid AS group_id,h.actor_user_id,h.historical_actor_name,h.created_at,
    CASE WHEN h.action='person_merged' THEN jsonb_build_object('mergedContactId',h.before_value->'mergedContactId') ELSE h.before_value END AS before_value,
    h.after_value
  FROM people_record_history h
  LEFT JOIN people_record_fields field ON h.action='field_updated' AND field.department_id=h.department_id
    AND h.subject IN (field.id::text,field.field_key,'bulk:'||field.field_key)
  WHERE h.department_id=$1 AND h.contact_id=$2 AND ${visibleProfileHistory}`;

const membershipHistory = `SELECT id,'membership:'||id::text AS cursor_key,'membership_'||action AS action,
    'membership' AS category,group_name AS subject,group_id,actor_user_id,NULL::text AS historical_actor_name,created_at,before_value,after_value
  FROM (
    SELECT DISTINCT ON (group_id,action,created_at,before_value,after_value) *
    FROM (
      SELECT h.id,g.id AS group_id,g.name AS group_name,h.actor_user_id,h.action,h.created_at,
             CASE WHEN h.before_data IS NOT NULL THEN NULLIF(jsonb_strip_nulls(jsonb_build_object(
               'role',h.before_data->>'role','status',h.before_data->>'status',
               'joinedOn',COALESCE(h.before_data->>'joinedOn',h.before_data->>'joined_on'))),'{}'::jsonb) END AS before_value,
             CASE WHEN h.after_data IS NOT NULL THEN NULLIF(jsonb_strip_nulls(jsonb_build_object(
               'role',h.after_data->>'role','status',h.after_data->>'status',
               'joinedOn',COALESCE(h.after_data->>'joinedOn',h.after_data->>'joined_on'))),'{}'::jsonb) END AS after_value
        FROM group_hierarchy_history h JOIN (${accessiblePeopleGroups(9, 10)}) g ON g.id=h.group_id
       WHERE h.department_id=$1 AND h.entity_kind='membership' AND h.entity_id=$2
    ) changes WHERE action<>'updated' OR before_value IS DISTINCT FROM after_value
    ORDER BY group_id,action,created_at,before_value,after_value,actor_user_id NULLS LAST,id DESC
  ) unique_changes`;

export function registerPeopleHistoryTimeline(routes: FastifyInstance, { pool }: ModuleServerContext, department: (request: FastifyRequest, reply: FastifyReply) => Promise<string | null>) {
  routes.get<{ Params: { contactId: string }; Querystring: TimelineQuery }>("/api/people-records/:contactId/history/timeline", {
    schema: {
      params: { type: "object", required: ["contactId"], properties: { contactId: { type: "string", format: "uuid" } } },
      querystring: { type: "object", additionalProperties: false, properties: {
        category: { type: "string", enum: categories },
        from: { type: "string", format: "date", pattern: "^[1-9][0-9]{3}-" },
        through: { type: "string", format: "date", pattern: "^[1-9][0-9]{3}-" },
        beforeTime: { type: "string", format: "date-time", pattern: "^[1-9][0-9]{3}-" },
        beforeKey: { type: "string", pattern: "^(profile|membership):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$" },
      } },
    },
  }, async (request, reply) => {
    const departmentId = await department(request, reply);
    if (!departmentId) return reply;
    const { contactId } = request.params;
    const { category, from, through, beforeTime, beforeKey } = request.query;
    if (from && through && through < from) return reply.code(400).send({ error: "Choose a valid history date range." });
    if (Boolean(beforeTime) !== Boolean(beforeKey)) return reply.code(400).send({ error: "Choose a valid history cursor." });
    const person = await pool!.query("SELECT 1 FROM contacts WHERE department_id=$1 AND id=$2", [departmentId, contactId]);
    if (!person.rowCount) return reply.code(404).send({ error: "Person not found at this location." });

    const membershipSource = !category || category === "membership"
      ? await pool!.query<{ present: boolean }>("SELECT to_regclass('group_hierarchy_history') IS NOT NULL AS present")
      : null;
    const membershipHistoryAvailable = membershipSource ? membershipSource.rows[0]?.present === true : null;
    const params: Array<string | boolean | null> = [departmentId, contactId, canManagePeopleFields(request), category ?? null, from ?? null, through ?? null, beforeTime ?? null, beforeKey ?? null];
    if (membershipHistoryAvailable) params.push(canManageMembershipHistory(request), request.authenticatedUser!.id);
    const { rows } = await pool!.query<{ cursorTime: string; cursorKey: string } & Record<string, unknown>>(
      `WITH events AS (${profileHistory}${membershipHistoryAvailable ? ` UNION ALL ${membershipHistory}` : ""})
       SELECT events.id,events.action,events.category,events.subject,events.group_id AS "groupId",COALESCE(events.historical_actor_name,account.display_name) AS "actorName",
              events.created_at AS "createdAt",events.before_value AS "beforeValue",events.after_value AS "afterValue",
              to_char(events.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "cursorTime",events.cursor_key AS "cursorKey"
         FROM events JOIN departments location ON location.id=$1
         LEFT JOIN app_users account ON account.id=events.actor_user_id
        WHERE ($4::text IS NULL OR events.category=$4)
          AND ($5::date IS NULL OR events.created_at>=($5::date::timestamp AT TIME ZONE location.time_zone))
          AND ($6::date IS NULL OR events.created_at<(($6::date+1)::timestamp AT TIME ZONE location.time_zone))
          AND ($7::timestamptz IS NULL OR (events.created_at,events.cursor_key)<($7::timestamptz,$8::text))
        ORDER BY events.created_at DESC,events.cursor_key DESC LIMIT ${pageSize + 1}`, params,
    );
    const last = rows.length > pageSize ? rows[pageSize - 1] : null;
    const events = rows.slice(0, pageSize).map(({ cursorTime: _time, cursorKey: _key, ...event }) => event);
    return reply.header("cache-control", "private, no-store").send({
      events,
      membershipHistoryAvailable,
      nextCursor: last ? { beforeTime: last.cursorTime, beforeKey: last.cursorKey } : null,
    });
  });
}
