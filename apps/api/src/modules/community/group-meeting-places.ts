import type { PoolClient } from "pg";
import type { FastifyInstance } from "fastify";
import type { GroupMeetingPlace } from "@smart-church/contracts";
import type { ModuleServerContext } from "../module-sdk.js";
import { editGroupMeetingLocation, type ResolveGroupManager } from "./group-meeting-pins.js";

const fields = { name: 160, street: 200, postalCode: 24, locality: 120, country: 80 } as const;
const fieldKeys = Object.keys(fields) as Array<keyof typeof fields>;
type PlaceRow = { group_id: string; place: GroupMeetingPlace };

function normalizedPlace(input: Partial<GroupMeetingPlace> | null) {
  if (!input || !["managers", "members"].includes(String(input.visibility))) return null;
  const place = { ...Object.fromEntries(fieldKeys.map(key => [
    key, (typeof input[key] === "string" ? input[key] : "").replace(/[\u0000-\u001f\u007f]/g, " ").trim(),
  ])), visibility: input.visibility } as GroupMeetingPlace;
  if (fieldKeys.some(key => place[key].length > fields[key]) || !fieldKeys.some(key => place[key])) return null;
  return place;
}

export function registerGroupMeetingPlaces(routes: FastifyInstance, context: ModuleServerContext, department: ResolveGroupManager) {
  routes.put<{ Params: { id: string }; Body: { place: GroupMeetingPlace | null } }>("/api/groups/:id/meeting-place", {
    schema: {
      params: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } },
      body: { type: "object", required: ["place"], additionalProperties: false, properties: {
        place: { anyOf: [{ type: "null" }, { type: "object", additionalProperties: false, required: ["visibility"], properties: {
          ...Object.fromEntries(fieldKeys.map(key => [key, { type: "string", maxLength: fields[key] }])),
          visibility: { type: "string", enum: ["managers", "members"] },
        } }] },
      } },
    },
  }, async (request, reply) => {
    const departmentId = await department(request, reply);
    if (!departmentId || !context.validateMutation(request, reply)) return reply;
    const groupId = request.params.id;
    const place = normalizedPlace(request.body.place);
    if (request.body.place !== null && !place) return reply.code(400).send({ error: "Enter at least one meeting-place detail." });
    return editGroupMeetingLocation(context, reply, departmentId, groupId, "place", { place }, async client => {
      if (place) {
        await client.query(`INSERT INTO group_meeting_places(group_id,department_id,place) VALUES($1,$2,$3::jsonb)
          ON CONFLICT(group_id) DO UPDATE SET place=EXCLUDED.place`, [groupId, departmentId, JSON.stringify(place)]);
      } else {
        await client.query("DELETE FROM group_meeting_places WHERE group_id=$1 AND department_id=$2", [groupId, departmentId]);
      }
    });
  });
}

export async function loadGroupMeetingPlaces(client: PoolClient, departmentId: string) {
  return (await client.query<PlaceRow>(
    "SELECT group_id,place FROM group_meeting_places WHERE department_id=$1 ORDER BY group_id", [departmentId],
  )).rows;
}

export async function restoreGroupMeetingPlaces(client: PoolClient, departmentId: string, places: PlaceRow[]) {
  await client.query("DELETE FROM group_meeting_places WHERE department_id=$1", [departmentId]);
  for (const row of places) {
    const place = typeof row?.group_id === "string" ? normalizedPlace(row.place) : null;
    if (!place) throw new Error("The Community snapshot contains an invalid meeting place.");
    const result = await client.query(
      `INSERT INTO group_meeting_places(group_id,department_id,place)
       SELECT id,$1,$3::jsonb FROM church_groups WHERE department_id=$1 AND id=$2`,
      [departmentId, row.group_id, JSON.stringify(place)],
    );
    if (!result.rowCount) throw new Error("A meeting place references a group outside the restored location.");
  }
}
