import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ModuleServerContext } from "../module-sdk.js";
import { accessiblePeopleGroups, canManageMembershipHistory } from "./profile-history.js";

type Department = (request: FastifyRequest, reply: FastifyReply) => Promise<string | null>;
const uuid = { type: "string", format: "uuid" } as const;

export function presentMeetingFilter(meetingId?: string | null) {
  return meetingId ? `EXISTS (
    SELECT 1 FROM group_meeting_attendance attendance JOIN group_meetings meeting ON meeting.id=attendance.meeting_id
     WHERE meeting.department_id=$1 AND meeting.id=$14::uuid AND attendance.contact_id=c.id AND attendance.status='present'
  )` : "$14::uuid IS NULL";
}

export function registerPeopleMeetingFilter(routes: FastifyInstance, context: ModuleServerContext, department: Department) {
  const { pool } = context;

  async function attendanceAvailable() {
    const result = await pool!.query<{ installed: boolean }>(
      `SELECT to_regclass('public.group_meetings') IS NOT NULL
          AND to_regclass('public.group_meeting_attendance') IS NOT NULL AS installed`,
    );
    return result.rows[0]?.installed === true;
  }

  routes.get<{ Querystring: { q?: string; id?: string } }>("/api/people-records/directory-attendance-meetings", {
    schema: { querystring: { type: "object", additionalProperties: false,
      properties: { q: { type: "string", maxLength: 100 }, id: uuid },
    } },
  }, async (request, reply) => {
    const departmentId = await department(request, reply);
    if (!departmentId) return reply;
    reply.header("Cache-Control", "private, no-store");
    if (!await attendanceAvailable()) return { available: false, meetings: [] };
    const query = request.query.q?.trim() ?? "";
    const result = await pool!.query(
      `SELECT meeting.id,meeting.title,meeting.meeting_date::text AS date,allowed.name AS "groupName"
         FROM group_meetings meeting JOIN (${accessiblePeopleGroups(2, 3)}) allowed ON allowed.id=meeting.group_id
        WHERE meeting.department_id=$1
          AND ($4::text='' OR strpos(lower(concat_ws(' ',allowed.name,meeting.title,meeting.meeting_date::text)),lower($4))>0 OR meeting.id=$5::uuid)
        ORDER BY (meeting.id=$5::uuid) DESC NULLS LAST,meeting.meeting_date DESC,meeting.id LIMIT 100`,
      [departmentId, canManageMembershipHistory(request), request.authenticatedUser!.id, query, request.query.id ?? null],
    );
    return { available: true, meetings: result.rows };
  });

  return async function canFilterAttendedMeeting(request: FastifyRequest, reply: FastifyReply, departmentId: string, meetingId?: string | null) {
    if (!meetingId) return true;
    if (!await attendanceAvailable()) {
      reply.code(409).send({ error: "Group meeting attendance is unavailable at this location." });
      return false;
    }
    const allowed = await pool!.query(
      `SELECT 1 FROM group_meetings meeting JOIN (${accessiblePeopleGroups(2, 3)}) groups ON groups.id=meeting.group_id
        WHERE meeting.department_id=$1 AND meeting.id=$4`,
      [departmentId, canManageMembershipHistory(request), request.authenticatedUser!.id, meetingId],
    );
    if (!allowed.rowCount) {
      reply.code(403).send({ error: "You do not have access to that meeting's attendance." });
      return false;
    }
    reply.header("Cache-Control", "private, no-store");
    return true;
  };
}
