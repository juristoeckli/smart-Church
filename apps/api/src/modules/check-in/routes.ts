import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ModuleServerContext } from "../module-sdk.js";
import { completedCheckInError, isCheckInComplete, lockCheckInEvent } from "../../event-attendance.js";

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
    const permissions = request.activeDepartmentPermissions ?? [];
    const canAddVisitor = (request.activeDepartmentRole === "site_admin" || permissions.includes("events_manage") || (request.activeDepartmentModulePermissions?.["check-in"] ?? []).includes("manage"))
      && (request.activeDepartmentRole === "site_admin" || permissions.includes("people_manage"));
    return { events: events.rows, groups: groups.rows, hierarchyAvailable, canManage: canManage(request), canAddVisitor };
  });
  app.put<{ Params: { eventId: string }; Body: { complete: boolean } }>("/api/modules/check-in/events/:eventId/session", {
    schema: { params: { type: "object", additionalProperties: false, required: ["eventId"], properties: { eventId: { type: "string", format: "uuid" } } }, body: { type: "object", additionalProperties: false, required: ["complete"], properties: { complete: { type: "boolean" } } } },
  }, async (request, reply) => {
    const departmentId = await scope(request, reply, true); if (!departmentId) return reply;
    if (!validateMutation(request, reply)) return reply;
    const eventId = request.params.eventId;
    const client = await pool!.connect();
    try {
      await client.query("BEGIN");
      if (!await lockCheckInEvent(client, departmentId, eventId)) {
        await client.query("ROLLBACK");
        return reply.code(404).send({ error: "Meeting not found in this location." });
      }
      if (request.body.complete) {
        await client.query(`INSERT INTO check_in_sessions(department_id,event_id,completed_by) VALUES($1,$2,$3)
          ON CONFLICT(department_id,event_id) DO NOTHING`, [departmentId, eventId, request.authenticatedUser?.id ?? null]);
      } else {
        await client.query("DELETE FROM check_in_sessions WHERE department_id=$1 AND event_id=$2", [departmentId, eventId]);
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
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
    const canViewPrivatePeople = request.activeDepartmentRole === "site_admin" || (request.activeDepartmentPermissions ?? []).some((permission) => permission === "people_view_private" || permission === "people_manage");
    const visitors = await pool!.query(`SELECT contact.id,contact.first_name AS "firstName",contact.last_name AS "lastName",
        CASE WHEN $3::boolean THEN contact.email ELSE NULL END AS email,CASE WHEN $3::boolean THEN contact.phone ELSE NULL END AS phone,
        checkin.first_time_visitor AS "firstTimeVisitor",checkin.checked_in_at AS "checkedInAt",ARRAY['Visitor']::text[] AS groups,true AS "isVisitor"
      FROM event_attendance_checkins checkin JOIN contacts contact ON contact.id=checkin.contact_id AND contact.department_id=$1
      WHERE checkin.event_id=$2 AND contact.status='visitor'
      ORDER BY contact.last_name,contact.first_name`, [departmentId, request.params.eventId, canViewPrivatePeople]);
    const attendees = [...roster.rows, ...visitors.rows] as Array<Record<string, unknown> & { id: string }>;
    if (canManage(request) && attendees.length) {
      const pickupRows = await pool!.query<{ child_contact_id: string; id: string | null; name: string; released_at: Date | null; legacy: boolean }>(
        `SELECT pickup.child_contact_id,authorized.id,COALESCE(NULLIF(concat_ws(' ',authorized.first_name,authorized.last_name),''),'Removed contact') AS name,pickup.released_at,false AS legacy
           FROM check_in_event_pickups pickup
      LEFT JOIN contacts authorized ON authorized.id=pickup.authorized_contact_id AND authorized.department_id=$1
          WHERE pickup.department_id=$1 AND pickup.child_contact_id=ANY($2::uuid[])
            AND pickup.event_id=$3
            AND (pickup.released_at IS NOT NULL OR (authorized.status='member' AND authorized.archived_at IS NULL))
         UNION ALL
         SELECT pickup.child_contact_id,authorized.id,concat_ws(' ',authorized.first_name,authorized.last_name),NULL,true
           FROM check_in_pickup_authorizations pickup
           JOIN contacts authorized ON authorized.id=pickup.authorized_contact_id AND authorized.department_id=$1 AND authorized.status='member' AND authorized.archived_at IS NULL
          WHERE pickup.department_id=$1 AND pickup.child_contact_id=ANY($2::uuid[])
          ORDER BY name`, [departmentId, attendees.map((attendee) => attendee.id), request.params.eventId],
      );
      const byChild = new Map<string, Array<{ id: string; name: string }>>();
      const legacyByChild = new Map<string, string[]>();
      const releases = new Map<string, { name: string; at: Date }>();
      for (const row of pickupRows.rows) {
        if (row.legacy && row.id) {
          legacyByChild.set(row.child_contact_id, [...(legacyByChild.get(row.child_contact_id) ?? []), row.id]);
          continue;
        }
        if (row.id) byChild.set(row.child_contact_id, [...(byChild.get(row.child_contact_id) ?? []), { id: row.id, name: row.name }]);
        if (row.released_at) releases.set(row.child_contact_id, { name: row.name, at: row.released_at });
      }
      return { attendees: attendees.map((attendee) => ({ ...attendee, authorizedPickups: byChild.get(attendee.id) ?? [], previousPickupIds: legacyByChild.get(attendee.id) ?? [], pickupRelease: releases.get(attendee.id) ?? null })) };
    }
    return { attendees: attendees.map((attendee) => ({ ...attendee, authorizedPickups: [] })) };
  });

  app.put<{ Params: { eventId: string; contactId: string }; Body: { groupIds: string[]; includeChildGroups?: boolean; authorizedContactIds: string[]; guardianConfirmed: boolean } }>("/api/modules/check-in/events/:eventId/attendees/:contactId/pickups", {
    schema: { body: { type: "object", additionalProperties: false, required: ["groupIds", "authorizedContactIds", "guardianConfirmed"], properties: { groupIds: { type: "array", minItems: 1, maxItems: 50, uniqueItems: true, items: { type: "string", format: "uuid" } }, includeChildGroups: { type: "boolean" }, authorizedContactIds: { type: "array", maxItems: 20, uniqueItems: true, items: { type: "string", format: "uuid" } }, guardianConfirmed: { type: "boolean" } } } },
  }, async (request, reply) => {
    const departmentId = await scope(request, reply, true); if (!departmentId) return reply;
    if (!validateMutation(request, reply)) return reply;
    if (![request.params.eventId, request.params.contactId].every((id) => UUID_PATTERN.test(id))) return reply.code(400).send({ error: "Invalid meeting or attendee." });
    if (!request.body.guardianConfirmed) return reply.code(400).send({ error: "Confirm that a parent or guardian authorized these pickup contacts." });
    const selectedGroups = await pool!.query("SELECT id FROM church_groups WHERE department_id=$1 AND id=ANY($2::uuid[]) AND status='active'", [departmentId, request.body.groupIds]);
    if (selectedGroups.rowCount !== request.body.groupIds.length) return reply.code(403).send({ error: "One or more selected groups are outside this location." });
    const hierarchyAvailable = Boolean(request.body.includeChildGroups && (await pool!.query<{ present: boolean }>("SELECT to_regclass('public.group_hierarchy_history') IS NOT NULL AS present")).rows[0]?.present);
    const membership = await pool!.query(hierarchyAvailable ? `WITH RECURSIVE selected_groups(id) AS (
        SELECT id FROM church_groups WHERE department_id=$2 AND id=ANY($4::uuid[]) AND status='active'
        UNION SELECT child.id FROM church_groups child JOIN selected_groups parent ON child.parent_group_id=parent.id WHERE child.department_id=$2 AND child.status='active'
      ) SELECT 1 FROM service_events event JOIN contacts child ON child.id=$3 AND child.department_id=event.department_id AND child.status='member' AND child.archived_at IS NULL
        JOIN group_members member ON member.contact_id=child.id AND member.status='active' AND member.group_id IN (SELECT id FROM selected_groups)
       WHERE event.id=$1 AND event.department_id=$2 LIMIT 1` : `SELECT 1 FROM service_events event JOIN contacts child ON child.id=$3 AND child.department_id=event.department_id AND child.status='member' AND child.archived_at IS NULL
       JOIN group_members member ON member.contact_id=child.id AND member.status='active' AND member.group_id=ANY($4::uuid[])
       JOIN church_groups group_row ON group_row.id=member.group_id AND group_row.department_id=event.department_id AND group_row.status='active'
       WHERE event.id=$1 AND event.department_id=$2 LIMIT 1`,
      [request.params.eventId, departmentId, request.params.contactId, request.body.groupIds],
    );
    if (!membership.rowCount) return reply.code(404).send({ error: "Meeting attendee not found in this location." });
    if (request.body.authorizedContactIds.some((id) => id.toLowerCase() === request.params.contactId.toLowerCase())) return reply.code(400).send({ error: "A child cannot be their own authorized pickup contact." });
    const validContacts = request.body.authorizedContactIds.length ? await pool!.query(
      "SELECT id FROM contacts WHERE department_id=$1 AND status='member' AND archived_at IS NULL AND id=ANY($2::uuid[])", [departmentId, request.body.authorizedContactIds],
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
      const attendeeParams = [departmentId, request.params.eventId, request.params.contactId];
      await client.query("SELECT id FROM service_events WHERE department_id=$1 AND id=$2 FOR UPDATE", [departmentId, request.params.eventId]);
      const released = await client.query("SELECT 1 FROM check_in_event_pickups WHERE department_id=$1 AND event_id=$2 AND child_contact_id=$3 AND released_at IS NOT NULL", attendeeParams);
      if (released.rowCount) {
        await client.query("ROLLBACK");
        return reply.code(409).send({ error: "Pickup contacts are locked after release." });
      }
      await client.query("DELETE FROM check_in_event_pickups WHERE department_id=$1 AND event_id=$2 AND child_contact_id=$3", attendeeParams);
      for (const authorizedId of request.body.authorizedContactIds) await client.query(
        "INSERT INTO check_in_event_pickups(department_id,event_id,child_contact_id,authorized_contact_id,guardian_confirmed_by) VALUES($1,$2,$3,$4,$5)",
        [...attendeeParams, authorizedId, request.authenticatedUser?.id ?? null],
      );
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
    realtime.publish("module:check-in:changed", departmentId, { eventId: request.params.eventId, contactId: request.params.contactId, action: "pickup-authorizations" });
    return { saved: true };
  });
  app.put<{
    Params: { eventId: string; contactId: string };
    Body: { authorizedContactId: string; identityCheck: "photo_id" | "personally_known" };
  }>("/api/modules/check-in/events/:eventId/attendees/:contactId/release", {
    schema: {
      params: { type: "object", additionalProperties: false, required: ["eventId", "contactId"], properties: { eventId: { type: "string", format: "uuid" }, contactId: { type: "string", format: "uuid" } } },
      body: { type: "object", additionalProperties: false, required: ["authorizedContactId", "identityCheck"], properties: { authorizedContactId: { type: "string", format: "uuid" }, identityCheck: { type: "string", enum: ["photo_id", "personally_known"] } } },
    },
  }, async (request, reply) => {
    const departmentId = await scope(request, reply, true); if (!departmentId) return reply;
    if (!validateMutation(request, reply)) return reply;
    const { eventId, contactId } = request.params;
    const { authorizedContactId, identityCheck } = request.body;
    const client = await pool!.connect();
    try {
      await client.query("BEGIN");
      const event = await client.query("SELECT id FROM service_events WHERE department_id=$1 AND id=$2 FOR UPDATE", [departmentId, eventId]);
      if (!event.rowCount) {
        await client.query("ROLLBACK");
        return reply.code(404).send({ error: "Meeting not found in this location." });
      }
      const existing = await client.query<{ authorized_contact_id: string | null; released_at: Date }>(
        "SELECT authorized_contact_id,released_at FROM check_in_event_pickups WHERE department_id=$1 AND event_id=$2 AND child_contact_id=$3 AND released_at IS NOT NULL",
        [departmentId, eventId, contactId],
      );
      if (existing.rows[0]) {
        await client.query("COMMIT");
        if (existing.rows[0].authorized_contact_id === authorizedContactId.toLowerCase()) return { releasedAt: existing.rows[0].released_at };
        return reply.code(409).send({ error: "This attendee has already been released." });
      }
      const checkedIn = await client.query(
        `SELECT 1 FROM event_attendance_checkins attendance
          JOIN contacts child ON child.id=attendance.contact_id AND child.department_id=$1 AND child.status='member' AND child.archived_at IS NULL
         WHERE attendance.event_id=$2 AND attendance.contact_id=$3 FOR UPDATE OF attendance`,
        [departmentId, eventId, contactId],
      );
      if (!checkedIn.rowCount) {
        await client.query("ROLLBACK");
        return reply.code(409).send({ error: "The attendee must be checked in before release." });
      }
      const released = await client.query<{ released_at: Date }>(
        `UPDATE check_in_event_pickups pickup SET released_at=now(),released_by=$5,identity_check=$6
           FROM contacts adult WHERE pickup.department_id=$1 AND pickup.event_id=$2 AND pickup.child_contact_id=$3
            AND pickup.authorized_contact_id=$4 AND adult.id=pickup.authorized_contact_id AND adult.department_id=$1
            AND adult.status='member' AND adult.archived_at IS NULL RETURNING pickup.released_at`,
        [departmentId, eventId, contactId, authorizedContactId, request.authenticatedUser?.id ?? null, identityCheck],
      );
      if (!released.rows[0]) {
        await client.query("ROLLBACK");
        return reply.code(403).send({ error: "This contact is not authorized for this meeting." });
      }
      await client.query("COMMIT");
      realtime.publish("module:check-in:changed", departmentId, { eventId, contactId, action: "pickup-release" });
      return { releasedAt: released.rows[0].released_at };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  });
  app.put<{ Params: { eventId: string; contactId: string }; Body: { present: boolean; firstTimeVisitor?: boolean; groupIds: string[];
    includeChildGroups?: boolean; undoRevision?: string } }>("/api/modules/check-in/events/:eventId/attendees/:contactId", { schema: { body: { type: "object", additionalProperties: false, required: ["present", "groupIds"], properties: { present: { type: "boolean" }, firstTimeVisitor: { type: "boolean" }, includeChildGroups: { type: "boolean" },
    undoRevision: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{6}Z$" }, groupIds: { type: "array", minItems: 1, maxItems: 50, uniqueItems: true, items: { type: "string", format: "uuid" } } } } } }, async (request, reply) => {
    const departmentId = await scope(request, reply, true); if (!departmentId) return reply;
    if (!validateMutation(request, reply)) return reply;
    const hierarchyAvailable = Boolean(request.body.includeChildGroups && (await pool!.query<{ present: boolean }>("SELECT to_regclass('public.group_hierarchy_history') IS NOT NULL AS present")).rows[0]?.present);
    const selectedGroups = await pool!.query("SELECT id FROM church_groups WHERE department_id=$1 AND id=ANY($2::uuid[]) AND status='active'", [departmentId, request.body.groupIds]);
    if (selectedGroups.rowCount !== request.body.groupIds.length) return reply.code(403).send({ error: "One or more selected groups are outside this location." });
    const valid = await pool!.query<{ status: "member" | "visitor" }>(hierarchyAvailable ? `WITH RECURSIVE selected_groups(id) AS (
      SELECT g.id FROM church_groups g WHERE g.department_id=$2 AND g.id=ANY($4::uuid[]) AND g.status='active'
      UNION
      SELECT child.id FROM church_groups child JOIN selected_groups parent ON child.parent_group_id=parent.id WHERE child.department_id=$2 AND child.status='active'
    ) SELECT c.status FROM service_events e JOIN contacts c ON c.department_id=e.department_id
      WHERE e.id=$1 AND e.department_id=$2 AND c.id=$3 AND (c.status='visitor' OR EXISTS (
        SELECT 1 FROM group_members gm WHERE gm.contact_id=c.id AND gm.status='active' AND gm.group_id IN (SELECT id FROM selected_groups)))` : `SELECT c.status FROM service_events e JOIN contacts c ON c.department_id=e.department_id
      WHERE e.id=$1 AND e.department_id=$2 AND c.id=$3 AND (c.status='visitor' OR EXISTS (
        SELECT 1 FROM group_members gm JOIN church_groups g ON g.id=gm.group_id AND g.department_id=e.department_id AND g.status='active'
        WHERE gm.contact_id=c.id AND gm.status='active' AND gm.group_id=ANY($4::uuid[])))`, [request.params.eventId, departmentId, request.params.contactId, request.body.groupIds]);
    if (!valid.rowCount) return reply.code(404).send({ error: "Meeting or attendee not found in this location." });
    if (request.body.present && request.body.undoRevision) return reply.code(400).send({ error: "An undo revision can only reset attendance." });
    const revisionSql = `to_char(updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
    const client = await pool!.connect();
    let undoRevision: string | undefined;
    try {
      await client.query("BEGIN");
      if (!await lockCheckInEvent(client, departmentId, request.params.eventId)) {
        await client.query("ROLLBACK");
        return reply.code(404).send({ error: "Meeting not found in this location." });
      }
      if (await isCheckInComplete(client, departmentId, request.params.eventId)) {
        await client.query("ROLLBACK");
        return reply.code(409).send({ error: completedCheckInError });
      }
      const release = await client.query("SELECT 1 FROM check_in_event_pickups WHERE department_id=$1 AND event_id=$2 AND child_contact_id=$3 AND released_at IS NOT NULL", [departmentId, request.params.eventId, request.params.contactId]);
      if (release.rowCount) {
        await client.query("ROLLBACK");
        return reply.code(409).send({ error: "This attendee has already been released." });
      }
      if (request.body.present) {
        let firstTimeVisitor = Boolean(request.body.firstTimeVisitor);
        if (valid.rows[0].status === "visitor") {
          const previousAttendance = await client.query("SELECT 1 FROM event_attendance_checkins WHERE contact_id=$1 AND event_id<>$2 LIMIT 1", [request.params.contactId, request.params.eventId]);
          firstTimeVisitor = previousAttendance.rowCount === 0;
        }
        const keys = [request.params.eventId, request.params.contactId, firstTimeVisitor];
        const arrival = await client.query<{ revision: string }>(
          "INSERT INTO event_attendance_checkins(event_id,contact_id,first_time_visitor) VALUES($1,$2,$3)" +
          " ON CONFLICT(event_id,contact_id) DO NOTHING RETURNING " + revisionSql + " AS revision", keys);
        undoRevision = arrival.rows[0]?.revision;
        if (!undoRevision) {
          await client.query("UPDATE event_attendance_checkins SET first_time_visitor=$3,updated_at=now() WHERE event_id=$1 AND contact_id=$2", keys);
        }
      } else {
        const expected = request.body.undoRevision;
        const removed = await client.query(
          "DELETE FROM event_attendance_checkins WHERE event_id=$1 AND contact_id=$2" + (expected ? " AND " + revisionSql + "=$3" : ""),
          expected ? [request.params.eventId, request.params.contactId, expected] : [request.params.eventId, request.params.contactId],
        );
        if (expected && !removed.rowCount) {
          await client.query("ROLLBACK");
          return reply.code(409).send({ error: "This attendance was changed after check-in. Refresh the roster before editing it." });
        }
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    realtime.publish("module:check-in:changed", departmentId, { eventId: request.params.eventId, contactId: request.params.contactId, present: request.body.present });
    return { present: request.body.present, ...(undoRevision ? { undoRevision } : {}) };
  });
}
