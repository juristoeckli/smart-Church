import { createHash, randomBytes } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { PoolClient } from "pg";
import QRCode from "qrcode";
import type { ModuleServerContext } from "../module-sdk.js";

const root = "/api/modules/check-in/groups/:groupId/attendance-codes";
const uuid = { type: "string", format: "uuid" } as const;
const groupParams = { type: "object", additionalProperties: false, required: ["groupId"], properties: { groupId: uuid } } as const;
const memberParams = { ...groupParams, required: ["groupId", "contactId"], properties: { groupId: uuid, contactId: uuid } } as const;
const meetingParams = { ...groupParams, required: ["groupId", "meetingId"], properties: { groupId: uuid, meetingId: uuid } } as const;
const invalidCode = "This code does not match an eligible attendee on the selected meeting roster.";

type GroupParams = { groupId: string };
type MemberParams = GroupParams & { contactId: string };
type MeetingParams = GroupParams & { meetingId: string };
type Policy = { enabled: boolean; roles: string[] };
type Role = { key: string; label: string };
type Member = { contactId: string; firstName: string; lastName: string; roleKey: string; issuedAt: Date | null };

function codeDigest(code: string) {
  return createHash("sha256").update(code, "ascii").digest("hex");
}

async function readGroup(client: Pick<PoolClient, "query">, departmentId: string, groupId: string, lock = false) {
  const { rows: [group] } = await client.query<Policy>(
    'SELECT check_in_codes_enabled AS enabled, check_in_code_roles AS roles FROM church_groups ' +
    'WHERE department_id=$1 AND id=$2 AND status=\'active\' AND source_system IS NULL' + (lock ? " FOR UPDATE" : ""),
    [departmentId, groupId],
  );
  return group;
}

function availableRoles(client: Pick<PoolClient, "query">, departmentId: string, groupId: string) {
  return client.query<Role>(
    `SELECT lower(btrim(m.role)) AS key, min(btrim(m.role)) AS label
       FROM group_members m JOIN contacts p ON p.id=m.contact_id AND p.department_id=$1 AND p.archived_at IS NULL
      WHERE m.group_id=$2 AND m.status='active' GROUP BY lower(btrim(m.role)) ORDER BY key`, [departmentId, groupId],
  );
}

async function policyMembers(client: Pick<PoolClient, "query">, departmentId: string, groupId: string, roles: string[]) {
  const { rows } = await client.query<Member>(
    `SELECT p.id AS "contactId",p.first_name AS "firstName",p.last_name AS "lastName",
            lower(btrim(member.role)) AS "roleKey",code.issued_at AS "issuedAt"
       FROM group_members member
       JOIN contacts p ON p.id=member.contact_id AND p.department_id=$1 AND p.archived_at IS NULL
       LEFT JOIN check_in_group_member_codes code ON code.group_id=member.group_id AND code.contact_id=member.contact_id
      WHERE member.group_id=$2 AND member.status='active' AND lower(btrim(member.role))=ANY($3::text[])
      ORDER BY lower(p.last_name),lower(p.first_name),p.id`, [departmentId, groupId, roles],
  );
  return rows;
}

