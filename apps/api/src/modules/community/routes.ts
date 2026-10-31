import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import type { BookableResource, ChurchGroup, LocationPermission, ResourceBooking } from "@smart-church/contracts";
import type { ModuleServerContext } from "../module-sdk.js";
import { registerCommunityReplication } from "./replication.js";

const uuidPattern = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;

type BookableResourceRow = {
  id: string; name: string; category: BookableResource["category"]; description: string; location: string;
  capacity: number | null; requires_approval: boolean; active: boolean; source_system?: string | null;
};

type BookingRow = {
  id: string; resource_id: string; resource_name: string; requested_by: string | null; requester_name: string; source_system?: string | null;
  purpose: string; starts_at: Date | string; ends_at: Date | string; status: ResourceBooking["status"]; created_at: Date | string;
};

function mapGroup(row: { id: string; name: string; description: string; member_count: number; member_ids: string[]; member_details?: ChurchGroup["memberDetails"]; created_at: Date | string; source_system?: string | null; public_signup_enabled?: boolean; public_signup_token?: string | null }): ChurchGroup {
  const memberDetails = (row.member_details ?? []).map((member) => ({ contactId: member.contactId, role: member.role, status: member.status, ...(member.joinedOn ? { joinedOn: String(member.joinedOn).slice(0, 10) } : {}) }));
  return { id: row.id, name: row.name, description: row.description, memberCount: Number(row.member_count), memberIds: row.member_ids ?? [], memberDetails, createdAt: new Date(row.created_at).toISOString(), publicSignupEnabled: row.public_signup_enabled ?? false, ...(row.public_signup_token ? { publicSignupToken: row.public_signup_token } : {}), ...(row.source_system === "churchtools" || row.source_system === "elvanto" ? { importedFrom: row.source_system } : {}) };
}

function mapBookableResource(row: BookableResourceRow): BookableResource {
  return { id: row.id, name: row.name, category: row.category, description: row.description, location: row.location, ...(row.capacity ? { capacity: row.capacity } : {}), requiresApproval: row.requires_approval, active: row.active, ...(row.source_system === "churchtools" ? { importedFrom: "churchtools" as const } : {}) };
}

function mapBooking(row: BookingRow): ResourceBooking {
  return { id: row.id, resourceId: row.resource_id, resourceName: row.resource_name, requestedBy: row.requested_by, requesterName: row.requester_name, purpose: row.purpose, startsAt: new Date(row.starts_at).toISOString(), endsAt: new Date(row.ends_at).toISOString(), status: row.status, createdAt: new Date(row.created_at).toISOString(), ...(row.source_system === "churchtools" ? { importedFrom: "churchtools" as const } : {}) };
}

