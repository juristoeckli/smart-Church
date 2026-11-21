import { lockResourceBookingPolicy, resourceCalendarRequired } from "../../resource-booking-policy.js";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { BookableResource, ChurchGroup, GroupLifecycleStatus, LocationPermission, ResourceBooking } from "@smart-church/contracts";
import { isServerModuleEnabled, type ModuleServerContext } from "../module-sdk.js";
import { completionFeedbackSchema, groupFeedbackEnabled, readGroupLeaderFeedback, saveGroupLeaderFeedback, type CompletionFeedback } from "../../group-leader-feedback.js";
import { attendanceReportQuery, sendGroupAttendanceReport, type AttendanceReportQuery } from "./attendance-report.js";
import { groupMemberDraftSchema, groupMembershipState, groupWaitlist, type GroupMembershipDraft } from "./group-waitlist.js";
import { captureSignupAnswers, prepareSignupQuestions, readSignupForm, signupAnswerFields, signupSettingsSchema, type SignupSettings } from "./signup-form.js";
import { previewGroupWaitlistPromotion, promotionBatchSize } from "./group-waitlist-promotion.js";
import { checkGroupAdmissionCapacity } from "./signup-capacity.js";
import { defaultSignupPolicy, editableSignupPolicy, normalizeSignupPolicy, signupState } from "./signup-policy.js";
import { registerCommunityReplication } from "./replication.js";

const uuidPattern = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;

type BookableResourceRow = {
  id: string; name: string; category: BookableResource["category"]; description: string; location: string;
  capacity: number | null; requires_approval: boolean; calendar_required: boolean; active: boolean; source_system?: string | null;
};

type BookingRow = {
  id: string; resource_id: string; resource_name: string; requested_by: string; requester_name: string;
  purpose: string; starts_at: Date | string; ends_at: Date | string; status: ResourceBooking["status"]; created_at: Date | string;
};

function mapGroup(row: { id: string; name: string; description: string; group_type?: string | null; status?: GroupLifecycleStatus; starts_on?: string | Date | null; ends_on?: string | Date | null; member_count: number; member_ids: string[]; member_details?: ChurchGroup["memberDetails"]; created_at: Date | string; source_system?: string | null; public_signup_enabled?: boolean; public_signup_token?: string | null }): ChurchGroup {
  const memberDetails = (row.member_details ?? []).map((member) => ({ contactId: member.contactId, role: member.role, status: member.status, ...(member.joinedOn ? { joinedOn: String(member.joinedOn).slice(0, 10) } : {}) }));
  return { id: row.id, name: row.name, description: row.description, ...(row.group_type?.trim() ? { groupType: row.group_type.trim() } : {}), status: row.status ?? "active", startsOn: row.starts_on ? String(row.starts_on).slice(0, 10) : null, endsOn: row.ends_on ? String(row.ends_on).slice(0, 10) : null, memberCount: Number(row.member_count), memberIds: row.member_ids ?? [], memberDetails, createdAt: new Date(row.created_at).toISOString(), publicSignupEnabled: row.public_signup_enabled ?? false, ...(row.public_signup_token ? { publicSignupToken: row.public_signup_token } : {}), ...(row.source_system === "churchtools" || row.source_system === "elvanto" ? { importedFrom: row.source_system } : {}) };
}

function mapBookableResource(row: BookableResourceRow): BookableResource & { calendarRequired: boolean } {
  return { id: row.id, name: row.name, category: row.category, description: row.description, location: row.location, ...(row.capacity ? { capacity: row.capacity } : {}), requiresApproval: row.requires_approval, calendarRequired: row.calendar_required, active: row.active, ...(row.source_system === "churchtools" ? { importedFrom: "churchtools" as const } : {}) };
}

