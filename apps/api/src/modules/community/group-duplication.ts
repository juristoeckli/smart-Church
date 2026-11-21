import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ModuleServerContext } from "../module-sdk.js";

type Location = (request: FastifyRequest, reply: FastifyReply) => Promise<string | null>;

export function registerGroupDuplication(routes: FastifyInstance, context: ModuleServerContext, location: Location) {
  const { pool, validateMutation, lockDepartmentForWrite, realtime } = context;
  routes.post<{ Params: { id: string }; Body: { name: string; copyFields?: boolean } }>("/api/groups/:id/duplicate", {
    schema: {
      params: { type: "object", additionalProperties: false, required: ["id"], properties: { id: { type: "string", format: "uuid" } } },
      body: { type: "object", additionalProperties: false, required: ["name"], properties: {
        name: { type: "string", minLength: 1, maxLength: 120 }, copyFields: { type: "boolean" },
      } },
    },
  }, async (request, reply) => {
    const departmentId = await location(request, reply);
    if (!departmentId || !validateMutation(request, reply)) return reply;
    const name = request.body.name.trim();
    if (!name || name.includes("\u0000")) return reply.code(400).send({ error: "Enter a valid name for the group copy." });
    const actorId = request.authenticatedUser!.id;
    const client = await pool!.connect();
    const id = randomUUID();
    let copiedFieldCount = 0;
    try {
      await client.query("BEGIN");
      if (!await lockDepartmentForWrite(client, departmentId)) {
        await client.query("ROLLBACK");
        return reply.code(423).send({ error: "This location is read-only." });
      }
      const source = await client.query<{ description: string; group_type: string | null; source_system: string | null }>(
        "SELECT description,group_type,source_system FROM church_groups WHERE department_id=$1 AND id=$2 FOR SHARE",
        [departmentId, request.params.id],
      );
      if (!source.rows[0]) {
        await client.query("ROLLBACK");
        return reply.code(404).send({ error: "Group not found at this location." });
      }
      if (source.rows[0].source_system) {
        await client.query("ROLLBACK");
        return reply.code(403).send({ error: "Only local groups can be duplicated." });
      }
      if (request.body.copyFields) {
        const available = await client.query<{ supported: boolean }>(
          `SELECT EXISTS(
             SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass('public.group_member_field_definitions')
               AND attname='default_value' AND NOT attisdropped
           ) AS supported`,
        );
        if (!available.rows[0]?.supported) {
          await client.query("ROLLBACK");
          return reply.code(409).send({ error: "Membership field settings are unavailable. Uncheck the option to copy the basic group settings." });
        }
      }
      await client.query("SELECT set_config('smart_church.actor_id',$1,true),set_config('smart_church.department_id',$2,true)", [actorId, departmentId]);
      const { description, group_type: groupType } = source.rows[0];
      await client.query(
        `INSERT INTO church_groups(id,department_id,name,description,group_type,status,public_signup_enabled,public_signup_token)
         VALUES($1,$2,$3,$4,$5,'draft',false,NULL)`,
        [id, departmentId, name, description, groupType ?? ""],
      );
      if (request.body.copyFields) {
        const fields = await client.query(
          `INSERT INTO group_member_field_definitions(id,department_id,group_id,label,field_type,options,default_value,created_by,created_at)
           SELECT gen_random_uuid(),department_id,$3,label,field_type,options,default_value,$4,
                  now() + (row_number() OVER (ORDER BY created_at,id) - 1) * interval '1 microsecond'
           FROM group_member_field_definitions WHERE department_id=$1 AND group_id=$2 AND archived_at IS NULL
           ORDER BY created_at,id`,
          [departmentId, request.params.id, id, actorId],
        );
        copiedFieldCount = fields.rowCount ?? 0;
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      if ((error as { code?: string }).code === "23505") return reply.code(409).send({ error: "A group with that name already exists at this location." });
      throw error;
    } finally { client.release(); }
    realtime.publish("core:groups:changed", departmentId, { action: "duplicated", groupId: id });
    return reply.code(201).send({ id, copiedFieldCount });
  });
}
