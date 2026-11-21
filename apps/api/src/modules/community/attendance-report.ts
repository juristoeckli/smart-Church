import type { FastifyReply } from "fastify";
import type { Pool } from "pg";
import { csvDocument } from "../../csv-export.js";
import { createWorkbook } from "../finance/workbook.js";

const reportKinds = ["meetings", "people"] as const;
const meetingStates = ["upcoming", "open", "completed"] as const;
export type AttendanceReportQuery = {
  kind?: typeof reportKinds[number];
  state?: typeof meetingStates[number];
  from?: string;
  to?: string;
  member?: string;
  contactId?: string;
  format?: "csv" | "xlsx";
};
export const attendanceReportQuery = {
  type: "object", additionalProperties: false, properties: {
    kind: { type: "string", enum: reportKinds }, state: { type: "string", enum: meetingStates },
    from: { type: "string", format: "date" }, to: { type: "string", format: "date" },
    member: { type: "string", maxLength: 160 }, contactId: { type: "string", format: "uuid" },
    format: { type: "string", enum: ["csv", "xlsx"] },
  },
} as const;

const maxExportRows = 20000;
const maxPreviewRows = 1000;
const commonColumns = [{ key: "date", label: "Meeting date" }, { key: "title", label: "Meeting" }, { key: "state", label: "Meeting state" }];
const columnsByKind = {
  meetings: [
    ...commonColumns, { key: "rosterCount", label: "Roster" }, { key: "present", label: "Present" },
    { key: "absent", label: "Absent" }, { key: "excused", label: "Excused" },
  ],
  people: [
    ...commonColumns, { key: "firstName", label: "First name" }, { key: "lastName", label: "Last name" }, { key: "attendance", label: "Attendance" },
  ],
};

export async function sendGroupAttendanceReport(pool: Pool, reply: FastifyReply, departmentId: string, groupId: string, query: AttendanceReportQuery) {
  if (query.from && query.to && query.from > query.to) return reply.code(400).send({ error: "Choose an end date on or after the start date." });
  const found = await pool.query<{ source_system: string | null }>(
    "SELECT source_system FROM church_groups WHERE department_id=$1 AND id=$2", [departmentId, groupId],
  );
  const group = found.rows[0];
  if (!group) return reply.code(404).send({ error: "Group not found." });
  if (group.source_system === "churchtools" || group.source_system === "elvanto") {
    return reply.code(403).send({ error: "Imported attendance reports are managed in the source system." });
  }
  const kind = query.kind ?? "meetings";
  const maxRows = query.format ? maxExportRows : maxPreviewRows;
  const member = query.member?.trim() || null;
  const join = kind === "people" || member || query.contactId ? "JOIN" : "LEFT JOIN";
  const selection = kind === "people"
    ? `SELECT m.id AS "meetingId", m.meeting_date::text AS date, m.title, m.state,
              roster.contact_id AS "contactId", roster.first_name AS "firstName", roster.last_name AS "lastName", roster.status AS attendance
         FROM meetings m JOIN roster ON roster.meeting_id=m.id
        ORDER BY m.meeting_date DESC, m.created_at DESC, m.id, lower(roster.last_name), lower(roster.first_name), roster.contact_id`
    : `SELECT m.id AS "meetingId", m.meeting_date::text AS date, m.title, m.state,
              count(roster.contact_id)::int AS "rosterCount",
              count(*) FILTER (WHERE roster.status='present')::int AS present,
              count(*) FILTER (WHERE roster.status='absent')::int AS absent,
              count(*) FILTER (WHERE roster.status='excused')::int AS excused
         FROM meetings m ${join} roster ON roster.meeting_id=m.id
        GROUP BY m.id,m.meeting_date,m.title,m.state,m.created_at
        ORDER BY m.meeting_date DESC,m.created_at DESC,m.id`;
  const result = await pool.query<Record<string, unknown>>(
    `WITH scheduled AS (
       SELECT m.id,m.title,m.meeting_date,m.created_at,
         CASE WHEN m.attendance_completed_at IS NOT NULL THEN 'completed'
              WHEN m.meeting_date > (current_timestamp AT TIME ZONE COALESCE(zone.name, 'UTC'))::date THEN 'upcoming'
              ELSE 'open' END AS state
         FROM group_meetings m JOIN departments site ON site.id=m.department_id
         LEFT JOIN pg_timezone_names zone ON zone.name=site.time_zone
        WHERE m.department_id=$1 AND m.group_id=$2
          AND ($3::date IS NULL OR m.meeting_date >= $3) AND ($4::date IS NULL OR m.meeting_date <= $4)
     ), meetings AS (
       SELECT * FROM scheduled WHERE $5::text IS NULL OR state=$5
     ), roster AS (
       SELECT a.meeting_id,a.contact_id,a.status,c.first_name,c.last_name
         FROM group_meeting_attendance a JOIN meetings m ON m.id=a.meeting_id
         JOIN contacts c ON c.id=a.contact_id AND c.department_id=$1
        WHERE ($6::text IS NULL OR strpos(lower(concat_ws(' ', c.first_name, c.last_name)), lower($6)) > 0)
          AND ($7::uuid IS NULL OR c.id=$7)
     )
     ${selection} LIMIT $8`,
    [departmentId, groupId, query.from ?? null, query.to ?? null, query.state ?? null, member, query.contactId ?? null, maxRows + 1],
  );
  const columns = columnsByKind[kind];
  const truncated = result.rows.length > maxRows;
  reply.header("cache-control", "private, no-store");
  if (!query.format) return { columns, rows: result.rows.slice(0, maxRows), truncated };
  if (truncated) return reply.code(422).send({ error: "The export exceeds 20,000 rows. Narrow the date range or member filter." });

  const headers = columns.map(({ label }) => label);
  const rows = result.rows.map((row) => columns.map(({ key }) => row[key]));
  const file = "group-attendance-" + kind + "." + query.format;
  reply.header("content-disposition", 'attachment; filename="' + file + '"');
  if (query.format === "xlsx") {
    return reply.type("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
      .send(createWorkbook("Report", headers, rows));
  }
  return reply.type("text/csv; charset=utf-8").send(csvDocument(headers, rows));
}
