import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ModuleServerContext } from "../module-sdk.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function registerModuleRoutes(app: FastifyInstance, context: ModuleServerContext) {
  const { pool, isDatabaseReady, resolveDepartmentId, validateMutation, realtime } = context;
  async function scope(request: FastifyRequest, reply: FastifyReply, write = false) {
    if (!pool || !isDatabaseReady()) { reply.code(503).send({ error: "Check-in is unavailable while the database is offline." }); return null; }
    const departmentId = await resolveDepartmentId(request, reply);
    if (!departmentId) return null;
    const grants = request.activeDepartmentModulePermissions?.["check-in"] ?? [];
    const permissions = request.activeDepartmentPermissions ?? [];
    const allowed = request.activeDepartmentRole === "site_admin" || grants.includes("manage") || (!write && grants.includes("view")) || (write && (permissions.includes("events_manage") || permissions.includes("groups_manage")));
    if (!allowed) { reply.code(403).send({ error: write ? "Event or group management access is required." : "Check-in view access is required." }); return null; }
    return departmentId;
  }
  const canManage = (request: FastifyRequest) => request.activeDepartmentRole === "site_admin"
    || (request.activeDepartmentModulePermissions?.["check-in"] ?? []).includes("manage")
    || (request.activeDepartmentPermissions ?? []).some((permission) => permission === "events_manage" || permission === "groups_manage");
  app.get("/api/modules/check-in/bootstrap", async (request, reply) => {
    const departmentId = await scope(request, reply); if (!departmentId) return reply;
    const hierarchyAvailable = (await pool!.query<{ present: boolean }>("SELECT to_regclass('public.group_hierarchy_history') IS NOT NULL AS present")).rows[0]?.present ?? false;
    const [events, groups] = await Promise.all([
      pool!.query(`SELECT event.id,event.title,event.kind,event.event_date AS "eventDate",event.start_time AS "startTime",event.end_time AS "endTime",event.location,session.completed_at AS "completedAt"
        FROM service_events event LEFT JOIN check_in_sessions session ON session.event_id=event.id AND session.department_id=event.department_id
        WHERE event.department_id=$1 AND event.event_date >= current_date - 30 ORDER BY event.event_date DESC,event.start_time DESC LIMIT 200`, [departmentId]),
      hierarchyAvailable
        ? pool!.query(`SELECT g.id,g.name,g.description,g.parent_group_id AS "parentGroupId",COUNT(m.contact_id)::int AS "memberCount" FROM church_groups g LEFT JOIN group_members m ON m.group_id=g.id AND m.status='active' WHERE g.department_id=$1 AND g.status='active' GROUP BY g.id ORDER BY g.name`, [departmentId])
        : pool!.query(`SELECT g.id,g.name,g.description,NULL::uuid AS "parentGroupId",COUNT(m.contact_id)::int AS "memberCount" FROM church_groups g LEFT JOIN group_members m ON m.group_id=g.id AND m.status='active' WHERE g.department_id=$1 AND g.status='active' GROUP BY g.id ORDER BY g.name`, [departmentId]),
    ]);
    return { events: events.rows, groups: groups.rows, hierarchyAvailable, canManage: canManage(request) };
  });
  app.put<{ Params: { eventId: string }; Body: { complete: boolean } }>("/api/modules/check-in/events/:eventId/session", {
    schema: { params: { type: "object", additionalProperties: false, required: ["eventId"], properties: { eventId: { type: "string", format: "uuid" } } }, body: { type: "object", additionalProperties: false, required: ["complete"], properties: { complete: { type: "boolean" } } } },
  }, async (request, reply) => {
    const departmentId = await scope(request, reply, true); if (!departmentId) return reply;
    if (!validateMutation(request, reply)) return reply;
    const event = await pool!.query("SELECT id FROM service_events WHERE id=$1 AND department_id=$2", [request.params.eventId, departmentId]);
    if (!event.rowCount) return reply.code(404).send({ error: "Meeting not found in this location." });
    if (request.body.complete) await pool!.query(`INSERT INTO check_in_sessions(department_id,event_id,completed_by) VALUES($1,$2,$3)
      ON CONFLICT(department_id,event_id) DO UPDATE SET completed_by=EXCLUDED.completed_by,completed_at=now(),updated_at=now()`, [departmentId, request.params.eventId, request.authenticatedUser?.id ?? null]);
    else await pool!.query("DELETE FROM check_in_sessions WHERE department_id=$1 AND event_id=$2", [departmentId, request.params.eventId]);
    realtime.publish("module:check-in:changed", departmentId, { eventId: request.params.eventId, complete: request.body.complete });
    return { complete: request.body.complete };
  });
  app.get<{ Params: { eventId: string }; Querystring: { groups?: string; includeChildGroups?: boolean } }>("/api/modules/check-in/events/:eventId/roster", { schema: { querystring: { type: "object", additionalProperties: false, properties: { groups: { type: "string", maxLength: 2000 }, includeChildGroups: { type: "boolean" } } } } }, async (request, reply) => {
    const departmentId = await scope(request, reply); if (!departmentId) return reply;
    const event = await pool!.query("SELECT id FROM service_events WHERE id=$1 AND department_id=$2", [request.params.eventId, departmentId]);
    if (!event.rowCount) return reply.code(404).send({ error: "Meeting not found in this location." });
    const rawGroupIds = (request.query.groups ?? "").split(",").filter(Boolean);
    if (rawGroupIds.some((id) => !UUID_PATTERN.test(id))) return reply.code(400).send({ error: "One or more selected groups are invalid." });
    const groupIds = [...new Set(rawGroupIds)];
    if (!groupIds.length) return { attendees: [] };
    const groups = await pool!.query("SELECT id FROM church_groups WHERE department_id=$1 AND id=ANY($2::uuid[]) AND status='active'", [departmentId, groupIds]);
    if (groups.rowCount !== groupIds.length) return reply.code(403).send({ error: "One or more groups are outside this location." });
    const hierarchyAvailable = (await pool!.query<{ present: boolean }>("SELECT to_regclass('public.group_hierarchy_history') IS NOT NULL AS present")).rows[0]?.present ?? false;
    const includeChildren = Boolean(request.query.includeChildGroups && hierarchyAvailable);
    const roster = await pool!.query(includeChildren ? `WITH RECURSIVE selected_groups(id) AS (
      SELECT g.id FROM church_groups g WHERE g.department_id=$1 AND g.id=ANY($3::uuid[]) AND g.status='active'
      UNION
      SELECT child.id FROM church_groups child JOIN selected_groups parent ON child.parent_group_id=parent.id WHERE child.department_id=$1 AND child.status='active'
    ) SELECT DISTINCT c.id,c.first_name AS "firstName",c.last_name AS "lastName",c.email,c.phone,
      COALESCE(ch.first_time_visitor,false) AS "firstTimeVisitor",ch.checked_in_at AS "checkedInAt",
      array_agg(DISTINCT g.name ORDER BY g.name) AS groups
      FROM group_members gm JOIN church_groups g ON g.id=gm.group_id AND g.department_id=$1 AND g.status='active'
      JOIN contacts c ON c.id=gm.contact_id AND c.department_id=$1 AND c.status='member'
      LEFT JOIN event_attendance_checkins ch ON ch.event_id=$2 AND ch.contact_id=c.id
      WHERE gm.group_id IN (SELECT id FROM selected_groups) AND gm.status='active'
      GROUP BY c.id,ch.first_time_visitor,ch.checked_in_at ORDER BY c.last_name,c.first_name` : `SELECT DISTINCT c.id,c.first_name AS "firstName",c.last_name AS "lastName",c.email,c.phone,
      COALESCE(ch.first_time_visitor,false) AS "firstTimeVisitor",ch.checked_in_at AS "checkedInAt",
      array_agg(DISTINCT g.name ORDER BY g.name) AS groups
      FROM group_members gm JOIN church_groups g ON g.id=gm.group_id AND g.department_id=$1 AND g.status='active'
      JOIN contacts c ON c.id=gm.contact_id AND c.department_id=$1 AND c.status='member'
      LEFT JOIN event_attendance_checkins ch ON ch.event_id=$2 AND ch.contact_id=c.id
      WHERE gm.group_id=ANY($3::uuid[]) AND gm.status='active'
      GROUP BY c.id,ch.first_time_visitor,ch.checked_in_at ORDER BY c.last_name,c.first_name`, [departmentId, request.params.eventId, groupIds]);
    const attendees = roster.rows as Array<Record<string, unknown> & { id: string }>;
    if (canManage(request) && attendees.length) {
      const pickupRows = await pool!.query<{ child_contact_id: string; id: string; name: string }>(
        `SELECT authorization.child_contact_id,authorized.id,concat_ws(' ',authorized.first_name,authorized.last_name) AS name
           FROM check_in_pickup_authorizations authorization
           JOIN contacts authorized ON authorized.id=authorization.authorized_contact_id AND authorized.department_id=$1
          WHERE authorization.department_id=$1 AND authorization.child_contact_id=ANY($2::uuid[])
          ORDER BY lower(authorized.last_name),lower(authorized.first_name)`, [departmentId, attendees.map((attendee) => attendee.id)],
      );
      const byChild = new Map<string, Array<{ id: string; name: string }>>();
      for (const row of pickupRows.rows) byChild.set(row.child_contact_id, [...(byChild.get(row.child_contact_id) ?? []), { id: row.id, name: row.name }]);
      return { attendees: attendees.map((attendee) => ({ ...attendee, authorizedPickups: byChild.get(attendee.id) ?? [] })) };
    }
    return { attendees: attendees.map((attendee) => ({ ...attendee, authorizedPickups: [] })) };
  });

  app.put<{ Params: { eventId: string; contactId: string }; Body: { groupIds: string[]; includeChildGroups?: boolean; authorizedContactIds: string[]; guardianConfirmed: boolean } }>("/api/modules/check-in/events/:eventId/attendees/:contactId/pickups", {
    schema: { body: { type: "object", additionalProperties: false, required: ["groupIds", "authorizedContactIds", "guardianConfirmed"], properties: { groupIds: { type: "array", minItems: 1, maxItems: 50, uniqueItems: true, items: { type: "string", format: "uuid" } }, includeChildGroups: { type: "boolean" }, authorizedContactIds: { type: "array", maxItems: 20, uniqueItems: true, items: { type: "string", format: "uuid" } }, guardianConfirmed: { type: "boolean" } } } },
  }, async (request, reply) => {
    const departmentId = await scope(request, reply, true); if (!departmentId) return reply;
    if (!validateMutation(request, reply)) return reply;
    if (!request.body.guardianConfirmed) return reply.code(400).send({ error: "Confirm that a parent or guardian authorized these pickup contacts." });
    const hierarchyAvailable = Boolean(request.body.includeChildGroups && (await pool!.query<{ present: boolean }>("SELECT to_regclass('public.group_hierarchy_history') IS NOT NULL AS present")).rows[0]?.present);
    const membership = await pool!.query(hierarchyAvailable ? `WITH RECURSIVE selected_groups(id) AS (
        SELECT id FROM church_groups WHERE department_id=$2 AND id=ANY($4::uuid[]) AND status='active'
        UNION SELECT child.id FROM church_groups child JOIN selected_groups parent ON child.parent_group_id=parent.id WHERE child.department_id=$2 AND child.status='active'
      ) SELECT 1 FROM service_events event JOIN contacts child ON child.id=$3 AND child.department_id=event.department_id
        JOIN group_members member ON member.contact_id=child.id AND member.status='active' AND member.group_id IN (SELECT id FROM selected_groups)
       WHERE event.id=$1 AND event.department_id=$2 LIMIT 1` : `SELECT 1 FROM service_events event JOIN contacts child ON child.id=$3 AND child.department_id=event.department_id
       JOIN group_members member ON member.contact_id=child.id AND member.status='active' AND member.group_id=ANY($4::uuid[])
       JOIN church_groups group_row ON group_row.id=member.group_id AND group_row.department_id=event.department_id AND group_row.status='active'
       WHERE event.id=$1 AND event.department_id=$2 LIMIT 1`,
      [request.params.eventId, departmentId, request.params.contactId, request.body.groupIds],
    );
    if (!membership.rowCount) return reply.code(404).send({ error: "Meeting attendee not found in this location." });
    if (request.body.authorizedContactIds.includes(request.params.contactId)) return reply.code(400).send({ error: "A child cannot be their own authorized pickup contact." });
    const validContacts = request.body.authorizedContactIds.length ? await pool!.query(
      "SELECT id FROM contacts WHERE department_id=$1 AND id=ANY($2::uuid[])", [departmentId, request.body.authorizedContactIds],
    ) : { rowCount: 0, rows: [] };
    if (validContacts.rowCount !== request.body.authorizedContactIds.length) return reply.code(400).send({ error: "One or more pickup contacts are outside this location." });
    if (request.body.authorizedContactIds.length) {
      const eligible = await pool!.query(hierarchyAvailable ? `WITH RECURSIVE selected_groups(id) AS (
          SELECT id FROM church_groups WHERE department_id=$1 AND id=ANY($2::uuid[]) AND status='active'
          UNION SELECT child.id FROM church_groups child JOIN selected_groups parent ON child.parent_group_id=parent.id WHERE child.department_id=$1 AND child.status='active'
        ) SELECT count(DISTINCT member.contact_id)::int AS count FROM group_members member JOIN contacts contact ON contact.id=member.contact_id AND contact.department_id=$1 AND contact.status='member'
         WHERE member.status='active' AND member.group_id IN (SELECT id FROM selected_groups) AND member.contact_id=ANY($3::uuid[])` : `SELECT count(DISTINCT member.contact_id)::int AS count FROM group_members member
          JOIN church_groups group_row ON group_row.id=member.group_id AND group_row.department_id=$1 AND group_row.status='active'
          JOIN contacts contact ON contact.id=member.contact_id AND contact.department_id=$1 AND contact.status='member'
         WHERE member.status='active' AND member.group_id=ANY($2::uuid[]) AND member.contact_id=ANY($3::uuid[])`,
        [departmentId, request.body.groupIds, request.body.authorizedContactIds],
      );
      if (Number(eligible.rows[0]?.count ?? 0) !== request.body.authorizedContactIds.length) return reply.code(400).send({ error: "Choose pickup contacts from the selected active-member roster." });
    }
    const client = await pool!.connect();
    try {
      await client.query("BEGIN");
      await client.query("DELETE FROM check_in_pickup_authorizations WHERE department_id=$1 AND child_contact_id=$2", [departmentId, request.params.contactId]);
      for (const authorizedId of request.body.authorizedContactIds) await client.query(
        "INSERT INTO check_in_pickup_authorizations(department_id,child_contact_id,authorized_contact_id,created_by,guardian_confirmed_by,guardian_confirmed_at) VALUES($1,$2,$3,$4,$4,now())",
        [departmentId, request.params.contactId, authorizedId, request.authenticatedUser?.id ?? null],
      );
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
    realtime.publish("module:check-in:changed", departmentId, { eventId: request.params.eventId, contactId: request.params.contactId, action: "pickup-authorizations" });
    return { saved: true };
  });
  app.put<{ Params: { eventId: string; contactId: string }; Body: { present: boolean; firstTimeVisitor?: boolean; groupIds: string[]; includeChildGroups?: boolean } }>("/api/modules/check-in/events/:eventId/attendees/:contactId", { schema: { body: { type: "object", additionalProperties: false, required: ["present", "groupIds"], properties: { present: { type: "boolean" }, firstTimeVisitor: { type: "boolean" }, includeChildGroups: { type: "boolean" }, groupIds: { type: "array", minItems: 1, maxItems: 50, uniqueItems: true, items: { type: "string", format: "uuid" } } } } } }, async (request, reply) => {
    const departmentId = await scope(request, reply, true); if (!departmentId) return reply;
    if (!validateMutation(request, reply)) return reply;
    const hierarchyAvailable = Boolean(request.body.includeChildGroups && (await pool!.query<{ present: boolean }>("SELECT to_regclass('public.group_hierarchy_history') IS NOT NULL AS present")).rows[0]?.present);
    const valid = await pool!.query(hierarchyAvailable ? `WITH RECURSIVE selected_groups(id) AS (
      SELECT g.id FROM church_groups g WHERE g.department_id=$2 AND g.id=ANY($4::uuid[]) AND g.status='active'
      UNION
      SELECT child.id FROM church_groups child JOIN selected_groups parent ON child.parent_group_id=parent.id WHERE child.department_id=$2 AND child.status='active'
    ) SELECT 1 FROM service_events e JOIN contacts c ON c.department_id=e.department_id
      JOIN group_members gm ON gm.contact_id=c.id AND gm.status='active' AND gm.group_id IN (SELECT id FROM selected_groups)
      WHERE e.id=$1 AND e.department_id=$2 AND c.id=$3` : `SELECT 1 FROM service_events e JOIN contacts c ON c.department_id=e.department_id
      JOIN group_members gm ON gm.contact_id=c.id AND gm.status='active' AND gm.group_id=ANY($4::uuid[])
      JOIN church_groups g ON g.id=gm.group_id AND g.department_id=e.department_id AND g.status='active'
      WHERE e.id=$1 AND e.department_id=$2 AND c.id=$3`, [request.params.eventId, departmentId, request.params.contactId, request.body.groupIds]);
    if (!valid.rowCount) return reply.code(404).send({ error: "Meeting or attendee not found in this location." });
    if (request.body.present) await pool!.query(`INSERT INTO event_attendance_checkins(event_id,contact_id,first_time_visitor) VALUES($1,$2,$3) ON CONFLICT(event_id,contact_id) DO UPDATE SET first_time_visitor=EXCLUDED.first_time_visitor,updated_at=now()`, [request.params.eventId, request.params.contactId, request.body.firstTimeVisitor ?? false]);
    else await pool!.query("DELETE FROM event_attendance_checkins WHERE event_id=$1 AND contact_id=$2", [request.params.eventId, request.params.contactId]);
    realtime.publish("module:check-in:changed", departmentId, { eventId: request.params.eventId, contactId: request.params.contactId, present: request.body.present });
    return { present: request.body.present };
  });
}
