import { createHash, randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { PoolClient } from "pg";
import type { ModuleServerContext } from "../module-sdk.js";

type TreeRow = { id: string; name: string; description: string; parentId: string | null; memberCount: number; activeCount: number; subgroupCount: number; imported: boolean };

function cleanObject(value: unknown): Record<string, string | number | boolean | null> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > 40) return null;
  const output: Record<string, string | number | boolean | null> = {};
  for (const [rawKey, rawValue] of entries) {
    const key = rawKey.trim().slice(0, 60);
    if (!key || key.length > 60 || rawKey.length > 60) return null;
    if (typeof rawValue === "string") output[key] = rawValue.trim().slice(0, 500);
    else if (typeof rawValue === "boolean" || rawValue === null) output[key] = rawValue;
    else if (typeof rawValue === "number" && Number.isFinite(rawValue)) output[key] = rawValue;
    else return null;
  }
  return output;
}

export function registerModuleRoutes(app: FastifyInstance, context: ModuleServerContext) {
  const { pool, isDatabaseReady, resolveDepartmentId, validateMutation, realtime } = context;
  const unavailable = (reply: FastifyReply) => reply.code(503).send({ error: "Group administration is unavailable." });
  const managerGrant = (request: FastifyRequest) => request.activeDepartmentRole === "site_admin"
    || (request.activeDepartmentPermissions ?? []).includes("groups_manage")
    || (request.activeDepartmentModulePermissions?.["group-hierarchy"] ?? []).includes("manage");

  async function canManageGroup(request: FastifyRequest, groupId: string, departmentId: string) {
    if (managerGrant(request)) return true;
    const result = await pool!.query(
      `SELECT 1 FROM department_memberships account
       JOIN group_members member ON member.contact_id=account.contact_id AND member.group_id=$1
       WHERE account.user_id=$2 AND account.department_id=$3 AND member.status='active'
         AND lower(regexp_replace(member.role,'[^a-z]','','g')) IN ('leader','coleader','groupowner','groupmanager') LIMIT 1`,
      [groupId, request.authenticatedUser!.id, departmentId],
    );
    return Boolean(result.rowCount);
  }

  app.get("/api/modules/group-hierarchy/leaders", async (request, reply) => {
    if (!pool || !isDatabaseReady()) return unavailable(reply);
    const departmentId = await resolveDepartmentId(request, reply);
    if (!departmentId) return reply;
    if (!managerGrant(request)) return reply.code(403).send({ error: "Group management access is required." });
    const canSeePrivatePeople = request.activeDepartmentRole === "site_admin"
      || (request.activeDepartmentPermissions ?? []).some((permission) => permission === "people_view_private" || permission === "people_manage");
    const result = await pool.query(
      `SELECT group_row.id AS "groupId",group_row.name AS "groupName",group_row.description AS "groupDescription",
              parent.name AS "parentGroupName",person.id AS "contactId",person.first_name AS "firstName",person.last_name AS "lastName",
              CASE WHEN $2::boolean THEN person.email ELSE NULL END AS email,member.role,member.joined_on AS "joinedOn"
         FROM group_members member
         JOIN church_groups group_row ON group_row.id=member.group_id AND group_row.department_id=$1
         JOIN contacts person ON person.id=member.contact_id AND person.department_id=$1
         LEFT JOIN church_groups parent ON parent.id=group_row.parent_group_id AND parent.department_id=$1
        WHERE member.status='active'
          AND lower(regexp_replace(member.role,'[^a-z]','','g')) IN ('leader','coleader','groupowner','groupmanager')
        ORDER BY lower(group_row.name),lower(member.role),lower(person.last_name),lower(person.first_name),person.id
        LIMIT 5000`,
      [departmentId, canSeePrivatePeople],
    );
    return result.rows;
  });

  async function setActor(client: PoolClient, departmentId: string, userId: string) {
    await client.query("SELECT set_config('smart_church.actor_id',$1,true)", [userId]);
    await client.query("SELECT set_config('smart_church.department_id',$1,true)", [departmentId]);
  }

  app.get("/api/modules/group-hierarchy/tree", async (request, reply) => {
    if (!pool || !isDatabaseReady()) return unavailable(reply);
    const departmentId = await resolveDepartmentId(request, reply);
    if (!departmentId) return reply;
    const result = await pool.query<TreeRow>(
      `SELECT g.id,g.name,g.description,g.parent_group_id AS "parentId",
              count(member.contact_id)::int AS "memberCount",
              count(member.contact_id) FILTER (WHERE member.status='active')::int AS "activeCount",
              (SELECT count(*)::int FROM church_groups child WHERE child.parent_group_id=g.id AND child.department_id=g.department_id) AS "subgroupCount",
              (g.source_system IN ('churchtools','elvanto')) AS imported
         FROM church_groups g LEFT JOIN group_members member ON member.group_id=g.id
        WHERE g.department_id=$1 GROUP BY g.id ORDER BY g.parent_group_id NULLS FIRST,lower(g.name),g.id`,
      [departmentId],
    );
    return result.rows;
  });

  app.put<{ Params: { id: string }; Body: { parentId: string | null } }>("/api/modules/group-hierarchy/groups/:id/parent", {
    schema: {
      params: { type: "object", additionalProperties: false, required: ["id"], properties: { id: { type: "string", format: "uuid" } } },
      body: { type: "object", additionalProperties: false, required: ["parentId"], properties: { parentId: { anyOf: [{ type: "string", format: "uuid" }, { type: "null" }] } } },
    },
  }, async (request, reply) => {
    if (!pool || !isDatabaseReady()) return unavailable(reply);
    if (!validateMutation(request, reply)) return reply;
    const departmentId = await resolveDepartmentId(request, reply);
    if (!departmentId) return reply;
    if (!managerGrant(request) && !(await canManageGroup(request, request.params.id, departmentId))) return reply.code(403).send({ error: "Group management access is required." });
    const group = await pool.query<{ source_system: string | null }>("SELECT source_system FROM church_groups WHERE id=$1 AND department_id=$2", [request.params.id, departmentId]);
    if (!group.rowCount) return reply.code(404).send({ error: "Group not found." });
    if (group.rows[0].source_system === "churchtools" || group.rows[0].source_system === "elvanto") return reply.code(403).send({ error: "This group is managed by an external sync." });
    if (request.body.parentId === request.params.id) return reply.code(400).send({ error: "A group cannot be its own subgroup parent." });
    if (request.body.parentId) {
      const parent = await pool.query("SELECT id,source_system FROM church_groups WHERE id=$1 AND department_id=$2", [request.body.parentId, departmentId]);
      if (!parent.rowCount) return reply.code(404).send({ error: "Parent group not found in this location." });
      if (parent.rows[0].source_system === "churchtools" || parent.rows[0].source_system === "elvanto") return reply.code(403).send({ error: "Choose a locally managed parent group." });
      const cycle = await pool.query(
        `WITH RECURSIVE descendants(id) AS (
           SELECT id FROM church_groups WHERE id=$1 AND department_id=$2
           UNION ALL
           SELECT child.id FROM church_groups child JOIN descendants parent ON child.parent_group_id=parent.id WHERE child.department_id=$2
         ) SELECT 1 FROM descendants WHERE id=$3 LIMIT 1`,
        [request.params.id, departmentId, request.body.parentId],
      );
      if (cycle.rowCount) return reply.code(400).send({ error: "That parent would create a circular group hierarchy." });
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await setActor(client, departmentId, request.authenticatedUser!.id);
      await client.query("UPDATE church_groups SET parent_group_id=$1,updated_at=now() WHERE id=$2 AND department_id=$3", [request.body.parentId, request.params.id, departmentId]);
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
    realtime.publish("core:groups:changed", departmentId, { groupId: request.params.id, parentId: request.body.parentId, action: "hierarchy-updated" });
    return { updated: true, parentId: request.body.parentId };
  });

  app.get<{ Params: { id: string } }>("/api/modules/group-hierarchy/groups/:id/history", {
    schema: { params: { type: "object", additionalProperties: false, required: ["id"], properties: { id: { type: "string", format: "uuid" } } } },
  }, async (request, reply) => {
    if (!pool || !isDatabaseReady()) return unavailable(reply);
    const departmentId = await resolveDepartmentId(request, reply);
    if (!departmentId) return reply;
    const group = await pool.query("SELECT id FROM church_groups WHERE id=$1 AND department_id=$2", [request.params.id, departmentId]);
    if (!group.rowCount) return reply.code(404).send({ error: "Group not found." });
    const result = await pool.query(
      `SELECT history.id,history.entity_kind AS "entityKind",history.entity_id AS "entityId",history.action,
              history.before_data AS "beforeData",history.after_data AS "afterData",history.created_at AS "createdAt",
              COALESCE(actor.display_name,'System or imported update') AS "actorName"
         FROM group_hierarchy_history history LEFT JOIN app_users actor ON actor.id=history.actor_user_id
        WHERE history.department_id=$1 AND history.group_id=$2 ORDER BY history.created_at DESC,history.id DESC LIMIT 200`,
      [departmentId, request.params.id],
    );
    return result.rows;
  });

  app.get<{ Params: { id: string } }>("/api/modules/group-hierarchy/groups/:id/notes", {
    schema: { params: { type: "object", additionalProperties: false, required: ["id"], properties: { id: { type: "string", format: "uuid" } } } },
  }, async (request, reply) => {
    if (!pool || !isDatabaseReady()) return unavailable(reply);
    const departmentId = await resolveDepartmentId(request, reply);
    if (!departmentId) return reply;
    const group = await pool.query("SELECT id FROM church_groups WHERE id=$1 AND department_id=$2", [request.params.id, departmentId]);
    if (!group.rowCount) return reply.code(404).send({ error: "Group not found." });
    const canManageNotes = managerGrant(request) || await canManageGroup(request, request.params.id, departmentId);
    if (!canManageNotes) return { notes: [], canManage: false };
    const result = await pool.query(
      `SELECT note.id,note.title,note.body,note.created_at AS "createdAt",note.updated_at AS "updatedAt",
              COALESCE(actor.display_name,'Former user') AS "authorName",note.created_by AS "createdBy"
         FROM group_notes note LEFT JOIN app_users actor ON actor.id=note.created_by
        WHERE note.department_id=$1 AND note.group_id=$2 AND note.archived_at IS NULL
        ORDER BY note.created_at DESC,note.id DESC LIMIT 200`,
      [departmentId, request.params.id],
    );
    return { notes: result.rows.map((row) => ({ ...row, canArchive: managerGrant(request) || row.createdBy === request.authenticatedUser?.id })), canManage: true };
  });

  app.post<{ Params: { id: string }; Body: { title: string; body: string } }>("/api/modules/group-hierarchy/groups/:id/notes", {
    schema: {
      params: { type: "object", additionalProperties: false, required: ["id"], properties: { id: { type: "string", format: "uuid" } } },
      body: { type: "object", additionalProperties: false, required: ["title", "body"], properties: { title: { type: "string", minLength: 1, maxLength: 160 }, body: { type: "string", minLength: 1, maxLength: 10000 } } },
    },
  }, async (request, reply) => {
    if (!pool || !isDatabaseReady()) return unavailable(reply);
    if (!validateMutation(request, reply)) return reply;
    const departmentId = await resolveDepartmentId(request, reply);
    if (!departmentId) return reply;
    const group = await pool.query("SELECT id FROM church_groups WHERE id=$1 AND department_id=$2", [request.params.id, departmentId]);
    if (!group.rowCount) return reply.code(404).send({ error: "Group not found." });
    if (!managerGrant(request) && !(await canManageGroup(request, request.params.id, departmentId))) return reply.code(403).send({ error: "Group leader access is required to add group notes." });
    const title = request.body.title.trim();
    const body = request.body.body.trim();
    if (!title || !body) return reply.code(400).send({ error: "Enter a title and note." });
    const result = await pool.query(
      `INSERT INTO group_notes(id,department_id,group_id,title,body,created_by)
       VALUES($1,$2,$3,$4,$5,$6)
       RETURNING id,title,body,created_at AS "createdAt",updated_at AS "updatedAt"`,
      [randomUUID(), departmentId, request.params.id, title, body, request.authenticatedUser!.id],
    );
    realtime.publish("core:groups:changed", departmentId, { groupId: request.params.id, action: "note-created" });
    return reply.code(201).send({ ...result.rows[0], authorName: request.authenticatedUser?.displayName ?? "You", canArchive: true });
  });

  app.delete<{ Params: { id: string; noteId: string } }>("/api/modules/group-hierarchy/groups/:id/notes/:noteId", {
    schema: { params: { type: "object", additionalProperties: false, required: ["id", "noteId"], properties: { id: { type: "string", format: "uuid" }, noteId: { type: "string", format: "uuid" } } } },
  }, async (request, reply) => {
    if (!pool || !isDatabaseReady()) return unavailable(reply);
    if (!validateMutation(request, reply)) return reply;
    const departmentId = await resolveDepartmentId(request, reply);
    if (!departmentId) return reply;
    const group = await pool.query("SELECT id FROM church_groups WHERE id=$1 AND department_id=$2", [request.params.id, departmentId]);
    if (!group.rowCount) return reply.code(404).send({ error: "Group not found." });
    const result = await pool.query(
      `UPDATE group_notes SET archived_at=now(),archived_by=$4,updated_at=now()
        WHERE id=$1 AND group_id=$2 AND department_id=$3 AND archived_at IS NULL
          AND (created_by=$4 OR $5::boolean)
        RETURNING id`,
      [request.params.noteId, request.params.id, departmentId, request.authenticatedUser!.id, managerGrant(request)],
    );
    if (!result.rowCount) return reply.code(404).send({ error: "Note not found or you cannot archive it." });
    realtime.publish("core:groups:changed", departmentId, { groupId: request.params.id, action: "note-archived" });
    return { archived: true };
  });

  app.get<{ Params: { id: string } }>("/api/modules/group-hierarchy/groups/:id/members", {
    schema: { params: { type: "object", additionalProperties: false, required: ["id"], properties: { id: { type: "string", format: "uuid" } } } },
  }, async (request, reply) => {
    if (!pool || !isDatabaseReady()) return unavailable(reply);
    const departmentId = await resolveDepartmentId(request, reply);
    if (!departmentId) return reply;
    const group = await pool.query("SELECT id FROM church_groups WHERE id=$1 AND department_id=$2", [request.params.id, departmentId]);
    if (!group.rowCount) return reply.code(404).send({ error: "Group not found." });
    const result = await pool.query(
      `SELECT person.id AS "contactId",person.first_name AS "firstName",person.last_name AS "lastName",person.email,
              member.role,member.status,member.joined_on AS "joinedOn",COALESCE(custom.custom_fields,'{}'::jsonb) AS "customFields"
         FROM group_members member JOIN contacts person ON person.id=member.contact_id AND person.department_id=$1
         LEFT JOIN group_membership_custom_fields custom ON custom.group_id=member.group_id AND custom.contact_id=member.contact_id AND custom.department_id=$1
        WHERE member.group_id=$2 ORDER BY lower(person.last_name),lower(person.first_name),person.id`,
      [departmentId, request.params.id],
    );
    return result.rows;
  });

  app.put<{ Params: { groupId: string; contactId: string }; Body: { role: string; status: "active" | "paused" | "waitlist"; joinedOn?: string | null; customFields?: Record<string, unknown> } }>("/api/modules/group-hierarchy/groups/:groupId/members/:contactId", {
    schema: {
      params: { type: "object", additionalProperties: false, required: ["groupId", "contactId"], properties: { groupId: { type: "string", format: "uuid" }, contactId: { type: "string", format: "uuid" } } },
      body: { type: "object", additionalProperties: false, required: ["role", "status"], properties: { role: { type: "string", minLength: 1, maxLength: 80 }, status: { type: "string", enum: ["active", "paused", "waitlist"] }, joinedOn: { anyOf: [{ type: "string", format: "date" }, { type: "null" }] }, customFields: { type: "object", maxProperties: 40 } } },
    },
  }, async (request, reply) => {
    if (!pool || !isDatabaseReady()) return unavailable(reply);
    if (!validateMutation(request, reply)) return reply;
    const departmentId = await resolveDepartmentId(request, reply);
    if (!departmentId) return reply;
    if (!managerGrant(request) && !(await canManageGroup(request, request.params.groupId, departmentId))) return reply.code(403).send({ error: "Group management access is required." });
    const group = await pool.query<{ source_system: string | null }>("SELECT source_system FROM church_groups WHERE id=$1 AND department_id=$2", [request.params.groupId, departmentId]);
    if (!group.rowCount) return reply.code(404).send({ error: "Group not found." });
    if (group.rows[0].source_system === "churchtools" || group.rows[0].source_system === "elvanto") return reply.code(403).send({ error: "This membership is managed by an external sync." });
    const fields = cleanObject(request.body.customFields ?? {});
    if (!fields) return reply.code(400).send({ error: "Custom fields must be a small object of text, number, or yes/no values." });
    const client = await pool.connect();
    let result;
    try {
      await client.query("BEGIN");
      await setActor(client, departmentId, request.authenticatedUser!.id);
      const before = await client.query(
        `SELECT member.group_id AS "groupId",member.contact_id AS "contactId",member.role,member.status,member.joined_on AS "joinedOn",COALESCE(custom.custom_fields,'{}'::jsonb) AS "customFields"
           FROM group_members member LEFT JOIN group_membership_custom_fields custom ON custom.group_id=member.group_id AND custom.contact_id=member.contact_id AND custom.department_id=$3
          WHERE member.group_id=$1 AND member.contact_id=$2 FOR UPDATE OF member`,
        [request.params.groupId, request.params.contactId, departmentId],
      );
      if (!before.rowCount) { await client.query("ROLLBACK"); return reply.code(404).send({ error: "Group membership not found." }); }
      result = await client.query(
        `UPDATE group_members membership SET role=$4,status=$5,joined_on=$6,auto_managed=FALSE
          FROM contacts person WHERE membership.group_id=$1 AND membership.contact_id=$2 AND person.id=membership.contact_id AND person.department_id=$3
          RETURNING membership.group_id AS "groupId",membership.contact_id AS "contactId",membership.role,membership.status,membership.joined_on AS "joinedOn"`,
        [request.params.groupId, request.params.contactId, departmentId, request.body.role.trim(), request.body.status, request.body.joinedOn ?? null],
      );
      if (!result.rowCount) { await client.query("ROLLBACK"); return reply.code(404).send({ error: "Group membership not found." }); }
      await client.query(
        `INSERT INTO group_membership_custom_fields(department_id,group_id,contact_id,custom_fields,updated_by,updated_at)
         VALUES($1,$2,$3,$4::jsonb,$5,now())
         ON CONFLICT(group_id,contact_id) DO UPDATE SET custom_fields=EXCLUDED.custom_fields,updated_by=EXCLUDED.updated_by,updated_at=now()`,
        [departmentId, request.params.groupId, request.params.contactId, JSON.stringify(fields), request.authenticatedUser!.id],
      );
      await client.query(
        `INSERT INTO group_hierarchy_history(id,department_id,group_id,actor_user_id,entity_kind,entity_id,action,before_data,after_data)
         VALUES($1,$2,$3,$4,'membership',$5,'updated',$6::jsonb,$7::jsonb)`,
        [randomUUID(), departmentId, request.params.groupId, request.authenticatedUser!.id, request.params.contactId, JSON.stringify(before.rows[0]), JSON.stringify({ ...result.rows[0], customFields: fields })],
      );
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
    realtime.publish("core:groups:changed", departmentId, { groupId: request.params.groupId, contactId: request.params.contactId, action: "membership-updated" });
    return { ...result.rows[0], customFields: fields };
  });

  app.put<{ Params: { id: string }; Body: { rules: Array<{ contactStatus: "member" | "visitor"; enabled: boolean }> } }>("/api/modules/group-hierarchy/groups/:id/membership-rules", {
    schema: {
      params: { type: "object", additionalProperties: false, required: ["id"], properties: { id: { type: "string", format: "uuid" } } },
      body: { type: "object", additionalProperties: false, required: ["rules"], properties: { rules: { type: "array", maxItems: 2, items: { type: "object", additionalProperties: false, required: ["contactStatus", "enabled"], properties: { contactStatus: { type: "string", enum: ["member", "visitor"] }, enabled: { type: "boolean" } } } } } },
    },
  }, async (request, reply) => {
    if (!pool || !isDatabaseReady()) return unavailable(reply);
    if (!validateMutation(request, reply)) return reply;
    const departmentId = await resolveDepartmentId(request, reply);
    if (!departmentId) return reply;
    if (!managerGrant(request) && !(await canManageGroup(request, request.params.id, departmentId))) return reply.code(403).send({ error: "Group management access is required." });
    if (new Set(request.body.rules.map((rule) => rule.contactStatus)).size !== request.body.rules.length) return reply.code(400).send({ error: "Only one rule per person status is allowed." });
    const group = await pool.query<{ source_system: string | null }>("SELECT source_system FROM church_groups WHERE id=$1 AND department_id=$2", [request.params.id, departmentId]);
    if (!group.rowCount) return reply.code(404).send({ error: "Group not found." });
    if (group.rows[0].source_system === "churchtools" || group.rows[0].source_system === "elvanto") return reply.code(403).send({ error: "Automatic membership is disabled for externally managed groups." });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('smart_church.actor_id',$1,true)", [request.authenticatedUser!.id]);
      await client.query("DELETE FROM group_membership_rules WHERE department_id=$1 AND group_id=$2", [departmentId, request.params.id]);
      for (const rule of request.body.rules) {
        await client.query("INSERT INTO group_membership_rules(id,department_id,group_id,contact_status,enabled,created_by) VALUES($1,$2,$3,$4,$5,$6)", [randomUUID(), departmentId, request.params.id, rule.contactStatus, rule.enabled, request.authenticatedUser!.id]);
      }
      await client.query(
        `DELETE FROM group_members member WHERE member.group_id=$1 AND member.auto_managed=TRUE
          AND NOT EXISTS (SELECT 1 FROM contacts person JOIN group_membership_rules rule ON rule.department_id=person.department_id AND rule.group_id=member.group_id AND rule.enabled=TRUE AND rule.contact_status=person.status WHERE person.id=member.contact_id)`,
        [request.params.id],
      );
      await client.query(
        `INSERT INTO group_members(group_id,contact_id,role,status,joined_on,auto_managed)
         SELECT $1,person.id,'Member','active',CURRENT_DATE,TRUE FROM contacts person JOIN group_membership_rules rule ON rule.department_id=person.department_id AND rule.group_id=$1 AND rule.enabled=TRUE AND rule.contact_status=person.status
         WHERE person.department_id=$2 ON CONFLICT(group_id,contact_id) DO NOTHING`,
        [request.params.id, departmentId],
      );
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
    realtime.publish("core:groups:changed", departmentId, { groupId: request.params.id, action: "membership-rules-updated" });
    return { rules: request.body.rules };
  });

  app.get<{ Params: { id: string } }>("/api/modules/group-hierarchy/groups/:id/membership-rules", {
    schema: { params: { type: "object", additionalProperties: false, required: ["id"], properties: { id: { type: "string", format: "uuid" } } } },
  }, async (request, reply) => {
    if (!pool || !isDatabaseReady()) return unavailable(reply);
    const departmentId = await resolveDepartmentId(request, reply);
    if (!departmentId) return reply;
    const group = await pool.query("SELECT id FROM church_groups WHERE id=$1 AND department_id=$2", [request.params.id, departmentId]);
    if (!group.rowCount) return reply.code(404).send({ error: "Group not found." });
    const result = await pool.query("SELECT contact_status AS \"contactStatus\",enabled FROM group_membership_rules WHERE department_id=$1 AND group_id=$2 ORDER BY contact_status", [departmentId, request.params.id]);
    return result.rows;
  });

  app.post<{ Params: { groupId: string }; Body: { contactId: string } }>("/api/modules/group-hierarchy/groups/:groupId/invitations", {
    schema: {
      params: { type: "object", additionalProperties: false, required: ["groupId"], properties: { groupId: { type: "string", format: "uuid" } } },
      body: { type: "object", additionalProperties: false, required: ["contactId"], properties: { contactId: { type: "string", format: "uuid" } } },
    },
  }, async (request, reply) => {
    if (!pool || !isDatabaseReady()) return unavailable(reply);
    if (!validateMutation(request, reply)) return reply;
    const departmentId = await resolveDepartmentId(request, reply);
    if (!departmentId) return reply;
    if (!managerGrant(request) && !(await canManageGroup(request, request.params.groupId, departmentId))) return reply.code(403).send({ error: "Group management access is required." });
    const candidate = await pool.query("SELECT person.id FROM contacts person JOIN church_groups g ON g.department_id=person.department_id WHERE person.id=$1 AND person.department_id=$2 AND g.id=$3", [request.body.contactId, departmentId, request.params.groupId]);
    if (!candidate.rowCount) return reply.code(404).send({ error: "Choose a person in this location and group." });
    const token = randomUUID();
    const result = await pool.query(
      `INSERT INTO group_hierarchy_invitations(id,department_id,group_id,contact_id,token_hash,created_by,expires_at)
       VALUES($1,$2,$3,$4,$5,$6,now()+interval '14 days') RETURNING id,expires_at AS "expiresAt"`,
      [randomUUID(), departmentId, request.params.groupId, request.body.contactId, createHash("sha256").update(token).digest("hex"), request.authenticatedUser!.id],
    );
    return reply.code(201).send({ id: result.rows[0].id, expiresAt: result.rows[0].expiresAt, invitationToken: token });
  });

  app.post<{ Params: { token: string } }>("/api/modules/group-hierarchy/invitations/:token/accept", {
    schema: { params: { type: "object", additionalProperties: false, required: ["token"], properties: { token: { type: "string", format: "uuid" } } } },
  }, async (request, reply) => {
    if (!pool || !isDatabaseReady()) return unavailable(reply);
    if (!validateMutation(request, reply)) return reply;
    const departmentId = await resolveDepartmentId(request, reply);
    if (!departmentId) return reply;
    const tokenHash = createHash("sha256").update(request.params.token).digest("hex");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const invitation = await client.query<{ id: string; group_id: string; contact_id: string }>(
        "SELECT id,group_id,contact_id FROM group_hierarchy_invitations WHERE token_hash=$1 AND department_id=$2 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at>now() FOR UPDATE",
        [tokenHash, departmentId],
      );
      if (!invitation.rowCount) { await client.query("ROLLBACK"); return reply.code(404).send({ error: "This invitation is unavailable or has expired." }); }
      const account = await client.query("SELECT 1 FROM department_memberships WHERE user_id=$1 AND department_id=$2 AND contact_id=$3", [request.authenticatedUser!.id, departmentId, invitation.rows[0].contact_id]);
      if (!account.rowCount) { await client.query("ROLLBACK"); return reply.code(403).send({ error: "Sign in with the account linked to the invited person." }); }
      await client.query("SELECT set_config('smart_church.actor_id',$1,true)", [request.authenticatedUser!.id]);
      await client.query("INSERT INTO group_members(group_id,contact_id,role,status,joined_on) VALUES($1,$2,'Member','active',CURRENT_DATE) ON CONFLICT(group_id,contact_id) DO NOTHING", [invitation.rows[0].group_id, invitation.rows[0].contact_id]);
      await client.query("UPDATE group_hierarchy_invitations SET accepted_at=now() WHERE id=$1", [invitation.rows[0].id]);
      await client.query("COMMIT");
      realtime.publish("core:groups:changed", departmentId, { groupId: invitation.rows[0].group_id, contactId: invitation.rows[0].contact_id, action: "invitation-accepted" });
      return { accepted: true, groupId: invitation.rows[0].group_id };
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  });

  app.delete<{ Params: { groupId: string; invitationId: string } }>("/api/modules/group-hierarchy/groups/:groupId/invitations/:invitationId", {
    schema: { params: { type: "object", additionalProperties: false, required: ["groupId", "invitationId"], properties: { groupId: { type: "string", format: "uuid" }, invitationId: { type: "string", format: "uuid" } } } },
  }, async (request, reply) => {
    if (!pool || !isDatabaseReady()) return unavailable(reply);
    if (!validateMutation(request, reply)) return reply;
    const departmentId = await resolveDepartmentId(request, reply);
    if (!departmentId) return reply;
    if (!managerGrant(request) && !(await canManageGroup(request, request.params.groupId, departmentId))) return reply.code(403).send({ error: "Group management access is required." });
    const result = await pool.query("UPDATE group_hierarchy_invitations SET revoked_at=now() WHERE id=$1 AND group_id=$2 AND department_id=$3 AND accepted_at IS NULL AND revoked_at IS NULL RETURNING id", [request.params.invitationId, request.params.groupId, departmentId]);
    if (!result.rowCount) return reply.code(404).send({ error: "Pending invitation not found." });
    return { revoked: true };
  });
}