export function registerGroupAttendanceCodes(app: FastifyInstance, context: ModuleServerContext) {
  const { pool, isDatabaseReady, resolveDepartmentId, validateMutation, realtime } = context;
  async function scope(request: FastifyRequest, reply: FastifyReply) {
    reply.header("Cache-Control", "private, no-store");
    if (!pool || !isDatabaseReady()) {
      reply.code(503).send({ error: "Attendance codes are unavailable while the database is offline." });
      return null;
    }
    return resolveDepartmentId(request, reply, false, false, "groups_manage");
  }

  async function write<T>(request: FastifyRequest, reply: FastifyReply, action: (client: PoolClient, departmentId: string) => Promise<T>) {
    const departmentId = await scope(request, reply);
    if (!departmentId || !validateMutation(request, reply)) return;
    const client = await pool!.connect();
    try {
      await client.query("BEGIN");
      if (!await context.lockDepartmentForWrite(client, departmentId)) {
        reply.code(423).send({ error: "This location is read-only." });
        await client.query("ROLLBACK");
        return;
      }
      const result = await action(client, departmentId);
      if (reply.sent) {
        await client.query("ROLLBACK");
        return;
      }
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }

  const unavailableGroup = (reply: FastifyReply) => reply.code(404).send({ error: "Active local group not found." });
  const disabled = (reply: FastifyReply) => reply.code(409).send({ error: "Attendance codes are disabled for this group." });

  app.get<{ Params: GroupParams }>(root, { schema: { params: groupParams } }, async (request, reply) => {
    const departmentId = await scope(request, reply);
    if (!departmentId) return reply;
    const group = await readGroup(pool!, departmentId, request.params.groupId);
    if (!group) return unavailableGroup(reply);
    const { rows: roles } = await availableRoles(pool!, departmentId, request.params.groupId);
    const members = group.enabled ? await policyMembers(pool!, departmentId, request.params.groupId, group.roles) : [];
    return { ...group, availableRoles: roles, members };
  });

  app.put<{ Params: GroupParams; Body: Policy }>(root, { schema: {
    params: groupParams, body: { type: "object", additionalProperties: false, required: ["enabled", "roles"], properties: {
      enabled: { type: "boolean" }, roles: { type: "array", maxItems: 100, uniqueItems: true, items: { type: "string", minLength: 1, maxLength: 80 } },
    } },
  } }, async (request, reply) => {
    const { groupId } = request.params;
    const result = await write(request, reply, async (client, departmentId) => {
      if (!await readGroup(client, departmentId, groupId, true)) return unavailableGroup(reply);
      const { rows: roles } = await availableRoles(client, departmentId, groupId);
      const { enabled } = request.body;
      const allowed = new Set(roles.map((role) => role.key));
      if (enabled && (!request.body.roles.length || request.body.roles.some((role) => !allowed.has(role)))) {
        return reply.code(400).send({ error: "Select at least one active group role." });
      }
      const nextRoles = request.body.roles.filter((role) => allowed.has(role));
      await client.query(
        "UPDATE church_groups SET check_in_codes_enabled=$3,check_in_code_roles=$4::text[] WHERE department_id=$1 AND id=$2",
        [departmentId, groupId, enabled, nextRoles],
      );
      await client.query(
        `DELETE FROM check_in_group_member_codes code WHERE code.group_id=$1 AND
          (NOT $2::boolean OR NOT EXISTS (
             SELECT 1 FROM group_members m JOIN contacts p ON p.id=m.contact_id AND p.department_id=$4 AND p.archived_at IS NULL
              WHERE m.group_id=$1 AND m.contact_id=code.contact_id AND m.status='active' AND lower(btrim(m.role))=ANY($3::text[])
           ))`,
        [groupId, enabled, nextRoles, departmentId],
      );
      return { enabled, roles: nextRoles };
    });
    return result ?? reply;
  });

  app.post<{ Params: MemberParams }>(root + "/members/:contactId", { schema: { params: memberParams } }, async (request, reply) => {
    const { groupId, contactId } = request.params;
    const result = await write(request, reply, async (client, departmentId) => {
      const group = await readGroup(client, departmentId, groupId, true);
      if (!group) return unavailableGroup(reply);
      if (!group.enabled) return disabled(reply);
      const member = await client.query(
        `SELECT m.contact_id FROM group_members m JOIN contacts p ON p.id=m.contact_id AND p.department_id=$1 AND p.archived_at IS NULL
          WHERE m.group_id=$2 AND m.contact_id=$3 AND m.status='active' AND lower(btrim(m.role))=ANY($4::text[])
          FOR SHARE OF m,p`, [departmentId, groupId, contactId, group.roles],
      );
      if (!member.rowCount) return reply.code(404).send({ error: "Eligible group member not found." });
      const code = "SC-A1-" + randomBytes(16).toString("hex").toUpperCase();
      const qr = await QRCode.toDataURL(code, { width: 256, margin: 2, errorCorrectionLevel: "M" });
      await client.query(
        `INSERT INTO check_in_group_member_codes(group_id,contact_id,code_digest,issued_by) VALUES($1,$2,$3,$4)
          ON CONFLICT(group_id,contact_id) DO UPDATE SET code_digest=excluded.code_digest,issued_by=excluded.issued_by,issued_at=now()`,
        [groupId, contactId, codeDigest(code), request.authenticatedUser?.id ?? null],
      );
      return { code, qr };
    });
    return result ?? reply;
  });

  app.delete<{ Params: MemberParams }>(root + "/members/:contactId", { schema: { params: memberParams } }, async (request, reply) => {
    const { groupId, contactId } = request.params;
    const result = await write(request, reply, async (client, departmentId) => {
      if (!await readGroup(client, departmentId, groupId, true)) return unavailableGroup(reply);
      await client.query(
        `DELETE FROM check_in_group_member_codes code USING contacts p
          WHERE code.group_id=$1 AND code.contact_id=$2 AND p.id=code.contact_id AND p.department_id=$3`,
        [groupId, contactId, departmentId],
      );
      return { revoked: true };
    });
    return result ?? reply;
  });

  app.post<{ Params: MeetingParams; Body: { code: string } }>(root + "/meetings/:meetingId/redeem", { schema: {
    params: meetingParams, body: { type: "object", additionalProperties: false, required: ["code"], properties: {
      code: { type: "string", minLength: 1, maxLength: 100 },
    } },
  } }, async (request, reply) => {
    const { groupId, meetingId } = request.params;
    const result = await write(request, reply, async (client, departmentId) => {
      const group = await readGroup(client, departmentId, groupId, true);
      if (!group) { unavailableGroup(reply); return; }
      if (!group.enabled) { disabled(reply); return; }
      // Group first, matching native meeting and membership writers.
      const { rows: [meeting] } = await client.query<{ attendance_completed_at: Date | null }>(
        "SELECT attendance_completed_at FROM group_meetings WHERE department_id=$1 AND group_id=$2 AND id=$3 FOR UPDATE",
        [departmentId, groupId, meetingId],
      );
      if (!meeting) { reply.code(404).send({ error: "Group meeting not found." }); return; }
      if (meeting.attendance_completed_at) { reply.code(409).send({ error: "This group meeting is completed." }); return; }
      const code = request.body.code.trim().toUpperCase();
      if (!/^SC-A1-[0-9A-F]{32}$/.test(code)) { reply.code(404).send({ error: invalidCode }); return; }
      const { rows: [attendee] } = await client.query<{ contact_id: string }>(
        `SELECT code.contact_id FROM check_in_group_member_codes code
          JOIN group_members member ON member.group_id=code.group_id AND member.contact_id=code.contact_id
          JOIN contacts p ON p.id=member.contact_id AND p.department_id=$1 AND p.archived_at IS NULL
          JOIN group_meeting_attendance attendance ON attendance.meeting_id=$3 AND attendance.contact_id=code.contact_id
         WHERE code.group_id=$2 AND code.code_digest=$4 AND member.status='active' AND lower(btrim(member.role))=ANY($5::text[])
         FOR SHARE OF p,member`,
        [departmentId, groupId, meetingId, codeDigest(code), group.roles],
      );
      if (!attendee) { reply.code(404).send({ error: invalidCode }); return; }
      const updated = await client.query(
        "UPDATE group_meeting_attendance SET status='present',updated_at=now() WHERE meeting_id=$1 AND contact_id=$2 AND status<>'present'",
        [meetingId, attendee.contact_id],
      );
      return { departmentId, changed: Boolean(updated.rowCount) };
    });
    if (!result) return reply;
    if (result.changed) realtime.publish("core:groups:changed", result.departmentId, { groupId, meetingId, action: "meeting-attendance-updated" });
    return { recorded: true, alreadyPresent: !result.changed };
  });
}