export function registerModuleRoutes(app: FastifyInstance, dependencies: ModuleServerContext) {
  const { pool, isDatabaseReady, resolveDepartmentId, validateMutation, realtime } = dependencies;
  registerCommunityReplication(dependencies);
  app.register(async (routes) => {
    async function department(request: FastifyRequest, reply: FastifyReply, permission?: LocationPermission) {
      if (!isDatabaseReady() || !pool) {
        reply.code(503).send({ error: "The community database is unavailable." });
        return null;
      }
      return resolveDepartmentId(request, reply, false, false, permission);
    }

    routes.get("/api/groups", async (request, reply) => {
      const departmentId = await department(request, reply);
      if (!departmentId) return reply;
      const result = await pool!.query(
        `SELECT g.id, g.name, g.description, g.created_at, g.source_system, g.public_signup_enabled, g.public_signup_token,
                count(gm.contact_id)::int AS member_count,
                COALESCE(array_agg(gm.contact_id) FILTER (WHERE gm.contact_id IS NOT NULL), ARRAY[]::uuid[]) AS member_ids,
                COALESCE(json_agg(json_build_object('contactId',gm.contact_id,'role',gm.role,'status',gm.status,'joinedOn',gm.joined_on) ORDER BY lower(c.last_name),lower(c.first_name)) FILTER (WHERE gm.contact_id IS NOT NULL), '[]'::json) AS member_details
           FROM church_groups g LEFT JOIN group_members gm ON gm.group_id = g.id LEFT JOIN contacts c ON c.id=gm.contact_id
          WHERE g.department_id = $1 GROUP BY g.id ORDER BY lower(g.name), g.created_at`,
        [departmentId],
      );
      const canManageGroups = request.activeDepartmentRole === "site_admin" || (request.activeDepartmentPermissions ?? []).includes("groups_manage");
      return result.rows.map((row) => {
        const group = mapGroup(row);
        return canManageGroups ? group : (({ publicSignupToken: _token, ...safeGroup }) => safeGroup)(group);
      });
    });

    routes.post<{ Body: { name: string; description?: string } }>("/api/groups", { schema: {
      body: { type: "object", additionalProperties: false, required: ["name"], properties: { name: { type: "string", minLength: 1, maxLength: 120 }, description: { type: "string", maxLength: 1000 } } },
    } }, async (request, reply) => {
      const departmentId = await department(request, reply, "groups_manage");
      if (!departmentId) return reply;
      const name = request.body.name.trim();
      const description = request.body.description?.trim() ?? "";
      if (!name) return reply.code(400).send({ error: "Enter a group name." });
      try {
        const result = await pool!.query(
          `INSERT INTO church_groups (id, department_id, name, description) VALUES ($1, $2, $3, $4)
           RETURNING id, name, description, created_at`,
          [randomUUID(), departmentId, name, description],
        );
        return reply.code(201).send(mapGroup({ ...result.rows[0], member_count: 0, member_ids: [] }));
      } catch (error) {
        if (error && typeof error === "object" && "code" in error && error.code === "23505") return reply.code(409).send({ error: "A group with that name already exists." });
        throw error;
      }
    });

    routes.put<{ Params: { id: string }; Body: { name: string; description?: string } }>("/api/groups/:id", { schema: {
      params: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } },
      body: { type: "object", additionalProperties: false, required: ["name"], properties: { name: { type: "string", minLength: 1, maxLength: 120 }, description: { type: "string", maxLength: 1000 } } },
    } }, async (request, reply) => {
      const departmentId = await department(request, reply, "groups_manage");
      if (!departmentId) return reply;
      const existing = await pool!.query("SELECT source_system FROM church_groups WHERE id=$1 AND department_id=$2", [request.params.id, departmentId]);
      if (!existing.rowCount) return reply.code(404).send({ error: "Group not found." });
      if (existing.rows[0].source_system === "churchtools" || existing.rows[0].source_system === "elvanto") return reply.code(403).send({ error: "This group is managed by an external sync. Edit it in the source system and sync again." });
      const name = request.body.name.trim();
      if (!name) return reply.code(400).send({ error: "Enter a group name." });
      try {
        const result = await pool!.query(
          `UPDATE church_groups SET name = $3, description = $4, updated_at = now()
            WHERE id = $1 AND department_id = $2 RETURNING id, name, description, created_at, source_system, public_signup_enabled, public_signup_token,
              (SELECT count(*)::int FROM group_members WHERE group_id = church_groups.id) AS member_count,
              (SELECT COALESCE(array_agg(contact_id), ARRAY[]::uuid[]) FROM group_members WHERE group_id = church_groups.id) AS member_ids,
              (SELECT COALESCE(json_agg(json_build_object('contactId',gm.contact_id,'role',gm.role,'status',gm.status,'joinedOn',gm.joined_on)), '[]'::json) FROM group_members gm WHERE gm.group_id=church_groups.id) AS member_details`,
          [request.params.id, departmentId, name, request.body.description?.trim() ?? ""],
        );
        if (!result.rowCount) return reply.code(404).send({ error: "Group not found." });
        return mapGroup(result.rows[0]);
      } catch (error) {
        if (error && typeof error === "object" && "code" in error && error.code === "23505") return reply.code(409).send({ error: "A group with that name already exists." });
        throw error;
      }
    });

    routes.put<{ Params: { id: string }; Body: { members: { contactId: string; role: string; status: "active" | "paused" | "waitlist"; joinedOn?: string }[] } }>("/api/groups/:id/members", { schema: {
      params: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } },
      body: { type: "object", additionalProperties: false, required: ["members"], properties: { members: { type: "array", maxItems: 2000, items: { type: "object", additionalProperties: false, required: ["contactId", "role", "status"], properties: { contactId: { type: "string", format: "uuid" }, role: { type: "string", minLength: 1, maxLength: 80 }, status: { type: "string", enum: ["active", "paused", "waitlist"] }, joinedOn: { type: "string", format: "date" } } } } } },
    } }, async (request, reply) => {
      const departmentId = await department(request, reply, "groups_manage");
      if (!departmentId) return reply;
      const client = await pool!.connect();
      try {
        await client.query("BEGIN");
        const group = await client.query("SELECT id,source_system FROM church_groups WHERE id = $1 AND department_id = $2 FOR UPDATE", [request.params.id, departmentId]);
        if (!group.rowCount) { await client.query("ROLLBACK"); return reply.code(404).send({ error: "Group not found." }); }
        if (group.rows[0].source_system === "churchtools" || group.rows[0].source_system === "elvanto") { await client.query("ROLLBACK"); return reply.code(403).send({ error: "This group is managed by an external sync." }); }
        const contactIds = request.body.members.map((member) => member.contactId);
        if (new Set(contactIds).size !== contactIds.length) { await client.query("ROLLBACK"); return reply.code(400).send({ error: "Each person can only appear once." }); }
        if (contactIds.length) {
          const people = await client.query("SELECT id FROM contacts WHERE department_id = $1 AND id = ANY($2::uuid[])", [departmentId, contactIds]);
          if (people.rowCount !== contactIds.length) { await client.query("ROLLBACK"); return reply.code(400).send({ error: "One or more selected people do not belong to this site." }); }
        }
        await client.query("DELETE FROM group_members WHERE group_id = $1", [request.params.id]);
        for (const member of request.body.members) await client.query("INSERT INTO group_members (group_id,contact_id,role,status,joined_on) VALUES ($1,$2,$3,$4,$5)", [request.params.id, member.contactId, member.role.trim(), member.status, member.joinedOn ?? null]);
        await client.query("COMMIT");
        return { memberIds: contactIds, memberDetails: request.body.members };
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally { client.release(); }
    });

    routes.delete<{ Params: { id: string } }>("/api/groups/:id", { schema: { params: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } } } }, async (request, reply) => {
      const departmentId = await department(request, reply, "groups_manage");
      if (!departmentId) return reply;
      const existing = await pool!.query("SELECT source_system FROM church_groups WHERE id=$1 AND department_id=$2", [request.params.id, departmentId]);
      if (!existing.rowCount) return reply.code(404).send({ error: "Group not found." });
      if (existing.rows[0].source_system === "churchtools" || existing.rows[0].source_system === "elvanto") return reply.code(403).send({ error: "This group is managed by an external sync. Remove it in the source system and sync again." });
      const result = await pool!.query("DELETE FROM church_groups WHERE id = $1 AND department_id = $2 RETURNING id", [request.params.id, departmentId]);
      if (!result.rowCount) return reply.code(404).send({ error: "Group not found." });
      return { deleted: true };
    });

    routes.put<{ Params: { id: string }; Body: { enabled: boolean } }>("/api/groups/:id/public-signup", { schema: {
      params: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } },
      body: { type: "object", additionalProperties: false, required: ["enabled"], properties: { enabled: { type: "boolean" } } },
    } }, async (request, reply) => {
      const departmentId = await department(request, reply, "groups_manage");
      if (!departmentId) return reply;
      if (!validateMutation(request, reply)) return reply;
      const existing = await pool!.query<{ source_system: string | null }>("SELECT source_system FROM church_groups WHERE id=$1 AND department_id=$2", [request.params.id, departmentId]);
      if (!existing.rowCount) return reply.code(404).send({ error: "Group not found." });
      if (existing.rows[0].source_system === "churchtools" || existing.rows[0].source_system === "elvanto") return reply.code(403).send({ error: "This group is managed by an external sync." });
      const result = await pool!.query<{ public_signup_enabled: boolean; public_signup_token: string | null }>(
        `UPDATE church_groups SET public_signup_enabled=$3,
           public_signup_token=CASE WHEN $3 THEN COALESCE(public_signup_token,$4::uuid) ELSE NULL END, updated_at=now()
         WHERE id=$1 AND department_id=$2 RETURNING public_signup_enabled,public_signup_token`,
        [request.params.id, departmentId, request.body.enabled, randomUUID()],
      );
      return { enabled: result.rows[0].public_signup_enabled, ...(result.rows[0].public_signup_token ? { token: result.rows[0].public_signup_token } : {}) };
    });

    routes.get<{ Params: { id: string } }>("/api/groups/:id/join-requests", { schema: {
      params: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } },
    } }, async (request, reply) => {
      const departmentId = await department(request, reply, "groups_manage");
      if (!departmentId) return reply;
      const result = await pool!.query(
        `SELECT id,group_id AS "groupId",first_name AS "firstName",last_name AS "lastName",email,status,created_at AS "createdAt"
           FROM group_join_requests WHERE group_id=$1 AND department_id=$2 AND status='pending'
          ORDER BY created_at,id`,
        [request.params.id, departmentId],
      );
      return result.rows;
    });

    routes.put<{ Params: { id: string; requestId: string }; Body: { decision: "approved" | "declined"; contactId?: string } }>("/api/groups/:id/join-requests/:requestId", { schema: {
      params: { type: "object", required: ["id", "requestId"], properties: { id: { type: "string", format: "uuid" }, requestId: { type: "string", format: "uuid" } } },
      body: { type: "object", additionalProperties: false, required: ["decision"], properties: { decision: { type: "string", enum: ["approved", "declined"] }, contactId: { type: "string", format: "uuid" } } },
    } }, async (request, reply) => {
      const departmentId = await department(request, reply, "groups_manage");
      if (!departmentId) return reply;
      if (!validateMutation(request, reply)) return reply;
      const client = await pool!.connect();
      try {
        await client.query("BEGIN");
        const group = await client.query<{ id: string; source_system: string | null }>("SELECT id,source_system FROM church_groups WHERE id=$1 AND department_id=$2 FOR UPDATE", [request.params.id, departmentId]);
        if (!group.rowCount) { await client.query("ROLLBACK"); return reply.code(404).send({ error: "Group not found." }); }
        if (group.rows[0].source_system === "churchtools" || group.rows[0].source_system === "elvanto") { await client.query("ROLLBACK"); return reply.code(403).send({ error: "This group is managed by an external sync." }); }
        const joinRequest = await client.query<{ id: string; first_name: string; last_name: string; email: string }>(
          "SELECT id,first_name,last_name,email FROM group_join_requests WHERE id=$1 AND group_id=$2 AND department_id=$3 AND status='pending' FOR UPDATE",
          [request.params.requestId, request.params.id, departmentId],
        );
        if (!joinRequest.rowCount) { await client.query("ROLLBACK"); return reply.code(404).send({ error: "This join request is no longer pending." }); }
        let contactId: string | null = null;
        if (request.body.decision === "approved") {
          if (request.body.contactId) {
            const selected = await client.query<{ id: string }>("SELECT id FROM contacts WHERE id=$1 AND department_id=$2 AND lower(email)=lower($3)", [request.body.contactId, departmentId, joinRequest.rows[0].email]);
            if (!selected.rowCount) { await client.query("ROLLBACK"); return reply.code(400).send({ error: "Choose a directory person with the same email address, or leave this blank to create a visitor record." }); }
            contactId = selected.rows[0].id;
          } else {
            const matching = await client.query<{ id: string }>("SELECT id FROM contacts WHERE department_id=$1 AND lower(email)=lower($2) ORDER BY id LIMIT 2", [departmentId, joinRequest.rows[0].email]);
            if (matching.rows.length > 1) { await client.query("ROLLBACK"); return reply.code(409).send({ error: "More than one person uses this email. Select the matching person explicitly before approving." }); }
            contactId = matching.rows[0]?.id ?? null;
            if (!contactId) {
              const created = await client.query<{ id: string }>(
                `INSERT INTO contacts (id,department_id,first_name,last_name,email,status) VALUES ($1,$2,$3,$4,$5,'visitor') RETURNING id`,
                [randomUUID(), departmentId, joinRequest.rows[0].first_name, joinRequest.rows[0].last_name, joinRequest.rows[0].email],
              );
              contactId = created.rows[0].id;
            }
          }
          await client.query("INSERT INTO group_members (group_id,contact_id,role,status,joined_on) VALUES ($1,$2,'Member','active',CURRENT_DATE) ON CONFLICT (group_id,contact_id) DO NOTHING", [request.params.id, contactId]);
        }
        await client.query(
          "UPDATE group_join_requests SET status=$3,contact_id=$4,reviewed_at=now(),reviewed_by=$5 WHERE id=$1 AND department_id=$2",
          [request.params.requestId, departmentId, request.body.decision, contactId, request.authenticatedUser!.id],
        );
        await client.query("COMMIT");
        realtime.publish("core:groups:changed", departmentId, { groupId: request.params.id, requestId: request.params.requestId, action: request.body.decision });
        return { status: request.body.decision, ...(contactId ? { contactId } : {}) };
      } catch (error) { await client.query("ROLLBACK"); throw error; }
      finally { client.release(); }
    });

    routes.get<{ Params: { token: string } }>("/api/public/group-signups/:token", { schema: {
      params: { type: "object", required: ["token"], properties: { token: { type: "string", format: "uuid" } } },
    } }, async (request, reply) => {
      if (!isDatabaseReady() || !pool) { reply.code(503).send({ error: "Group registration is temporarily unavailable." }); return reply; }
      const result = await pool!.query<{ name: string; description: string }>(
        "SELECT name,description FROM church_groups WHERE public_signup_token=$1 AND public_signup_enabled=true AND source_system IS NULL",
        [request.params.token],
      );
      if (!result.rowCount) return reply.code(404).send({ error: "This group registration link is unavailable." });
      return { name: result.rows[0].name, description: result.rows[0].description };
    });

    routes.post<{ Params: { token: string }; Body: { firstName: string; lastName: string; email: string } }>("/api/public/group-signups/:token", { schema: {
      params: { type: "object", required: ["token"], properties: { token: { type: "string", format: "uuid" } } },
      body: { type: "object", additionalProperties: false, required: ["firstName", "lastName", "email"], properties: { firstName: { type: "string", minLength: 1, maxLength: 80 }, lastName: { type: "string", minLength: 1, maxLength: 80 }, email: { type: "string", minLength: 3, maxLength: 254, format: "email" } } },
    } }, async (request, reply) => {
      if (!isDatabaseReady() || !pool) { reply.code(503).send({ error: "Group registration is temporarily unavailable." }); return reply; }
      const firstName = request.body.firstName.trim();
      const lastName = request.body.lastName.trim();
      const email = request.body.email.trim().toLocaleLowerCase();
      if (!firstName || !lastName || !email) return reply.code(400).send({ error: "Enter your name and email address." });
      const client = await pool!.connect();
      let groupId = "";
      let groupDepartmentId = "";
      try {
        await client.query("BEGIN");
        const group = await client.query<{ id: string; department_id: string }>("SELECT id,department_id FROM church_groups WHERE public_signup_token=$1 AND public_signup_enabled=true AND source_system IS NULL FOR SHARE", [request.params.token]);
        if (!group.rowCount) { await client.query("ROLLBACK"); return reply.code(404).send({ error: "Registration is closed for this group." }); }
        groupId = group.rows[0].id;
        groupDepartmentId = group.rows[0].department_id;
        if (!await dependencies.lockDepartmentForWrite(client, groupDepartmentId)) { await client.query("ROLLBACK"); return reply.code(423).send({ error: "This group's location is read-only while it is a redundancy standby or fenced site." }); }
        const existing = await client.query("SELECT 1 FROM group_join_requests WHERE group_id=$1 AND lower(email)=lower($2) AND status='pending'", [groupId, email]);
        if (existing.rowCount) { await client.query("ROLLBACK"); return reply.code(409).send({ error: "A request from this email is already waiting for review." }); }
        const member = await client.query(
          `SELECT 1 FROM group_members membership JOIN contacts person ON person.id=membership.contact_id
            WHERE membership.group_id=$1 AND lower(person.email)=lower($2) AND membership.status='active'`,
          [groupId, email],
        );
        if (member.rowCount) { await client.query("ROLLBACK"); return reply.code(409).send({ error: "This email is already connected to an active group member." }); }
        await client.query(
          "INSERT INTO group_join_requests (id,department_id,group_id,first_name,last_name,email) VALUES ($1,$2,$3,$4,$5,$6)",
          [randomUUID(), groupDepartmentId, groupId, firstName, lastName, email],
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        if (error && typeof error === "object" && "code" in error && error.code === "23505") return reply.code(409).send({ error: "A request from this email is already waiting for review." });
        throw error;
      } finally { client.release(); }
      realtime.publish("core:groups:changed", groupDepartmentId, { groupId, action: "join-requested" });
      return reply.code(201).send({ status: "pending" as const });
    });

    routes.get<{ Params: { id: string } }>("/api/groups/:id/meetings", { schema: { params: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } } } }, async (request, reply) => {
      const departmentId = await department(request, reply);
      if (!departmentId) return reply;
      const result = await pool!.query(
        `SELECT m.id, m.meeting_date, m.title, m.created_at,
                count(a.contact_id)::int AS attendee_count,
                count(a.contact_id) FILTER (WHERE a.status='present')::int AS present_count
           FROM group_meetings m LEFT JOIN group_meeting_attendance a ON a.meeting_id=m.id
           JOIN church_groups g ON g.id=m.group_id
          WHERE m.group_id=$1 AND m.department_id=$2 AND g.department_id=$2
          GROUP BY m.id ORDER BY m.meeting_date DESC, m.created_at DESC`,
        [request.params.id, departmentId],
      );
      return result.rows.map((row) => ({ id: row.id, date: String(row.meeting_date).slice(0, 10), title: row.title, attendeeCount: Number(row.attendee_count), presentCount: Number(row.present_count) }));
    });

    routes.post<{ Params: { id: string }; Body: { date: string; title?: string } }>("/api/groups/:id/meetings", { schema: {
      params: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } },
      body: { type: "object", additionalProperties: false, required: ["date"], properties: { date: { type: "string", format: "date" }, title: { type: "string", maxLength: 160 } } },
    } }, async (request, reply) => {
      const departmentId = await department(request, reply, "groups_manage");
      if (!departmentId) return reply;
      const client = await pool!.connect();
      try {
        await client.query("BEGIN");
        const group = await client.query("SELECT id,source_system FROM church_groups WHERE id=$1 AND department_id=$2 FOR UPDATE", [request.params.id, departmentId]);
        if (!group.rowCount) { await client.query("ROLLBACK"); return reply.code(404).send({ error: "Group not found." }); }
        if (group.rows[0].source_system === "churchtools" || group.rows[0].source_system === "elvanto") { await client.query("ROLLBACK"); return reply.code(403).send({ error: "Imported group attendance is managed in the source system." }); }
        const inserted = await client.query(
          `INSERT INTO group_meetings (id, department_id, group_id, meeting_date, title)
           VALUES ($1,$2,$3,$4,$5) ON CONFLICT (group_id,meeting_date,title) DO NOTHING
           RETURNING id,meeting_date,title`,
          [randomUUID(), departmentId, request.params.id, request.body.date, request.body.title?.trim() ?? ""],
        );
        let meeting = inserted.rows[0];
        if (!meeting) {
          meeting = (await client.query("SELECT id,meeting_date,title FROM group_meetings WHERE group_id=$1 AND meeting_date=$2 AND title=$3", [request.params.id, request.body.date, request.body.title?.trim() ?? ""])).rows[0];
        } else {
          await client.query(
            `INSERT INTO group_meeting_attendance (meeting_id,contact_id)
             SELECT $1,gm.contact_id FROM group_members gm JOIN contacts c ON c.id=gm.contact_id AND c.department_id=$2 WHERE gm.group_id=$3 AND gm.status='active'
             ON CONFLICT (meeting_id,contact_id) DO NOTHING`,
            [meeting.id, departmentId, request.params.id],
          );
        }
        await client.query("COMMIT");
        return reply.code(inserted.rowCount ? 201 : 200).send({ id: meeting.id, date: String(meeting.meeting_date).slice(0, 10), title: meeting.title });
      } catch (error) { await client.query("ROLLBACK"); throw error; }
      finally { client.release(); }
    });

    routes.get<{ Params: { id: string } }>("/api/group-meetings/:id/attendance", { schema: { params: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } } } }, async (request, reply) => {
      const departmentId = await department(request, reply);
      if (!departmentId) return reply;
      const result = await pool!.query(
        `SELECT a.contact_id, c.first_name, c.last_name, a.status
           FROM group_meeting_attendance a JOIN contacts c ON c.id=a.contact_id
           JOIN group_meetings m ON m.id=a.meeting_id
          WHERE a.meeting_id=$1 AND m.department_id=$2 AND c.department_id=$2 ORDER BY lower(c.last_name),lower(c.first_name)`,
        [request.params.id, departmentId],
      );
      return result.rows.map((row) => ({ contactId: row.contact_id, firstName: row.first_name, lastName: row.last_name, status: row.status }));
    });

    routes.put<{ Params: { id: string }; Body: { attendance: { contactId: string; status: "present" | "absent" | "excused" }[] } }>("/api/group-meetings/:id/attendance", { schema: {
      params: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } },
      body: { type: "object", additionalProperties: false, required: ["attendance"], properties: { attendance: { type: "array", maxItems: 2000, items: { type: "object", additionalProperties: false, required: ["contactId", "status"], properties: { contactId: { type: "string", format: "uuid" }, status: { type: "string", enum: ["present", "absent", "excused"] } } } } } },
    } }, async (request, reply) => {
      const departmentId = await department(request, reply, "groups_manage");
      if (!departmentId) return reply;
      const client = await pool!.connect();
      try {
        await client.query("BEGIN");
        const meeting = await client.query("SELECT id FROM group_meetings WHERE id=$1 AND department_id=$2 FOR UPDATE", [request.params.id, departmentId]);
        if (!meeting.rowCount) { await client.query("ROLLBACK"); return reply.code(404).send({ error: "Group meeting not found." }); }
        const contactIds = request.body.attendance.map((item) => item.contactId);
        if (new Set(contactIds).size !== contactIds.length) { await client.query("ROLLBACK"); return reply.code(400).send({ error: "Each person can only appear once." }); }
        for (const item of request.body.attendance) {
          const saved = await client.query(
            `UPDATE group_meeting_attendance SET status=$3,updated_at=now() WHERE meeting_id=$1 AND contact_id=$2
             RETURNING contact_id`, [request.params.id, item.contactId, item.status],
          );
          if (!saved.rowCount) { await client.query("ROLLBACK"); return reply.code(400).send({ error: "Attendance includes someone who was not on this meeting's group roster." }); }
        }
        await client.query("COMMIT");
        return { saved: true };
      } catch (error) { await client.query("ROLLBACK"); throw error; }
      finally { client.release(); }
    });

    const bookableResourceBodySchema = { type: "object", additionalProperties: false, required: ["name", "category", "requiresApproval", "active"], properties: {
      name: { type: "string", minLength: 1, maxLength: 120 }, category: { type: "string", enum: ["room", "vehicle", "equipment", "other"] },
      description: { type: "string", maxLength: 1000 }, location: { type: "string", maxLength: 160 }, capacity: { type: "integer", minimum: 1, maximum: 10000 },
      requiresApproval: { type: "boolean" }, active: { type: "boolean" },
    } };

    routes.get("/api/resources", async (request, reply) => {
      const departmentId = await department(request, reply);
      if (!departmentId) return reply;
      const result = await pool!.query<BookableResourceRow>(
        `SELECT id, name, category, description, location, capacity, requires_approval, active, source_system
           FROM bookable_resources WHERE department_id = $1 ${request.activeDepartmentRole === "site_admin" || (request.activeDepartmentPermissions ?? []).includes("resources_manage") ? "" : "AND active = true"}
          ORDER BY active DESC, category, lower(name)`,
        [departmentId],
      );
      return result.rows.map(mapBookableResource);
    });

    routes.post<{ Body: { name: string; category: BookableResource["category"]; description?: string; location?: string; capacity?: number; requiresApproval: boolean; active: boolean } }>("/api/resources", { schema: { body: bookableResourceBodySchema } }, async (request, reply) => {
      const departmentId = await department(request, reply, "resources_manage");
      if (!departmentId) return reply;
      const name = request.body.name.trim();
      if (!name) return reply.code(400).send({ error: "Enter a resource name." });
      try {
        const result = await pool!.query<BookableResourceRow>(
          `INSERT INTO bookable_resources (id, department_id, name, category, description, location, capacity, requires_approval, active)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           RETURNING id, name, category, description, location, capacity, requires_approval, active`,
          [randomUUID(), departmentId, name, request.body.category, request.body.description?.trim() ?? "", request.body.location?.trim() ?? "", request.body.capacity ?? null, request.body.requiresApproval, request.body.active],
        );
        return reply.code(201).send(mapBookableResource(result.rows[0]));
      } catch (error) {
        if (error && typeof error === "object" && "code" in error && error.code === "23505") return reply.code(409).send({ error: "A resource with that name already exists." });
        throw error;
      }
    });

    routes.put<{ Params: { id: string }; Body: { name: string; category: BookableResource["category"]; description?: string; location?: string; capacity?: number; requiresApproval: boolean; active: boolean } }>("/api/resources/:id", { schema: {
      params: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } }, body: bookableResourceBodySchema,
    } }, async (request, reply) => {
      const departmentId = await department(request, reply, "resources_manage");
      if (!departmentId) return reply;
      const existing = await pool!.query("SELECT source_system FROM bookable_resources WHERE id=$1 AND department_id=$2", [request.params.id, departmentId]);
      if (!existing.rowCount) return reply.code(404).send({ error: "Resource not found." });
      if (existing.rows[0].source_system === "churchtools") return reply.code(403).send({ error: "This resource is managed by ChurchTools. Edit it there and sync again." });
      const name = request.body.name.trim();
      if (!name) return reply.code(400).send({ error: "Enter a resource name." });
      try {
        const result = await pool!.query<BookableResourceRow>(
          `UPDATE bookable_resources SET name=$3, category=$4, description=$5, location=$6, capacity=$7, requires_approval=$8, active=$9, updated_at=now()
            WHERE id=$1 AND department_id=$2 RETURNING id, name, category, description, location, capacity, requires_approval, active, source_system`,
          [request.params.id, departmentId, name, request.body.category, request.body.description?.trim() ?? "", request.body.location?.trim() ?? "", request.body.capacity ?? null, request.body.requiresApproval, request.body.active],
        );
        if (!result.rowCount) return reply.code(404).send({ error: "Resource not found." });
        return mapBookableResource(result.rows[0]);
      } catch (error) {
        if (error && typeof error === "object" && "code" in error && error.code === "23505") return reply.code(409).send({ error: "A resource with that name already exists." });
        throw error;
      }
    });

    routes.delete<{ Params: { id: string } }>("/api/resources/:id", { schema: { params: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } } } }, async (request, reply) => {
      const departmentId = await department(request, reply, "resources_manage");
      if (!departmentId) return reply;
      const existing = await pool!.query("SELECT source_system FROM bookable_resources WHERE id=$1 AND department_id=$2", [request.params.id, departmentId]);
      if (!existing.rowCount) return reply.code(404).send({ error: "Resource not found." });
      if (existing.rows[0].source_system === "churchtools") return reply.code(403).send({ error: "This resource is managed by ChurchTools. Remove it there and sync again." });
      const result = await pool!.query("UPDATE bookable_resources SET active=false, updated_at=now() WHERE id=$1 AND department_id=$2 AND active=true RETURNING id", [request.params.id, departmentId]);
      if (!result.rowCount) return reply.code(404).send({ error: "Resource not found." });
      return { archived: true };
    });

    routes.get("/api/resource-bookings", async (request, reply) => {
      const departmentId = await department(request, reply);
      if (!departmentId) return reply;
      const result = await pool!.query<BookingRow>(
        `SELECT b.id, b.resource_id, r.name AS resource_name, b.requested_by,
                COALESCE(u.display_name, 'ChurchTools') AS requester_name, b.source_system,
                b.purpose, b.starts_at, b.ends_at, b.status, b.created_at
           FROM resource_bookings b JOIN bookable_resources r ON r.id=b.resource_id LEFT JOIN app_users u ON u.id=b.requested_by
          WHERE b.department_id=$1 AND b.ends_at > now() - interval '30 days' AND b.starts_at < now() + interval '6 months'
          ORDER BY b.starts_at, r.name`, [departmentId]);
      return result.rows.map(mapBooking);
    });

    routes.post<{ Body: { resourceId: string; purpose: string; startsAt: string; endsAt: string } }>("/api/resource-bookings", { schema: { body: {
      type: "object", additionalProperties: false, required: ["resourceId", "purpose", "startsAt", "endsAt"], properties: {
        resourceId: { type: "string", format: "uuid" }, purpose: { type: "string", minLength: 1, maxLength: 240 },
        startsAt: { type: "string", format: "date-time" }, endsAt: { type: "string", format: "date-time" },
      },
    } } }, async (request, reply) => {
      const departmentId = await department(request, reply);
      if (!departmentId) return reply;
      const startsAt = new Date(request.body.startsAt);
      const endsAt = new Date(request.body.endsAt);
      if (!Number.isFinite(startsAt.getTime()) || !Number.isFinite(endsAt.getTime()) || startsAt <= new Date() || endsAt <= startsAt) return reply.code(400).send({ error: "Choose a future start and an end time after it." });
      const client = await pool!.connect();
      try {
        await client.query("BEGIN");
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))", [departmentId, request.body.resourceId]);
        const resourceResult = await client.query("SELECT id, name, requires_approval FROM bookable_resources WHERE id=$1 AND department_id=$2 AND active=true", [request.body.resourceId, departmentId]);
        const resource = resourceResult.rows[0];
        if (!resource) { await client.query("ROLLBACK"); return reply.code(404).send({ error: "This resource is not available for booking." }); }
        const conflicts = await client.query(
          `SELECT id FROM resource_bookings WHERE department_id=$1 AND resource_id=$2 AND status IN ('requested','approved')
             AND starts_at < $4 AND ends_at > $3 LIMIT 1`,
          [departmentId, request.body.resourceId, startsAt.toISOString(), endsAt.toISOString()],
        );
        if (conflicts.rowCount) { await client.query("ROLLBACK"); return reply.code(409).send({ error: "This resource is already requested or booked during that time." }); }
        const result = await client.query<BookingRow>(
          `INSERT INTO resource_bookings (id, department_id, resource_id, requested_by, purpose, starts_at, ends_at, status)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
           RETURNING id, resource_id, $9::text AS resource_name, requested_by, $10::text AS requester_name, purpose, starts_at, ends_at, status, created_at`,
          [randomUUID(), departmentId, request.body.resourceId, request.authenticatedUser!.id, request.body.purpose.trim(), startsAt.toISOString(), endsAt.toISOString(), resource.requires_approval ? "requested" : "approved", resource.name, request.authenticatedUser!.displayName],
        );
        await client.query("COMMIT");
        return reply.code(201).send(mapBooking(result.rows[0]));
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally { client.release(); }
    });

    routes.put<{ Params: { id: string }; Body: { status: "approved" | "declined" | "cancelled" } }>("/api/resource-bookings/:id/status", { schema: {
      params: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } },
      body: { type: "object", additionalProperties: false, required: ["status"], properties: { status: { type: "string", enum: ["approved", "declined", "cancelled"] } } },
    } }, async (request, reply) => {
      const departmentId = await department(request, reply);
      if (!departmentId) return reply;
      const isAdmin = request.activeDepartmentRole === "site_admin" || (request.activeDepartmentPermissions ?? []).includes("resources_manage");
      const client = await pool!.connect();
      try {
        await client.query("BEGIN");
        const existing = await client.query("SELECT resource_id, requested_by, status, source_system FROM resource_bookings WHERE id=$1 AND department_id=$2 FOR UPDATE", [request.params.id, departmentId]);
        const booking = existing.rows[0];
        if (!booking) { await client.query("ROLLBACK"); return reply.code(404).send({ error: "Booking not found." }); }
        if (booking.source_system === "churchtools") { await client.query("ROLLBACK"); return reply.code(403).send({ error: "This booking was imported from ChurchTools and is read-only." }); }
        if (request.body.status === "cancelled") {
          if (!isAdmin && booking.requested_by !== request.authenticatedUser!.id) { await client.query("ROLLBACK"); return reply.code(403).send({ error: "You can only cancel your own booking." }); }
          if (booking.status === "cancelled" || booking.status === "declined") { await client.query("ROLLBACK"); return reply.code(409).send({ error: "This booking is already closed." }); }
        } else if (!isAdmin || booking.status !== "requested") {
          await client.query("ROLLBACK");
          return reply.code(403).send({ error: "Resource management permission is required to approve or decline a pending request." });
        }
        if (request.body.status === "approved") {
          await client.query("SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))", [departmentId, booking.resource_id]);
          const conflict = await client.query(
            `SELECT id FROM resource_bookings WHERE department_id=$1 AND resource_id=$2 AND id<>$3 AND status='approved'
               AND starts_at < (SELECT ends_at FROM resource_bookings WHERE id=$3) AND ends_at > (SELECT starts_at FROM resource_bookings WHERE id=$3) LIMIT 1`,
            [departmentId, booking.resource_id, request.params.id],
          );
          if (conflict.rowCount) { await client.query("ROLLBACK"); return reply.code(409).send({ error: "Another booking has already been approved for this time." }); }
        }
        await client.query("UPDATE resource_bookings SET status=$3, updated_at=now() WHERE id=$1 AND department_id=$2", [request.params.id, departmentId, request.body.status]);
        await client.query("COMMIT");
        return { updated: true, status: request.body.status };
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally { client.release(); }
    });


  });
}