function mapBooking(row: BookingRow): ResourceBooking {
  return { id: row.id, resourceId: row.resource_id, resourceName: row.resource_name, requestedBy: row.requested_by, requesterName: row.requester_name, purpose: row.purpose, startsAt: new Date(row.starts_at).toISOString(), endsAt: new Date(row.ends_at).toISOString(), status: row.status, createdAt: new Date(row.created_at).toISOString() };
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
        `SELECT g.id, g.name, g.description, g.group_type, g.status, g.starts_on, g.ends_on, g.created_at, g.source_system, g.public_signup_enabled, g.public_signup_token,
                EXISTS (SELECT 1 FROM department_memberships membership
                  JOIN group_members own_member ON own_member.contact_id=membership.contact_id AND own_member.group_id=g.id
                 WHERE membership.department_id=g.department_id AND membership.user_id=$2 AND own_member.status='active') AS is_my_group,
                count(gm.contact_id)::int AS member_count,
                COALESCE(array_agg(gm.contact_id) FILTER (WHERE gm.contact_id IS NOT NULL), ARRAY[]::uuid[]) AS member_ids,
                COALESCE(json_agg(json_build_object('contactId',gm.contact_id,'role',gm.role,'status',gm.status,'joinedOn',gm.joined_on) ORDER BY lower(c.last_name),lower(c.first_name)) FILTER (WHERE gm.contact_id IS NOT NULL), '[]'::json) AS member_details
           FROM church_groups g LEFT JOIN group_members gm ON gm.group_id = g.id LEFT JOIN contacts c ON c.id=gm.contact_id
          WHERE g.department_id = $1 GROUP BY g.id ORDER BY lower(g.name), g.created_at`,
        [departmentId, request.authenticatedUser!.id],
      );
      const canManageGroups = request.activeDepartmentRole === "site_admin" || (request.activeDepartmentPermissions ?? []).includes("groups_manage");
      reply.header('cache-control', 'private, no-store');
      return result.rows.map((row) => {
        const group = { ...mapGroup(row), isMyGroup: row.is_my_group === true };
        return canManageGroups ? group : (({ publicSignupToken: _token, ...safeGroup }) => safeGroup)(group);
      });
    });

    routes.get("/api/groups/views", async (request, reply) => {
      const departmentId = await department(request, reply);
      if (!departmentId) return reply;
      return (await pool!.query(
        `SELECT id,name,search_text AS "searchText",status_filter AS "statusFilter",group_type_filter AS "groupTypeFilter",source_filter AS "sourceFilter",my_groups_only AS "myGroupsOnly",sort_order AS "sortOrder",display_mode AS "displayMode",visible_columns AS "visibleColumns",created_at AS "createdAt",updated_at AS "updatedAt"
           FROM group_directory_views WHERE department_id=$1 AND user_id=$2 ORDER BY lower(name),created_at`,
        [departmentId, request.authenticatedUser!.id],
      )).rows;
    });

    routes.post<{ Body: { name: string; searchText?: string; statusFilter?: "all" | GroupLifecycleStatus; groupTypeFilter?: string; sourceFilter?: "all" | "local" | "churchtools" | "elvanto"; myGroupsOnly?: boolean; sortOrder?: "name_asc" | "name_desc" | "members_desc" | "start_desc"; displayMode?: "list" | "table"; visibleColumns?: string[] } }>("/api/groups/views", { schema: {
      body: { type: "object", additionalProperties: false, required: ["name"], properties: { name: { type: "string", minLength: 1, maxLength: 80 }, searchText: { type: "string", maxLength: 120 }, statusFilter: { type: "string", enum: ["all", "active", "draft", "ended", "archived"] }, groupTypeFilter: { type: "string", maxLength: 80 }, sourceFilter: { type: "string", enum: ["all", "local", "churchtools", "elvanto"] }, myGroupsOnly: { type: "boolean" }, sortOrder: { type: "string", enum: ["name_asc", "name_desc", "members_desc", "start_desc"] }, displayMode: { type: "string", enum: ["list", "table"] }, visibleColumns: { type: "array", maxItems: 5, uniqueItems: true, items: { type: "string", enum: ["type", "status", "members", "start", "end"] } } } },
    } }, async (request, reply) => {
      if (!validateMutation(request, reply)) return reply;
      const departmentId = await department(request, reply);
      if (!departmentId) return reply;
      const name = request.body.name.trim();
      if (!name) return reply.code(400).send({ error: "Enter a name for this saved view." });
      const searchText = (request.body.searchText ?? "").trim().slice(0, 120);
      const statusFilter = request.body.statusFilter ?? "all";
      const groupTypeFilter = (request.body.groupTypeFilter ?? "").trim();
      const result = await pool!.query(
        `INSERT INTO group_directory_views(id,department_id,user_id,name,search_text,status_filter,group_type_filter,sort_order,display_mode,visible_columns,source_filter,my_groups_only)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,COALESCE($9,'list'),COALESCE($10,ARRAY['type','status','members','start','end']::TEXT[]),COALESCE($11,'all'),COALESCE($12,false))
         ON CONFLICT(department_id,user_id,(lower(name))) DO UPDATE
           SET name=EXCLUDED.name,search_text=EXCLUDED.search_text,status_filter=EXCLUDED.status_filter,group_type_filter=EXCLUDED.group_type_filter,sort_order=EXCLUDED.sort_order,display_mode=COALESCE($9,group_directory_views.display_mode),visible_columns=COALESCE($10,group_directory_views.visible_columns),source_filter=COALESCE($11,group_directory_views.source_filter),my_groups_only=COALESCE($12,group_directory_views.my_groups_only),updated_at=now()
         RETURNING id,name,search_text AS "searchText",status_filter AS "statusFilter",group_type_filter AS "groupTypeFilter",source_filter AS "sourceFilter",my_groups_only AS "myGroupsOnly",sort_order AS "sortOrder",display_mode AS "displayMode",visible_columns AS "visibleColumns",created_at AS "createdAt",updated_at AS "updatedAt"`,
        [randomUUID(), departmentId, request.authenticatedUser!.id, name, searchText, statusFilter, groupTypeFilter, request.body.sortOrder ?? "name_asc", request.body.displayMode ?? null, request.body.visibleColumns ?? null, request.body.sourceFilter ?? null, request.body.myGroupsOnly ?? null],
      );
      return reply.code(200).send(result.rows[0]);
    });

    routes.patch<{ Params: { id: string }; Body: { name: string; searchText?: string; statusFilter?: "all" | GroupLifecycleStatus; groupTypeFilter?: string; sourceFilter?: "all" | "local" | "churchtools" | "elvanto"; myGroupsOnly?: boolean; sortOrder?: string; displayMode?: string; visibleColumns?: string[] } }>("/api/groups/views/:id", { schema: {
      params: { type: "object", additionalProperties: false, required: ["id"], properties: { id: { type: "string", format: "uuid" } } },
      body: { type: "object", additionalProperties: false, required: ["name"], properties: { name: { type: "string", minLength: 1, maxLength: 80 }, searchText: { type: "string", maxLength: 120 }, statusFilter: { type: "string", enum: ["all", "active", "draft", "ended", "archived"] }, groupTypeFilter: { type: "string", maxLength: 80 }, sourceFilter: { type: "string", enum: ["all", "local", "churchtools", "elvanto"] }, myGroupsOnly: { type: "boolean" }, sortOrder: { type: "string", enum: ["name_asc", "name_desc", "members_desc", "start_desc"] }, displayMode: { type: "string", enum: ["list", "table"] }, visibleColumns: { type: "array", maxItems: 5, uniqueItems: true, items: { type: "string", enum: ["type", "status", "members", "start", "end"] } } } },
    } }, async (request, reply) => {
      if (!validateMutation(request, reply)) return reply;
      const departmentId = await department(request, reply);
      if (!departmentId) return reply;
      const { searchText, statusFilter, groupTypeFilter, sortOrder, displayMode, visibleColumns, sourceFilter, myGroupsOnly } = request.body;
      const name = request.body.name.trim();
      if (!name) return reply.code(400).send({ error: "Enter a name for this saved view." });
      try {
        const updated = await pool!.query(
          `UPDATE group_directory_views
              SET name=$4,search_text=COALESCE($5,search_text),status_filter=COALESCE($6,status_filter),
                  group_type_filter=COALESCE($7,group_type_filter),sort_order=COALESCE($8,sort_order),
                  display_mode=COALESCE($9,display_mode),visible_columns=COALESCE($10,visible_columns),source_filter=COALESCE($11,source_filter),my_groups_only=COALESCE($12,my_groups_only),updated_at=now()
            WHERE id=$1 AND department_id=$2 AND user_id=$3
            RETURNING id,name,search_text AS "searchText",status_filter AS "statusFilter",group_type_filter AS "groupTypeFilter",source_filter AS "sourceFilter",my_groups_only AS "myGroupsOnly",
                      sort_order AS "sortOrder",display_mode AS "displayMode",visible_columns AS "visibleColumns",
                      created_at AS "createdAt",updated_at AS "updatedAt"`,
          [request.params.id, departmentId, request.authenticatedUser!.id, name, searchText?.trim() ?? null,
            statusFilter ?? null, groupTypeFilter?.trim() ?? null, sortOrder ?? null, displayMode ?? null, visibleColumns ?? null, sourceFilter ?? null, myGroupsOnly ?? null],
        );
        if (!updated.rowCount) return reply.code(404).send({ error: "Saved group view not found." });
        return updated.rows[0];
      } catch (error) {
        if ((error as { code?: string }).code === "23505") return reply.code(409).send({ error: "A saved view already uses this name." });
        throw error;
      }
    });
    routes.delete<{ Params: { id: string } }>("/api/groups/views/:id", { schema: { params: { type: "object", additionalProperties: false, required: ["id"], properties: { id: { type: "string", format: "uuid" } } } } }, async (request, reply) => {
      if (!validateMutation(request, reply)) return reply;
      const departmentId = await department(request, reply);
      if (!departmentId) return reply;
      const deleted = await pool!.query("DELETE FROM group_directory_views WHERE id=$1 AND department_id=$2 AND user_id=$3 RETURNING id", [request.params.id, departmentId, request.authenticatedUser!.id]);
      if (!deleted.rowCount) return reply.code(404).send({ error: "Saved group view not found." });
      return { deleted: true };
    });

    routes.post<{ Body: { name: string; description?: string; groupType?: string; status?: GroupLifecycleStatus; startsOn?: string | null; endsOn?: string | null } }>("/api/groups", { schema: {
      body: { type: "object", additionalProperties: false, required: ["name"], properties: { name: { type: "string", minLength: 1, maxLength: 120 }, description: { type: "string", maxLength: 1000 }, groupType: { type: "string", maxLength: 80 }, status: { type: "string", enum: ["active", "draft", "ended", "archived"] }, startsOn: { anyOf: [{ type: "string", format: "date" }, { type: "null" }] }, endsOn: { anyOf: [{ type: "string", format: "date" }, { type: "null" }] } } },
    } }, async (request, reply) => {
      const departmentId = await department(request, reply, "groups_manage");
      if (!departmentId) return reply;
      const name = request.body.name.trim();
      const description = request.body.description?.trim() ?? "";
      const groupType = request.body.groupType?.trim() ?? "";
      const status = request.body.status ?? "active";
      const startsOn = request.body.startsOn ?? null;
      const endsOn = request.body.endsOn ?? null;
      if (!name) return reply.code(400).send({ error: "Enter a group name." });
      if (startsOn && endsOn && startsOn > endsOn) return reply.code(400).send({ error: "The group end date must be on or after its start date." });
      try {
        const result = await pool!.query(
          `INSERT INTO church_groups (id, department_id, name, description,group_type,status,starts_on,ends_on) VALUES ($1, $2, $3, $4,$5,$6,$7,$8)
           RETURNING id, name, description,group_type,status,starts_on,ends_on,created_at`,
          [randomUUID(), departmentId, name, description, groupType, status, startsOn, endsOn],
        );
        return reply.code(201).send(mapGroup({ ...result.rows[0], member_count: 0, member_ids: [] }));
      } catch (error) {
        if (error && typeof error === "object" && "code" in error && error.code === "23505") return reply.code(409).send({ error: "A group with that name already exists." });
        throw error;
      }
    });

    routes.put<{ Params: { id: string }; Body: { name: string; description?: string; groupType?: string; status?: GroupLifecycleStatus; startsOn?: string | null; endsOn?: string | null } }>("/api/groups/:id", { schema: {
      params: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } },
      body: { type: "object", additionalProperties: false, required: ["name"], properties: { name: { type: "string", minLength: 1, maxLength: 120 }, description: { type: "string", maxLength: 1000 }, groupType: { type: "string", maxLength: 80 }, status: { type: "string", enum: ["active", "draft", "ended", "archived"] }, startsOn: { anyOf: [{ type: "string", format: "date" }, { type: "null" }] }, endsOn: { anyOf: [{ type: "string", format: "date" }, { type: "null" }] } } },
    } }, async (request, reply) => {
      const departmentId = await department(request, reply, "groups_manage");
      if (!departmentId) return reply;
      const existing = await pool!.query<{ source_system: string | null; group_type: string; status: GroupLifecycleStatus; starts_on: string | null; ends_on: string | null }>("SELECT source_system,group_type,status,starts_on::text,ends_on::text FROM church_groups WHERE id=$1 AND department_id=$2", [request.params.id, departmentId]);
      if (!existing.rowCount) return reply.code(404).send({ error: "Group not found." });
      if (existing.rows[0].source_system === "churchtools" || existing.rows[0].source_system === "elvanto") return reply.code(403).send({ error: "This group is managed by an external sync. Edit it in the source system and sync again." });
      const name = request.body.name.trim();
      if (!name) return reply.code(400).send({ error: "Enter a group name." });
      const status = request.body.status ?? existing.rows[0].status;
      const groupType = request.body.groupType === undefined ? existing.rows[0].group_type : request.body.groupType.trim();
      const startsOn = request.body.startsOn === undefined ? existing.rows[0].starts_on : request.body.startsOn;
      const endsOn = request.body.endsOn === undefined ? existing.rows[0].ends_on : request.body.endsOn;
      if (startsOn && endsOn && startsOn > endsOn) return reply.code(400).send({ error: "The group end date must be on or after its start date." });
      try {
        const result = await pool!.query(
          `UPDATE church_groups SET name=$3,description=$4,group_type=$5,status=$6,starts_on=$7,ends_on=$8,
               public_signup_enabled=CASE WHEN $6='active' THEN public_signup_enabled ELSE false END,
               public_signup_token=CASE WHEN $6='active' THEN public_signup_token ELSE NULL END,updated_at=now()
            WHERE id = $1 AND department_id = $2 RETURNING id,name,description,group_type,status,starts_on,ends_on,created_at,source_system,public_signup_enabled,public_signup_token,
              (SELECT count(*)::int FROM group_members WHERE group_id = church_groups.id) AS member_count,
              (SELECT COALESCE(array_agg(contact_id), ARRAY[]::uuid[]) FROM group_members WHERE group_id = church_groups.id) AS member_ids,
              (SELECT COALESCE(json_agg(json_build_object('contactId',gm.contact_id,'role',gm.role,'status',gm.status,'joinedOn',gm.joined_on)), '[]'::json) FROM group_members gm WHERE gm.group_id=church_groups.id) AS member_details`,
          [request.params.id, departmentId, name, request.body.description?.trim() ?? "", groupType, status, startsOn, endsOn],
        );
        if (!result.rowCount) return reply.code(404).send({ error: "Group not found." });
        return mapGroup(result.rows[0]);
      } catch (error) {
        if (error && typeof error === "object" && "code" in error && error.code === "23505") return reply.code(409).send({ error: "A group with that name already exists." });
        throw error;
      }
    });

    routes.get<{ Params: { id: string } }>("/api/groups/:id/type-history", { schema: {
      params: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } },
    } }, async (request, reply) => {
      const departmentId = await department(request, reply, "groups_manage");
      if (!departmentId) return reply;
      const group = await pool!.query("SELECT id FROM church_groups WHERE department_id=$1 AND id=$2", [departmentId, request.params.id]);
      if (!group.rowCount) return reply.code(404).send({ error: "Group not found." });
      const result = await pool!.query(
        `SELECT history.id, history.previous_type AS "previousType", history.new_type AS "newType",
                history.created_at AS "createdAt", actor.display_name AS "actorName"
           FROM group_directory_type_history history
           LEFT JOIN app_users actor ON actor.id=history.actor_user_id
          WHERE history.department_id=$1 AND history.group_id=$2
          ORDER BY history.created_at DESC, history.id DESC
          LIMIT 100`,
        [departmentId, request.params.id],
      );
      return reply.header("Cache-Control", "private, no-store").send(result.rows);
    });

    routes.patch<{ Body: { groupIds: string[]; groupType: string } }>("/api/groups/bulk-type", { schema: {
      body: { type: "object", additionalProperties: false, required: ["groupIds", "groupType"], properties: {
        groupIds: { type: "array", minItems: 1, maxItems: 100, uniqueItems: true, items: { type: "string", format: "uuid" } },
        groupType: { type: "string", maxLength: 80 },
      } },
    } }, async (request, reply) => {
      const departmentId = await department(request, reply, "groups_manage");
      if (!departmentId) return reply;
      if (!validateMutation(request, reply)) return reply;
      const groupType = request.body.groupType.trim();
      const client = await pool!.connect();
      let updated = 0;
      try {
        await client.query("BEGIN");
        if (!await dependencies.lockDepartmentForWrite(client, departmentId)) {
          await client.query("ROLLBACK");
          return reply.code(423).send({ error: "This location is read-only." });
        }
        const selected = await client.query<{ id: string; source_system: string | null; group_type: string | null }>(
          "SELECT id, source_system, group_type FROM church_groups WHERE department_id=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR UPDATE",
          [departmentId, request.body.groupIds],
        );
        if (selected.rows.length !== request.body.groupIds.length || selected.rows.some((group) => group.source_system)) {
          await client.query("ROLLBACK");
          return reply.code(409).send({ error: "Only existing local groups in this location can be updated together." });
        }
        for (const group of selected.rows) {
          if ((group.group_type ?? "") === groupType) continue;
          await client.query("UPDATE church_groups SET group_type=$3, updated_at=now() WHERE id=$1 AND department_id=$2", [group.id, departmentId, groupType]);
          await client.query(
            "INSERT INTO group_directory_type_history (id, department_id, group_id, actor_user_id, previous_type, new_type) VALUES ($1,$2,$3,$4,$5,$6)",
            [randomUUID(), departmentId, group.id, request.authenticatedUser!.id, group.group_type, groupType],
          );
          updated++;
        }
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
      if (updated) realtime.publish("core:groups:changed", departmentId, { action: "types-updated" });
      return { updated };
    });

    routes.put<{ Params: { id: string }; Body: { members: GroupMembershipDraft[]; expectedMembers?: GroupMembershipDraft[] } }>("/api/groups/:id/members", { schema: {
      params: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } },
      body: { type: "object", additionalProperties: false, required: ["members"], properties: {
        members: { type: "array", maxItems: 2000, items: groupMemberDraftSchema },
        expectedMembers: { type: "array", maxItems: 2000, items: groupMemberDraftSchema },
      } },
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
        if (request.body.expectedMembers) {
          const before = await client.query<GroupMembershipDraft>(
            `SELECT contact_id AS "contactId",role,status,joined_on::text AS "joinedOn" FROM group_members WHERE group_id=$1 FOR UPDATE`,
            [request.params.id],
          );
          if (groupMembershipState(before.rows) !== groupMembershipState(request.body.expectedMembers)) {
            await client.query("ROLLBACK");
            return reply.code(409).send({ error: "Group membership changed. Refresh the group before saving your changes." });
          }
        }
        const members = request.body.members.map((member) => ({ ...member, role: member.role.trim() }));
        if (members.some((member) => !member.role)) {
          await client.query("ROLLBACK");
          return reply.code(400).send({ error: "Enter a role for every group member." });
        }
        await client.query("SELECT set_config('smart_church.actor_id',$1,true)", [request.authenticatedUser?.id ?? ""]);
        await client.query("DELETE FROM group_members WHERE group_id=$1 AND NOT (contact_id=ANY($2::uuid[]))", [request.params.id, contactIds]);
        if (members.length) await client.query(
          `INSERT INTO group_members AS member(group_id,contact_id,role,status,joined_on,waitlisted_at)
           SELECT $1,src."contactId",src.role,src.status,src."joinedOn",CASE WHEN src.status='waitlist' THEN statement_timestamp() END
             FROM jsonb_to_recordset($2::jsonb) AS src("contactId" uuid,role text,status text,"joinedOn" date)
           ON CONFLICT (group_id,contact_id) DO UPDATE SET role=EXCLUDED.role,status=EXCLUDED.status,joined_on=EXCLUDED.joined_on
           WHERE (member.role,member.status,member.joined_on) IS DISTINCT FROM (EXCLUDED.role,EXCLUDED.status,EXCLUDED.joined_on)`,
          [request.params.id, JSON.stringify(members)],
        );
        await client.query("COMMIT");
        realtime.publish("core:groups:changed", departmentId, { groupId: request.params.id, action: "members-updated" });
        return { memberIds: contactIds, memberDetails: members };
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally { client.release(); }
    });

    const waitlistParams = { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } } as const;
    const waitlistOrder = { type: "array", maxItems: 2000, uniqueItems: true, items: { type: "string", format: "uuid" } } as const;
    routes.get<{ Params: { id: string } }>("/api/groups/:id/waitlist", { schema: { params: waitlistParams } }, async (request, reply) => {
      const departmentId = await department(request, reply, "groups_manage");
      if (!departmentId) return reply;
      const group = (await pool!.query<{ source_system: string | null }>(
        "SELECT source_system FROM church_groups WHERE id=$1 AND department_id=$2", [request.params.id, departmentId],
      )).rows[0];
      if (!group) return reply.code(404).send({ error: "Group not found." });
      if (group.source_system === "churchtools" || group.source_system === "elvanto") return reply.code(403).send({ error: "This group's waitlist is managed in the source system." });
      reply.header("cache-control", "private, no-store");
      return groupWaitlist(pool!, departmentId, request.params.id);
    });

    routes.get<{ Params: { id: string } }>("/api/groups/:id/waitlist/promotion-preview", { schema: { params: waitlistParams } }, async (request, reply) => {
      const departmentId = await department(request, reply, "groups_manage");
      if (!departmentId) return reply;
      const groupId = request.params.id;
      const group = (await pool!.query<{ source_system: string | null; status: string }>(
        "SELECT source_system,status FROM church_groups WHERE id=$1 AND department_id=$2", [groupId, departmentId],
      )).rows[0];
      if (!group) return reply.code(404).send({ error: "Group not found." });
      if (group.source_system === "churchtools" || group.source_system === "elvanto") return reply.code(403).send({ error: "This group's waitlist is managed in the source system." });
      if (group.status !== "active") return reply.code(409).send({ error: "Batch promotion is available for active groups." });
      reply.header("cache-control", "private, no-store");
      return previewGroupWaitlistPromotion(pool!, departmentId, groupId, await groupWaitlist(pool!, departmentId, groupId));
    });


    type QueueChange = { expectedOrder: string[] } & ({ order: string[] } | { promoteContactId: string } | { promoteNext: string[] });
    routes.put<{ Params: { id: string }; Body: QueueChange }>("/api/groups/:id/waitlist", { schema: {
      params: waitlistParams,
      body: {
        type: "object", additionalProperties: false, required: ["expectedOrder"],
        oneOf: [{ required: ["order"] }, { required: ["promoteContactId"] }, { required: ["promoteNext"] }],
        properties: { expectedOrder: waitlistOrder, order: waitlistOrder, promoteContactId: { type: "string", format: "uuid" },
          promoteNext: { ...waitlistOrder, minItems: 1, maxItems: promotionBatchSize },
        },
      },
    } }, async (request, reply) => {
      const departmentId = await department(request, reply, "groups_manage");
      if (!departmentId) return reply;
      if (!validateMutation(request, reply)) return reply;
      const groupId = request.params.id;
      const client = await pool!.connect();
      try {
        await client.query("BEGIN");
        const group = (await client.query<{ source_system: string | null; status: string }>(
          "SELECT source_system,status FROM church_groups WHERE id=$1 AND department_id=$2 FOR UPDATE", [groupId, departmentId],
        )).rows[0];
        if (!group) { await client.query("ROLLBACK"); return reply.code(404).send({ error: "Group not found." }); }
        if (group.source_system === "churchtools" || group.source_system === "elvanto") {
          await client.query("ROLLBACK");
          return reply.code(403).send({ error: "This group's waitlist is managed in the source system." });
        }
        const queue = await groupWaitlist(client, departmentId, groupId, true);
        const currentOrder = queue.map(({ contactId }) => contactId);
        if (JSON.stringify(currentOrder) !== JSON.stringify(request.body.expectedOrder)) {
          await client.query("ROLLBACK");
          return reply.code(409).send({ error: "The waitlist changed. Refresh it before continuing." });
        }
        const promoteContactId = "promoteContactId" in request.body ? request.body.promoteContactId : null;
        const order = "order" in request.body ? request.body.order : null;
        const batch = "promoteNext" in request.body ? request.body.promoteNext : null;
        if ((promoteContactId && !currentOrder.includes(promoteContactId)) ||
            (order && (currentOrder.length !== order.length || order.some((contactId) => !currentOrder.includes(contactId))))) {
          await client.query("ROLLBACK");
          return reply.code(400).send({ error: "Choose people from the current waitlist." });
        }
        await client.query("SELECT set_config('smart_church.actor_id',$1,true)", [request.authenticatedUser?.id ?? ""]);
        if (batch) {
          if (group.status !== "active") { await client.query("ROLLBACK"); return reply.code(409).send({ error: "Batch promotion is available for active groups." }); }
          const preview = await previewGroupWaitlistPromotion(client, departmentId, groupId, queue);
          if (JSON.stringify(preview.candidates.map(({ contactId }) => contactId)) !== JSON.stringify(batch)) {
            await client.query("ROLLBACK");
            return reply.code(409).send({ error: "Waitlist eligibility or available seats changed. Preview the promotion again." });
          }
        } else if (promoteContactId) {
          const role = queue.find(({ contactId }) => contactId === promoteContactId)!.role;
          const { policy } = await readSignupForm(client, departmentId, groupId);
          const capacityError = await checkGroupAdmissionCapacity(client, departmentId, groupId, "active", role, policy);
          if (capacityError) { await client.query("ROLLBACK"); return reply.code(409).send({ error: capacityError }); }
        }
        const promoted = batch ?? (promoteContactId ? [promoteContactId] : []);
        if (promoted.length) {
          const updated = await client.query(
            `UPDATE group_members member SET status='active', joined_on=COALESCE(member.joined_on,
                (current_timestamp AT TIME ZONE COALESCE(zone.name,'UTC'))::date)
                FROM departments site LEFT JOIN pg_timezone_names zone ON zone.name=site.time_zone
                JOIN contacts person ON person.department_id=site.id
               WHERE site.id=$1 AND member.group_id=$2 AND member.contact_id=ANY($3::uuid[]) AND person.id=member.contact_id
                 AND member.status='waitlist' AND (NOT $4 OR (lower(trim(member.role))='member' AND person.archived_at IS NULL))
               RETURNING member.contact_id`,
            [departmentId, groupId, promoted, Boolean(batch)],
          );
          if (updated.rowCount !== promoted.length) {
            await client.query("ROLLBACK");
            return reply.code(409).send({ error: "The waitlist changed. Refresh it before continuing." });
          }
        } else if (order && JSON.stringify(order) !== JSON.stringify(currentOrder)) {
          await client.query(
            `UPDATE group_members member SET waitlist_priority=ranking.position::int
               FROM unnest($2::uuid[]) WITH ORDINALITY ranking(contact_id, position)
              WHERE member.group_id=$1 AND member.contact_id=ranking.contact_id AND member.status='waitlist'
                AND member.waitlist_priority IS DISTINCT FROM ranking.position::int`,
            [groupId, order],
          );
        }
        const next = await groupWaitlist(client, departmentId, groupId);
        await client.query("COMMIT");
        realtime.publish("core:groups:changed", departmentId, { groupId, action: batch ? "waitlist-batch-promoted" : promoteContactId ? "waitlist-member-promoted" : "waitlist-reordered" });
        return next;
      } catch (error) { await client.query("ROLLBACK"); throw error; }
      finally { client.release(); }
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
      const existing = await pool!.query<{ source_system: string | null; status: GroupLifecycleStatus }>("SELECT source_system,status FROM church_groups WHERE id=$1 AND department_id=$2", [request.params.id, departmentId]);
      if (!existing.rowCount) return reply.code(404).send({ error: "Group not found." });
      if (existing.rows[0].source_system === "churchtools" || existing.rows[0].source_system === "elvanto") return reply.code(403).send({ error: "This group is managed by an external sync." });
      if (request.body.enabled && existing.rows[0].status !== "active") return reply.code(400).send({ error: "Public signup can only be enabled for active groups." });
      const result = await pool!.query<{ public_signup_enabled: boolean; public_signup_token: string | null }>(
        `UPDATE church_groups SET public_signup_enabled=$3,
           public_signup_token=CASE WHEN $3 THEN COALESCE(public_signup_token,$4::uuid) ELSE NULL END, updated_at=now()
         WHERE id=$1 AND department_id=$2 RETURNING public_signup_enabled,public_signup_token`,
        [request.params.id, departmentId, request.body.enabled, randomUUID()],
      );
      return { enabled: result.rows[0].public_signup_enabled, ...(result.rows[0].public_signup_token ? { token: result.rows[0].public_signup_token } : {}) };
    });

    const signupFormParams = { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } } as const;
    function getSignupGroup(db: typeof pool | PoolClient, departmentId: string, groupId: string, lock = false) {
      return db!.query<{ source_system: string | null; time_zone: string }>(
        `SELECT church_group.source_system,site.time_zone FROM church_groups church_group
           JOIN departments site ON site.id=church_group.department_id
          WHERE church_group.department_id=$1 AND church_group.id=$2` + (lock ? " FOR UPDATE OF church_group" : ""), [departmentId, groupId],
      );
    }

    routes.get<{ Params: { id: string } }>("/api/groups/:id/signup-form", { schema: { params: signupFormParams } }, async (request, reply) => {
      const departmentId = await department(request, reply, "groups_manage");
      if (!departmentId) return reply;
      const group = (await getSignupGroup(pool, departmentId, request.params.id)).rows[0];
      if (!group) return reply.code(404).send({ error: "Group not found." });
      if (group.source_system === "churchtools" || group.source_system === "elvanto") return reply.code(403).send({ error: "This signup form is managed in the source system." });
      reply.header("cache-control", "private, no-store");
      const form = await readSignupForm(pool!, departmentId, request.params.id);
      return { ...form, policy: editableSignupPolicy(form.policy, group.time_zone) };
    });

    routes.put<{ Params: { id: string }; Body: SignupSettings }>("/api/groups/:id/signup-form", {
      schema: { params: signupFormParams, body: signupSettingsSchema },
    }, async (request, reply) => {
      const departmentId = await department(request, reply, "groups_manage");
      if (!departmentId) return reply;
      if (!validateMutation(request, reply)) return reply;
      const questions = prepareSignupQuestions(request.body.questions);
      if (typeof questions === "string") return reply.code(400).send({ error: questions });
      const groupId = request.params.id;
      const client = await pool!.connect();
      try {
        await client.query("BEGIN");
        const group = (await getSignupGroup(client, departmentId, groupId, true)).rows[0];
        if (!group) { await client.query("ROLLBACK"); return reply.code(404).send({ error: "Group not found." }); }
        if (group.source_system === "churchtools" || group.source_system === "elvanto") {
          await client.query("ROLLBACK");
          return reply.code(403).send({ error: "This signup form is managed in the source system." });
        }
        const previous = await readSignupForm(client, departmentId, groupId);
        if (previous.revision !== request.body.expectedRevision) {
          await client.query("ROLLBACK");
          return reply.code(409).send({ error: "The signup form changed. Reload it before saving." });
        }
        const policyDraft = request.body.policy;
        const policy = policyDraft ? normalizeSignupPolicy({
          ...policyDraft,
          activeSeatLimit: policyDraft.activeSeatLimit === undefined ? previous.policy.activeSeatLimit : policyDraft.activeSeatLimit,
          waitlistLimit: policyDraft.waitlistLimit === undefined ? previous.policy.waitlistLimit : policyDraft.waitlistLimit,
          countedRoles: policyDraft.countedRoles ?? previous.policy.countedRoles,
          connectedAdmission: policyDraft.connectedAdmission ?? previous.policy.connectedAdmission,
        }, group.time_zone) : previous.policy;
        if (typeof policy === "string") { await client.query("ROLLBACK"); return reply.code(400).send({ error: policy }); }
        const hasPolicy = policy.opensAt || policy.closesAt || policy.heading || policy.defaultRole !== defaultSignupPolicy.defaultRole || policy.activeSeatLimit != null
          || policy.waitlistLimit != null || Boolean(policy.countedRoles?.length) || policy.connectedAdmission;
        const revision = questions.length || hasPolicy ? randomUUID() : null;
        if (revision) {
          await client.query(
            `INSERT INTO group_signup_forms (department_id,group_id,revision,questions,opens_at,closes_at,default_role,heading,active_seat_limit,waitlist_limit,counted_roles,connected_admission)
             VALUES($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9,$10,$11,$12)
             ON CONFLICT(group_id) DO UPDATE SET revision=EXCLUDED.revision,questions=EXCLUDED.questions,opens_at=EXCLUDED.opens_at,
               closes_at=EXCLUDED.closes_at,default_role=EXCLUDED.default_role,heading=EXCLUDED.heading,
               active_seat_limit=EXCLUDED.active_seat_limit,waitlist_limit=EXCLUDED.waitlist_limit,counted_roles=EXCLUDED.counted_roles,connected_admission=EXCLUDED.connected_admission
             WHERE group_signup_forms.department_id=EXCLUDED.department_id`,
            [departmentId, groupId, revision, JSON.stringify(questions), policy.opensAt, policy.closesAt, policy.defaultRole, policy.heading, policy.activeSeatLimit, policy.waitlistLimit, policy.countedRoles, policy.connectedAdmission],
          );
        } else await client.query("DELETE FROM group_signup_forms WHERE department_id=$1 AND group_id=$2", [departmentId, groupId]);
        await client.query("COMMIT");
        realtime.publish("core:groups:changed", departmentId, { groupId, action: "group-signup-form-updated" });
        return { revision, questions, policy: editableSignupPolicy(policy, group.time_zone) };
      } catch (error) { await client.query("ROLLBACK"); throw error; }
      finally { client.release(); }
    });


    routes.get<{ Params: { id: string } }>("/api/groups/:id/join-requests", { schema: {
      params: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } },
    } }, async (request, reply) => {
      const departmentId = await department(request, reply, "groups_manage");
      if (!departmentId) return reply;
      const result = await pool!.query(
        `SELECT id,group_id AS "groupId",first_name AS "firstName",last_name AS "lastName",email,status,answer_snapshot AS "answers",created_at AS "createdAt",
                  COALESCE((SELECT default_role FROM group_signup_forms WHERE group_id=$1 AND department_id=$2),'Member') AS "defaultRole"
           FROM group_join_requests WHERE group_id=$1 AND department_id=$2 AND status='pending'
          ORDER BY created_at,id`,
        [request.params.id, departmentId],
      );
      reply.header("cache-control", "private, no-store");
      return result.rows;
    });

    routes.put<{ Params: { id: string; requestId: string }; Body: { decision: "approved" | "declined" | "waitlisted"; contactId?: string } }>("/api/groups/:id/join-requests/:requestId", { schema: {
      params: { type: "object", required: ["id", "requestId"], properties: { id: { type: "string", format: "uuid" }, requestId: { type: "string", format: "uuid" } } },
      body: { type: "object", additionalProperties: false, required: ["decision"], properties: { decision: { type: "string", enum: ["approved", "declined", "waitlisted"] }, contactId: { type: "string", format: "uuid" } } },
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
        const { decision } = request.body;
        if (decision !== "declined") {
          const destination = decision === "waitlisted" ? "waitlist" : "active";
          const form = await readSignupForm(client, departmentId, request.params.id);
          const findMembership = async (personId: string) => (await client.query<{ status: string }>(
            "SELECT status FROM group_members WHERE group_id=$1 AND contact_id=$2 FOR UPDATE", [request.params.id, personId],
          )).rows[0];
          if (request.body.contactId) {
            const selected = await client.query<{ id: string }>("SELECT id FROM contacts WHERE id=$1 AND department_id=$2 AND lower(email)=lower($3)", [request.body.contactId, departmentId, joinRequest.rows[0].email]);
            if (!selected.rowCount) { await client.query("ROLLBACK"); return reply.code(400).send({ error: "Choose a directory person with the same email address, or leave this blank to create a visitor record." }); }
            contactId = selected.rows[0].id;
          } else {
            const matching = await client.query<{ id: string }>("SELECT id FROM contacts WHERE department_id=$1 AND lower(email)=lower($2) ORDER BY id LIMIT 2", [departmentId, joinRequest.rows[0].email]);
            if (matching.rows.length > 1) { await client.query("ROLLBACK"); return reply.code(409).send({ error: "More than one person uses this email. Select the matching person explicitly before reviewing this application." }); }
            contactId = matching.rows[0]?.id ?? null;
          }
          const membership = contactId ? await findMembership(contactId) : undefined;
          if (membership && membership.status !== destination) {
            await client.query("ROLLBACK");
            return reply.code(409).send({ error: "This person already has a different membership status. Review their membership before resolving the application." });
          }
          if (!membership) {
            const capacityError = await checkGroupAdmissionCapacity(client, departmentId, request.params.id, destination, form.policy.defaultRole, form.policy);
            if (capacityError) { await client.query("ROLLBACK"); return reply.code(409).send({ error: capacityError }); }
            await client.query("SELECT set_config('smart_church.actor_id',$1,true)", [request.authenticatedUser!.id]);
            if (!contactId) {
              const created = await client.query<{ id: string }>(
                `INSERT INTO contacts (id,department_id,first_name,last_name,email,status) VALUES ($1,$2,$3,$4,$5,'visitor') RETURNING id`,
                [randomUUID(), departmentId, joinRequest.rows[0].first_name, joinRequest.rows[0].last_name, joinRequest.rows[0].email],
              );
              contactId = created.rows[0].id;
              if (await findMembership(contactId)) {
                await client.query("ROLLBACK");
                return reply.code(409).send({ error: "An automatic membership rule conflicts with this application. Review the group's membership rules before retrying." });
              }
            }
            const inserted = await client.query(
              `INSERT INTO group_members (group_id,contact_id,role,status,joined_on,waitlisted_at)
               VALUES($1,$2,$4,$3,CASE WHEN $3='active' THEN CURRENT_DATE END,CASE WHEN $3='waitlist' THEN statement_timestamp() END)
               ON CONFLICT (group_id,contact_id) DO NOTHING RETURNING contact_id`,
              [request.params.id, contactId, destination, form.policy.defaultRole],
            );
            if (!inserted.rowCount && (await findMembership(contactId))?.status !== destination) {
              await client.query("ROLLBACK");
              return reply.code(409).send({ error: "This person's group membership changed. Review it before retrying." });
            }
          }
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
      const result = await pool!.query<{ name: string; description: string; revision: string | null; questions: unknown[]; heading: string; opensAt: Date | null; closesAt: Date | null; timeZone: string; connectedAdmission: boolean }>(
        `SELECT church_group.name,church_group.description,
                CASE WHEN jsonb_array_length(form.questions)>0 THEN form.revision ELSE NULL END AS revision,
                COALESCE(form.questions,'[]'::jsonb) AS questions, COALESCE(form.heading,'') AS heading,
                form.opens_at AS "opensAt",form.closes_at AS "closesAt",site.time_zone AS "timeZone",COALESCE(form.connected_admission,false) AS "connectedAdmission"
           FROM church_groups church_group JOIN departments site ON site.id=church_group.department_id
           LEFT JOIN group_signup_forms form ON form.group_id=church_group.id AND form.department_id=church_group.department_id
          WHERE church_group.public_signup_token=$1 AND church_group.public_signup_enabled=true
            AND church_group.status='active' AND church_group.source_system IS NULL`,
        [request.params.token],
      );
      if (!result.rowCount) return reply.code(404).send({ error: "This group registration link is unavailable." });
      const form = result.rows[0];
      reply.header("cache-control", "private, no-store");
      return { ...form, timeZone: editableSignupPolicy(defaultSignupPolicy, form.timeZone).timeZone, signupState: signupState(form.opensAt, form.closesAt) };
    });

    routes.post<{ Params: { token: string }; Body: { firstName: string; lastName: string; email: string; formRevision?: string; answers?: Record<string, string> } }>("/api/public/group-signups/:token", { schema: {
      params: { type: "object", required: ["token"], properties: { token: { type: "string", format: "uuid" } } },
      body: { type: "object", additionalProperties: false, required: ["firstName", "lastName", "email"], properties: { firstName: { type: "string", minLength: 1, maxLength: 80 }, lastName: { type: "string", minLength: 1, maxLength: 80 }, email: { type: "string", minLength: 3, maxLength: 254, format: "email" }, ...signupAnswerFields } },
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
        const group = await client.query<{ id: string; department_id: string }>("SELECT id,department_id FROM church_groups WHERE public_signup_token=$1 AND public_signup_enabled=true AND status='active' AND source_system IS NULL FOR SHARE", [request.params.token]);
        if (!group.rowCount) { await client.query("ROLLBACK"); return reply.code(404).send({ error: "Registration is closed for this group." }); }
        groupId = group.rows[0].id;
        groupDepartmentId = group.rows[0].department_id;
        if (!await dependencies.lockDepartmentForWrite(client, groupDepartmentId)) { await client.query("ROLLBACK"); return reply.code(423).send({ error: "This group's location is read-only while it is a redundancy standby or fenced site." }); }
        const form = await readSignupForm(client, groupDepartmentId, groupId);
        const state = signupState(form.policy.opensAt, form.policy.closesAt);
        if (state !== "open") {
          await client.query("ROLLBACK");
          return reply.code(409).send({ code: "group_signup_window_closed", error: "This group is not accepting applications right now." });
        }
        const captured = captureSignupAnswers(form, request.body.formRevision, request.body.answers);
        if ("error" in captured) {
          await client.query("ROLLBACK");
          return reply.code(captured.status).send({ error: captured.error });
        }
        const existing = await client.query("SELECT 1 FROM group_join_requests WHERE group_id=$1 AND lower(email)=lower($2) AND status='pending'", [groupId, email]);
        if (existing.rowCount) { await client.query("ROLLBACK"); return reply.code(409).send({ error: "A request from this email is already waiting for review." }); }
        const member = await client.query(
          `SELECT 1 FROM group_members membership JOIN contacts person ON person.id=membership.contact_id
            WHERE membership.group_id=$1 AND person.department_id=$3 AND lower(person.email)=lower($2) AND membership.status IN ('active','waitlist')`,
          [groupId, email, groupDepartmentId],
        );
        if (member.rowCount) { await client.query("ROLLBACK"); return reply.code(409).send({ error: "A registration for this email is already on file." }); }
        await client.query(
          "INSERT INTO group_join_requests (id,department_id,group_id,first_name,last_name,email,answer_snapshot) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)",
          [randomUUID(), groupDepartmentId, groupId, firstName, lastName, email, JSON.stringify(captured.saved)],
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

    routes.post<{ Params: { token: string }; Body: { formRevision?: string; answers?: Record<string, string> } }>("/api/public/group-signups/:token/connected", { schema: {
      params: { type: "object", required: ["token"], properties: { token: { type: "string", format: "uuid" } } },
      body: { type: "object", additionalProperties: false, properties: signupAnswerFields },
    } }, async (request, reply) => {
      if (!isDatabaseReady() || !pool || !dependencies.authenticate) return reply.code(503).send({ error: "Group registration is temporarily unavailable." });
      if (request.headers.authorization) return reply.code(403).send({ error: "Use a personal browser session to join this group." });
      if (!await dependencies.authenticate(request, reply) || !validateMutation(request, reply)) return reply;
      const actor = request.authenticatedUser;
      if (!actor || actor.isServiceUser || !actor.email) return reply.code(403).send({ error: "Use your personal, linked account to join this group." });
      reply.header("cache-control", "private, no-store");
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const group = (await client.query<{ id: string; department_id: string }>(
          `SELECT id,department_id FROM church_groups WHERE public_signup_token=$1 AND public_signup_enabled=true
            AND status='active' AND source_system IS NULL FOR UPDATE`, [request.params.token],
        )).rows[0];
        if (!group) { await client.query("ROLLBACK"); return reply.code(404).send({ error: "Registration is closed for this group." }); }
        if (!await dependencies.lockDepartmentForWrite(client, group.department_id)) {
          await client.query("ROLLBACK");
          return reply.code(423).send({ error: "This group's location is read-only while it is a redundancy standby or fenced site." });
        }
        const form = await readSignupForm(client, group.department_id, group.id);
        if (!form.policy.connectedAdmission || form.policy.defaultRole.trim().toLowerCase() !== "member") {
          await client.query("ROLLBACK");
          return reply.code(409).send({ error: "This group uses reviewed applications. Submit a regular request to join." });
        }
        if (signupState(form.policy.opensAt, form.policy.closesAt) !== "open") {
          await client.query("ROLLBACK");
          return reply.code(409).send({ code: "group_signup_window_closed", error: "This group is not accepting applications right now." });
        }
        const captured = captureSignupAnswers(form, request.body.formRevision, request.body.answers);
        if ("error" in captured) {
          await client.query("ROLLBACK");
          return reply.code(captured.status).send({ error: captured.error });
        }
        const person = (await client.query<{ id: string; first_name: string; last_name: string; email: string }>(
          `SELECT person.id,person.first_name,person.last_name,lower(trim(person.email)) AS email
             FROM department_memberships membership
             JOIN contacts person ON person.id=membership.contact_id AND person.department_id=membership.department_id
            WHERE membership.department_id=$1 AND membership.user_id=$2 AND person.archived_at IS NULL
              AND lower(trim(person.email))=lower(trim($3::text))
            FOR SHARE OF membership,person`,
          [group.department_id, actor.id, actor.email],
        )).rows[0];
        if (!person) {
          await client.query("ROLLBACK");
          return reply.code(403).send({ error: "Your account is not linked to an eligible person in this location. Submit a regular request instead." });
        }
        const member = (await client.query<{ status: string }>(
          "SELECT status FROM group_members WHERE group_id=$1 AND contact_id=$2 FOR UPDATE", [group.id, person.id],
        )).rows[0];
        if (member?.status === "active") {
          await client.query("COMMIT");
          return { status: "approved" };
        }
        if (member) {
          await client.query("ROLLBACK");
          return reply.code(409).send({ error: "You already have a membership or waitlist place. Ask a group manager before changing it." });
        }
        const waiting = await client.query(
          `SELECT 1 FROM group_members member JOIN contacts person ON person.id=member.contact_id AND person.department_id=$2
            WHERE member.group_id=$1 AND member.status='waitlist' LIMIT 1`, [group.id, group.department_id],
        );
        const capacityError = await checkGroupAdmissionCapacity(client, group.department_id, group.id, "active", "Member", form.policy);
        if (waiting.rowCount || capacityError) {
          await client.query("ROLLBACK");
          return reply.code(409).send({ error: "Immediate admission is unavailable. Submit a regular request for review." });
        }
        const pending = await client.query(
          "SELECT 1 FROM group_join_requests WHERE group_id=$1 AND department_id=$2 AND lower(email)=$3 AND status='pending'",
          [group.id, group.department_id, person.email],
        );
        if (pending.rowCount) {
          await client.query("ROLLBACK");
          return reply.code(409).send({ error: "An application from this email is already awaiting review." });
        }
        await client.query("SELECT set_config('smart_church.actor_id',$1,true)", [actor.id]);
        const inserted = await client.query(
          `INSERT INTO group_members(group_id,contact_id,role,status,joined_on)
           VALUES($1,$2,'Member','active',CURRENT_DATE) ON CONFLICT(group_id,contact_id) DO NOTHING RETURNING contact_id`,
          [group.id, person.id],
        );
        if (!inserted.rowCount) {
          await client.query("ROLLBACK");
          return reply.code(409).send({ error: "Your membership changed. Reload the signup form." });
        }
        await client.query(
          `INSERT INTO group_join_requests(id,department_id,group_id,first_name,last_name,email,status,contact_id,answer_snapshot,reviewed_at)
           VALUES($1,$2,$3,$4,$5,$6,'approved',$7,$8::jsonb,now())`,
          [randomUUID(), group.department_id, group.id, person.first_name, person.last_name, person.email, person.id, JSON.stringify(captured.saved)],
        );
        await client.query("COMMIT");
        realtime.publish("core:groups:changed", group.department_id, { groupId: group.id, action: "connected-member-admitted" });
        return reply.code(201).send({ status: "approved" });
      } catch (error) { await client.query("ROLLBACK"); throw error; }
      finally { client.release(); }
    });


    routes.get<{ Params: { id: string } }>("/api/groups/:id/meetings", { schema: { params: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } } } }, async (request, reply) => {
      const departmentId = await department(request, reply);
      if (!departmentId) return reply;
      const result = await pool!.query(
        `SELECT m.id, m.meeting_date::text AS meeting_date, m.title, m.created_at, m.attendance_completed_at,
                count(a.contact_id)::int AS attendee_count,
                count(a.contact_id) FILTER (WHERE a.status='present')::int AS present_count
           FROM group_meetings m LEFT JOIN group_meeting_attendance a ON a.meeting_id=m.id
           JOIN church_groups g ON g.id=m.group_id
          WHERE m.group_id=$1 AND m.department_id=$2 AND g.department_id=$2
          GROUP BY m.id ORDER BY m.meeting_date DESC, m.created_at DESC`,
        [request.params.id, departmentId],
      );
      return result.rows.map((row) => ({ id: row.id, date: String(row.meeting_date).slice(0, 10), title: row.title, attendeeCount: Number(row.attendee_count), presentCount: Number(row.present_count), completedAt: row.attendance_completed_at }));
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
           VALUES ($1,$2,$3,$4,$5) ON CONFLICT (group_id,meeting_date,title) WHERE calendar_appointment_id IS NULL DO NOTHING
           RETURNING id,meeting_date::text AS meeting_date,title`,
          [randomUUID(), departmentId, request.params.id, request.body.date, request.body.title?.trim() ?? ""],
        );
        let meeting = inserted.rows[0];
        if (!meeting) {
          meeting = (await client.query("SELECT id,meeting_date::text AS meeting_date,title FROM group_meetings WHERE group_id=$1 AND meeting_date=$2 AND title=$3 AND calendar_appointment_id IS NULL", [request.params.id, request.body.date, request.body.title?.trim() ?? ""])).rows[0];
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

    routes.get<{ Params: { id: string }; Querystring: AttendanceReportQuery }>("/api/groups/:id/attendance-report", {
      schema: {
        params: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } },
        querystring: attendanceReportQuery,
      },
    }, async (request, reply) => {
      const departmentId = await department(request, reply, "groups_manage");
      if (!departmentId) return reply;
      return sendGroupAttendanceReport(pool!, reply, departmentId, request.params.id, request.query);
    });

    const meetingParams = { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } } as const;
    routes.get<{ Params: { id: string }; Querystring: { withCompletion?: boolean } }>("/api/group-meetings/:id/attendance", { schema: {
      params: meetingParams,
      querystring: { type: "object", properties: { withCompletion: { type: "boolean" } } },
    } }, async (request, reply) => {
      const departmentId = await department(request, reply);
      if (!departmentId) return reply;
      const result = await pool!.query(
        `SELECT m.attendance_completed_at, a.contact_id, c.first_name, c.last_name, a.status
           FROM group_meetings m
           JOIN church_groups g ON g.id=m.group_id AND g.department_id=m.department_id
           LEFT JOIN (group_meeting_attendance a JOIN contacts c ON c.id=a.contact_id AND c.department_id=$2)
             ON a.meeting_id=m.id
          WHERE m.id=$1 AND m.department_id=$2 ORDER BY lower(c.last_name),lower(c.first_name)`,
        [request.params.id, departmentId],
      );
      const attendance = result.rows.filter((row) => row.contact_id).map((row) => ({
        contactId: row.contact_id, firstName: row.first_name, lastName: row.last_name, status: row.status,
      }));
      if (!request.query.withCompletion) return attendance;
      if (!result.rows.length) return reply.code(404).send({ error: "Group meeting not found." });
      return { attendance, completedAt: result.rows[0].attendance_completed_at };
    });

    function lockGroupMeeting(client: PoolClient, meetingId: string, departmentId: string) {
      return client.query<{ source_system: string | null; group_id: string; attendance_completed_at: Date | string | null }>(
        `SELECT g.source_system, m.group_id, m.attendance_completed_at FROM group_meetings m JOIN church_groups g ON g.id=m.group_id
          WHERE m.id=$1 AND m.department_id=$2 AND g.department_id=$2 FOR UPDATE OF m`,
        [meetingId, departmentId],
      );
    }

    routes.get<{ Params: { id: string } }>("/api/group-meetings/:id/attendance/completion-feedback", { schema: { params: meetingParams } }, async (request, reply) => {
      const departmentId = await department(request, reply, "groups_manage");
      if (!departmentId) return reply;
      const meeting = (await pool!.query<{ source_system: string | null; group_id: string }>(
        `SELECT g.source_system,m.group_id FROM group_meetings m JOIN church_groups g ON g.id=m.group_id AND g.department_id=m.department_id
          WHERE m.id=$1 AND m.department_id=$2`,
        [request.params.id, departmentId],
      )).rows[0];
      if (!meeting) return reply.code(404).send({ error: "Group meeting not found." });
      if (meeting.source_system === "churchtools" || meeting.source_system === "elvanto") return reply.code(403).send({ error: "Imported group attendance is managed in the source system." });
      reply.header("cache-control", "private, no-store");
      if (!isServerModuleEnabled("group-operations") || !await groupFeedbackEnabled(pool!, departmentId)) return { feedback: null };
      return { feedback: await readGroupLeaderFeedback(pool!, { meetingId: request.params.id, groupId: meeting.group_id, departmentId }) };
    });

    routes.put<{ Params: { id: string }; Body: { completed: boolean; expectedCompletedAt: string | null; feedback?: CompletionFeedback } }>("/api/group-meetings/:id/attendance/completion", { schema: {
      params: meetingParams,
      body: { type: "object", additionalProperties: false, required: ["completed", "expectedCompletedAt"], properties: {
        completed: { type: "boolean" }, expectedCompletedAt: { type: ["string", "null"], format: "date-time" }, feedback: completionFeedbackSchema,
      } },
    } }, async (request, reply) => {
      const departmentId = await department(request, reply, "groups_manage");
      if (!departmentId) return reply;
      if (!validateMutation(request, reply)) return reply;
      const { feedback } = request.body;
      if (feedback && !request.body.completed) return reply.code(400).send({ error: "Submit leader feedback when completing a meeting." });
      const client = await pool!.connect();
      try {
        await client.query("BEGIN");
        const meeting = (await lockGroupMeeting(client, request.params.id, departmentId)).rows[0];
        if (!meeting) { await client.query("ROLLBACK"); return reply.code(404).send({ error: "Group meeting not found." }); }
        if (meeting.source_system === "churchtools" || meeting.source_system === "elvanto") {
          await client.query("ROLLBACK");
          return reply.code(403).send({ error: "Imported group attendance is managed in the source system." });
        }
        const completedAt = meeting.attendance_completed_at ? new Date(meeting.attendance_completed_at).toISOString() : null;
        const expected = request.body.expectedCompletedAt ? new Date(request.body.expectedCompletedAt).toISOString() : null;
        if (Boolean(completedAt) === request.body.completed) {
          if (feedback) {
            await client.query("ROLLBACK");
            return reply.code(409).send({ error: "This meeting was already completed. Reload attendance before continuing." });
          }
          await client.query("COMMIT");
          return { completedAt };
        }
        if (completedAt !== expected) {
          await client.query("ROLLBACK");
          return reply.code(409).send({ error: "Group meeting completion changed. Reload attendance and try again." });
        }
        if (feedback) {
          if (!isServerModuleEnabled("group-operations") || !await groupFeedbackEnabled(client, departmentId)) {
            await client.query("ROLLBACK");
            return reply.code(409).send({ error: "Leader feedback is unavailable for this location." });
          }
          const failure = await saveGroupLeaderFeedback(client, { meetingId: request.params.id, groupId: meeting.group_id, departmentId }, feedback,
            request.authenticatedUser?.id ?? null, feedback);
          if (failure) {
            await client.query("ROLLBACK");
            return reply.code(failure.status).send({ error: failure.error });
          }
        }
        const updated = await client.query(
          `UPDATE group_meetings SET attendance_completed_at=CASE WHEN $2 THEN date_trunc('milliseconds', clock_timestamp()) ELSE NULL END
            WHERE id=$1 RETURNING attendance_completed_at`,
          [request.params.id, request.body.completed],
        );
        await client.query("COMMIT");
        realtime.publish("core:groups:changed", departmentId, {
          groupId: meeting.group_id, meetingId: request.params.id, action: request.body.completed ? "meeting-completed" : "meeting-reopened",
        });
        if (feedback) realtime.publish("module:group-operations:changed", departmentId, {
          groupId: meeting.group_id, recordId: request.params.id, action: "meeting_feedback_saved",
        });
        return { completedAt: updated.rows[0].attendance_completed_at };
      } catch (error) { await client.query("ROLLBACK"); throw error; }
      finally { client.release(); }
    });


    const groupAttendanceStatuses = ["present", "absent", "excused"] as const;
    type GroupAttendanceStatus = typeof groupAttendanceStatuses[number];
    routes.put<{ Params: { id: string }; Body: { attendance: { contactId: string; status: GroupAttendanceStatus; expectedStatus?: GroupAttendanceStatus }[] } }>("/api/group-meetings/:id/attendance", { schema: {
      params: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } },
      body: { type: "object", additionalProperties: false, required: ["attendance"], properties: { attendance: { type: "array", maxItems: 2000, items: { type: "object", additionalProperties: false, required: ["contactId", "status"], properties: { contactId: { type: "string", format: "uuid" }, status: { type: "string", enum: groupAttendanceStatuses }, expectedStatus: { type: "string", enum: groupAttendanceStatuses } } } } } },
    } }, async (request, reply) => {
      const departmentId = await department(request, reply, "groups_manage");
      if (!departmentId) return reply;
      const client = await pool!.connect();
      try {
        await client.query("BEGIN");
        const meeting = (await lockGroupMeeting(client, request.params.id, departmentId)).rows[0];
        if (!meeting) { await client.query("ROLLBACK"); return reply.code(404).send({ error: "Group meeting not found." }); }
        if (meeting.source_system === "churchtools" || meeting.source_system === "elvanto") {
          await client.query("ROLLBACK");
          return reply.code(403).send({ error: "Imported group attendance is managed in the source system." });
        }
        if (meeting.attendance_completed_at) {
          await client.query("ROLLBACK");
          return reply.code(409).send({ error: "This group meeting is completed. Reload attendance and reopen it to make changes." });
        }
        const contactIds = request.body.attendance.map((item) => item.contactId);
        if (new Set(contactIds).size !== contactIds.length) { await client.query("ROLLBACK"); return reply.code(400).send({ error: "Each person can only appear once." }); }
        for (const item of request.body.attendance) {
          const saved = await client.query(
            `UPDATE group_meeting_attendance a SET status=$3,updated_at=now()
               FROM contacts c
              WHERE a.meeting_id=$1 AND a.contact_id=$2 AND c.id=a.contact_id AND c.department_id=$5
                AND ($4::text IS NULL OR a.status=$4)
              RETURNING a.contact_id`,
            [request.params.id, item.contactId, item.status, item.expectedStatus ?? null, departmentId],
          );
          if (!saved.rowCount) {
            await client.query("ROLLBACK");
            if (item.expectedStatus) return reply.code(409).send({ error: "Attendance changed while you were editing. Reload attendance and try again." });
            return reply.code(400).send({ error: "Attendance includes someone who was not on this meeting's group roster." });
          }
        }
        await client.query("COMMIT");
        if (contactIds.length) realtime.publish("core:groups:changed", departmentId, { groupId: meeting.group_id, meetingId: request.params.id, action: "meeting-attendance-updated" });
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
        `SELECT id, name, category, description, location, capacity, requires_approval, calendar_required, active, source_system
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
           RETURNING id, name, category, description, location, capacity, requires_approval, calendar_required, active`,
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
            WHERE id=$1 AND department_id=$2 RETURNING id, name, category, description, location, capacity, requires_approval, calendar_required, active, source_system`,
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
        `SELECT b.id, b.resource_id, r.name AS resource_name, b.requested_by, u.display_name AS requester_name,
                b.purpose, b.starts_at, b.ends_at, b.status, b.created_at
           FROM resource_bookings b JOIN bookable_resources r ON r.id=b.resource_id JOIN app_users u ON u.id=b.requested_by
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
        const resource = await lockResourceBookingPolicy(client, departmentId, request.body.resourceId);
        if (!resource?.active) { await client.query("ROLLBACK"); return reply.code(404).send({ error: "This resource is not available for booking." }); }
        if (resource.calendar_required) { await client.query("ROLLBACK"); return reply.code(409).send({ error: resourceCalendarRequired }); }
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
        const existing = await client.query("SELECT resource_id, requested_by, status FROM resource_bookings WHERE id=$1 AND department_id=$2 FOR UPDATE", [request.params.id, departmentId]);
        const booking = existing.rows[0];
        if (!booking) { await client.query("ROLLBACK"); return reply.code(404).send({ error: "Booking not found." }); }
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
