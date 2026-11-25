import type { PoolClient } from "pg";
import type { FastifyInstance } from "fastify";
import type { GroupMeetingPlace } from "@smart-church/contracts";
import type { ModuleServerContext } from "../module-sdk.js";
import { editGroupMeetingLocation, type ResolveGroupManager } from "./group-meeting-pins.js";

const fields = { name: 160, street: 200, postalCode: 24, locality: 120, country: 80 } as const;
const fieldKeys = Object.keys(fields) as Array<keyof typeof fields>;
type PlaceRow = { group_id: string; place: GroupMeetingPlace; public_approval_hash?: string | null };
const publicApprovalHash = /^[a-f0-9]{64}$/;

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
          ON CONFLICT(group_id) DO UPDATE SET place=EXCLUDED.place,
          public_approval_hash=CASE WHEN group_meeting_places.place=EXCLUDED.place THEN group_meeting_places.public_approval_hash ELSE NULL END`, [groupId, departmentId, JSON.stringify(place)]);
      } else {
        await client.query("DELETE FROM group_meeting_places WHERE group_id=$1 AND department_id=$2", [groupId, departmentId]);
      }
    });
  });

  routes.put<{ Params: { id: string }; Body: { enabled: boolean; expectedSignupToken?: string; expectedPlace?: GroupMeetingPlace } }>(
    "/api/groups/:id/meeting-place/publication",
    { schema: {
      params: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } },
      body: { type: "object", additionalProperties: false, required: ["enabled"], properties: {
        enabled: { type: "boolean" },
        expectedSignupToken: { type: "string", format: "uuid" },
        expectedPlace: { type: "object", additionalProperties: false, required: ["visibility"], properties: {
          ...Object.fromEntries(fieldKeys.map(key => [key, { type: "string", maxLength: fields[key] }])),
          visibility: { type: "string", enum: ["managers", "members"] },
        } },
      } },
    } },
    async (request, reply) => {
      const departmentId = await department(request, reply);
      if (!departmentId || !context.validateMutation(request, reply)) return reply;
      const groupId = request.params.id;
      const { enabled, expectedSignupToken } = request.body;
      const expectedPlace = normalizedPlace(request.body.expectedPlace ?? null);
      if (enabled && (!expectedSignupToken || !expectedPlace)) return reply.code(400).send({ error: "Review the saved meeting place and current signup link before publishing." });
      return editGroupMeetingLocation(context, reply, departmentId, groupId, "place", { publicMeetingPlace: enabled }, async client => {
        const result = await client.query(
          `UPDATE group_meeting_places meeting SET public_approval_hash=CASE WHEN $3::boolean
             THEN encode(sha256(convert_to(g.public_signup_token::text || ':' || meeting.place::text,'UTF8')),'hex') ELSE NULL END
           FROM church_groups g WHERE g.id=meeting.group_id AND g.department_id=meeting.department_id
             AND meeting.group_id=$1 AND meeting.department_id=$2 AND (
               NOT $3::boolean OR (g.status='active' AND g.public_signup_enabled AND g.public_signup_token=$4::uuid
                 AND meeting.place=$5::jsonb))
           RETURNING meeting.group_id`,
          [groupId, departmentId, enabled, expectedSignupToken ?? null, expectedPlace ? JSON.stringify(expectedPlace) : null]);
        if (enabled && !result.rowCount) return { status: 409, error: "The meeting place or public signup link has changed. Review the current settings before publishing." };
      });
    },
  );
}

export async function loadGroupMeetingPlaces(client: PoolClient, departmentId: string) {
  return (await client.query<PlaceRow>(
    "SELECT group_id,place,public_approval_hash FROM group_meeting_places WHERE department_id=$1 ORDER BY group_id", [departmentId],
  )).rows;
}

export async function restoreGroupMeetingPlaces(client: PoolClient, departmentId: string, places: PlaceRow[], withPublicApproval: boolean) {
  await client.query("DELETE FROM group_meeting_places WHERE department_id=$1", [departmentId]);
  for (const row of places) {
    const place = typeof row?.group_id === "string" ? normalizedPlace(row.place) : null;
    if (!place) throw new Error("The Community snapshot contains an invalid meeting place.");
    const approval = withPublicApproval ? row.public_approval_hash ?? null : null;
    if (approval !== null && (typeof approval !== "string" || !publicApprovalHash.test(approval))) {
      throw new Error("The Community snapshot contains an invalid meeting-place publication.");
    }
    const result = await client.query(
      `INSERT INTO group_meeting_places(group_id,department_id,place,public_approval_hash)
       SELECT id,$1,$3::jsonb,$4 FROM church_groups WHERE department_id=$1 AND id=$2`,
      [departmentId, row.group_id, JSON.stringify(place), approval],
    );
    if (!result.rowCount) throw new Error("A meeting place references a group outside the restored location.");
  }
}
