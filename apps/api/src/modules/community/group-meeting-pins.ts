import type { PoolClient } from "pg";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ChurchGroup } from "@smart-church/contracts";
import type { ModuleServerContext } from "../module-sdk.js";

type MeetingPin = NonNullable<ChurchGroup["meetingPin"]>;
type MeetingPinRow = { group_id: string; latitude: number; longitude: number };

export function isMeetingPin(value: MeetingPin) {
  return Number.isFinite(value.latitude) && Math.abs(value.latitude) <= 85.05112878
    && Number.isFinite(value.longitude) && Math.abs(value.longitude) <= 180;
}

const meetingPin = {
  type: "object", additionalProperties: false, required: ["latitude", "longitude"],
  properties: {
    latitude: { type: "number", minimum: -85.05112878, maximum: 85.05112878 },
    longitude: { type: "number", minimum: -180, maximum: 180 },
  },
} as const;

export type ResolveGroupManager = (request: FastifyRequest, reply: FastifyReply) => Promise<string | null>;

export async function editGroupMeetingLocation(
  context: ModuleServerContext, reply: FastifyReply, department: string, groupId: string,
  kind: "pin" | "place", result: object, apply: (client: PoolClient) => Promise<void>,
) {
  const client = await context.pool!.connect();
  try {
    await client.query("BEGIN");
    if (!await context.lockDepartmentForWrite(client, department)) {
      await client.query("ROLLBACK");
      return reply.code(423).send({ error: "This location is read-only." });
    }
    const { rows: [group] } = await client.query<{ source_system: string | null; status: string }>(
      "SELECT source_system,status FROM church_groups WHERE id=$1 AND department_id=$2 FOR UPDATE", [groupId, department]);
    if (!group || group.source_system || group.status === "archived") {
      await client.query("ROLLBACK");
      if (!group) return reply.code(404).send({ error: "Group not found." });
      if (group.source_system) return reply.code(403).send({ error: "This group is managed in its source system." });
      return reply.code(409).send({ error: `Restore the group before editing its meeting ${kind}.` });
    }
    await apply(client);
    await client.query("COMMIT");
    context.realtime.publish("core:groups:changed", department, { groupId, action: `meeting-${kind}-updated` });
    return reply.header("Cache-Control", "private, no-store").send(result);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally { client.release(); }
}

export function registerGroupMeetingPins(
  routes: FastifyInstance,
  context: ModuleServerContext,
  resolveManagerDepartment: ResolveGroupManager,
) {
  routes.put<{ Params: { id: string }; Body: { pin: MeetingPin | null } }>("/api/groups/:id/meeting-pin", {
    schema: {
      params: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } },
      body: { type: "object", additionalProperties: false, required: ["pin"], properties: {
        pin: { anyOf: [meetingPin, { type: "null" }] },
      } },
    },
  }, async (request, reply) => {
    const department = await resolveManagerDepartment(request, reply);
    if (!department || !context.validateMutation(request, reply)) return reply;
    const groupId = request.params.id;
    const { pin } = request.body;
    if (pin && !isMeetingPin(pin)) return reply.code(400).send({ error: "Enter valid map coordinates." });
    return editGroupMeetingLocation(context, reply, department, groupId, "pin", { pin }, async client => {
      if (pin) {
        await client.query(`INSERT INTO group_meeting_pins(group_id,department_id,latitude,longitude) VALUES($1,$2,$3,$4)
          ON CONFLICT(group_id) DO UPDATE SET latitude=EXCLUDED.latitude,longitude=EXCLUDED.longitude`,
        [groupId, department, pin.latitude, pin.longitude]);
      } else {
        await client.query("DELETE FROM group_meeting_pins WHERE group_id=$1 AND department_id=$2", [groupId, department]);
      }
    });
  });
}

export async function loadGroupMeetingPins(client: PoolClient, departmentId: string) {
  return (await client.query<MeetingPinRow>(
    "SELECT group_id,latitude,longitude FROM group_meeting_pins WHERE department_id=$1 ORDER BY group_id", [departmentId],
  )).rows;
}

export async function restoreGroupMeetingPins(client: PoolClient, departmentId: string, pins: MeetingPinRow[]) {
  await client.query("DELETE FROM group_meeting_pins WHERE department_id=$1", [departmentId]);
  for (const row of pins) {
    if (!row || typeof row.group_id !== "string" || !isMeetingPin(row)) throw new Error("The Community snapshot contains an invalid meeting pin.");
    const result = await client.query(
      `INSERT INTO group_meeting_pins(group_id,department_id,latitude,longitude)
       SELECT id,$1,$3,$4 FROM church_groups WHERE department_id=$1 AND id=$2`,
      [departmentId, row.group_id, row.latitude, row.longitude],
    );
    if (!result.rowCount) throw new Error("A meeting pin references a group outside the restored location.");
  }
}
