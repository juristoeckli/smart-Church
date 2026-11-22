import { groupTypeDevelopmentSql, historicalGroupTypeOptionsSql } from "./group-type-development.js";
import { monthlyRecordedFactsSql } from "./monthly-recorded-facts.js";
import { groupAttendanceByRoleSql } from "./group-attendance-by-role.js";
import { firstContactTrendSql } from "./first-contact-trend.js";
import { canManagePeopleFields } from "../people-records/field-privacy.js";
import { exportFormatQuery, sendReportWorkbook, type ExportFormatQuery } from "./xlsx.js";
import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { isServerModuleEnabled, type ModuleServerContext } from "../module-sdk.js";
import type { Pool, PoolClient } from "pg";
import { registerReportDesigner } from "./designer.js";
import { groupGrowthSql, validGroupGrowthRange } from "./group-growth.js";
import { canonicalTimeZone } from "../../calendar-time.js";

type ReportKey = "people-directory" | "people-consent-history" | "people-status-changes" | "people-first-contact-trend" | "upcoming-birthdays" | "upcoming-anniversaries" | "group-summary" | "group-roster" | "group-leaders" | "group-hierarchy" | "group-growth" | "group-type-development" | "group-meeting-attendance" | "group-attendance-by-role" | "group-meeting-feedback" | "group-lifecycle" | "event-attendance" | "event-recorded-facts-monthly" | "event-staffing" | "event-absence-conflicts" | "event-service-plan" | "event-registration-summary" | "event-registration-details" | "check-in-trend" | "visitor-follow-up" | "worship-song-usage" | "resource-bookings" | "resource-utilization" | "finance-account-summary" | "finance-budget-vs-actual" | "finance-donor-giving";
type ReportFilters = { from?: string; to?: string; groupId?: string; groupType?: string; status?: "member" | "visitor"; followUpStatus?: "needed" | "done" | "not_needed"; accountingYear?: number; period?: "month" | "week" };
type ReportRow = Record<string, string | number | boolean | null>;
type SavedReport = { id: string; report_key: ReportKey; name: string; filters: ReportFilters; owner_user_id: string; updated_at: Date | string; share_scope: "private" | "department"; can_edit: boolean; schedule_days: number | null; notify_when_ready: boolean; next_run_at: Date | null; last_run_at: Date | null; last_run_status: string | null; run_history: { ranAt: string; status: string }[] };

const catalog = [
  { key: "people-directory" as const, title: "People directory", description: "Contact list with status and contact details.", permission: "people" as const },
  { key: "people-consent-history" as const, title: "People consent history", description: "Consent purpose, status, capture date, expiry, and actor; private notes are excluded.", permission: "people" as const },
  { key: "people-status-changes" as const, title: "People status changes", description: "Audited member/visitor status changes recorded through People Records.", permission: "people" as const },
  { key: "people-first-contact-trend" as const, title: "First contacts by month", description: "First-contact dates recorded for active People profiles, including months with zero first contacts.", permission: "people" as const },
  { key: "upcoming-birthdays" as const, title: "Upcoming birthdays", description: "People with birthdays in the next 30 days.", permission: "people" as const },
  { key: "upcoming-anniversaries" as const, title: "Upcoming wedding anniversaries", description: "People with wedding anniversaries in the next 30 days.", permission: "people" as const },
  { key: "group-summary" as const, title: "Group summary", description: "Group membership counts by active, paused and waitlist status.", permission: "groups" as const },
  { key: "group-roster" as const, title: "Group roster", description: "Members, roles and membership dates for one group.", permission: "groups" as const },
  { key: "group-leaders" as const, title: "Group leaders", description: "Current active leaders, co-leaders, owners, and managers for active groups.", permission: "groups" as const },
  { key: "group-hierarchy" as const, title: "Group hierarchy", description: "Active groups with parent and child group names, lifecycle status, and date range.", permission: "groups" as const },
  { key: "group-growth" as const, title: "Group membership growth", description: "Net active membership gains and losses recorded by week or month.", permission: "groups" as const },
  { key: "group-type-development" as const, title: "Group development by type", description: "Net active membership gains and losses by historically recorded group type, grouped by month or week.", permission: "groups" as const },
  { key: "group-meeting-attendance" as const, title: "Group meeting attendance", description: "Present, absent and excused totals by group meeting.", permission: "groups" as const },
  { key: "group-attendance-by-role" as const, title: "Monthly group attendance by role", description: "Attendance records by month and historically recorded role. Ambiguous or uncovered roles appear under Unknown.", permission: "groups" as const },
  { key: "group-meeting-feedback" as const, title: "Group meeting feedback", description: "Leader and attendee answers by group meeting; respondent identities are omitted.", permission: "groups" as const },
  { key: "group-lifecycle" as const, title: "Group lifecycle history", description: "Group creation, edits, and deletion history with prior and updated names, descriptions, and parent links.", permission: "groups" as const },
  { key: "event-attendance" as const, title: "Event attendance", description: "Event dates, adult and child totals, and recorded check-ins.", permission: "events" as const },
  { key: "event-recorded-facts-monthly" as const, title: "Monthly recorded event facts", description: "Visitor counts, collections by currency, and custom fact totals from non-cancelled events.", permission: "events" as const },
  { key: "event-staffing" as const, title: "Event staffing", description: "Volunteer assignments and outstanding responses by service and role.", permission: "events" as const },
  { key: "event-absence-conflicts" as const, title: "Event absence conflicts", description: "Assigned roles that overlap recorded volunteer absences.", permission: "events" as const },
  { key: "event-service-plan" as const, title: "Event service plan", description: "Ordered service-plan items, timing, song links, and role categories.", permission: "events" as const },
  { key: "event-registration-summary" as const, title: "Event registration summary", description: "Registered, waitlisted, cancelled and checked-in counts against capacity.", permission: "events" as const },
  { key: "event-registration-details" as const, title: "Event registration list", description: "Registrants, status and check-in details; requires private People access.", permission: "events" as const },
  { key: "check-in-trend" as const, title: "Check-in trend", description: "Daily check-in and first-time visitor totals.", permission: "events" as const },
  { key: "visitor-follow-up" as const, title: "Visitor follow-up", description: "First-time visitors and their follow-up state.", permission: "events" as const },
  { key: "worship-song-usage" as const, title: "Worship song usage", description: "Songs used in service plans and the latest use date.", permission: "events" as const },
  { key: "resource-bookings" as const, title: "Resource bookings", description: "Booking volume and status by resource.", permission: "resources" as const },
  { key: "resource-utilization" as const, title: "Resource utilization", description: "Monthly approved/requested booking hours and booking status by resource.", permission: "resources" as const },
  { key: "finance-account-summary" as const, title: "Finance account summary", description: "Posted debit and credit totals by account and year.", permission: "finance" as const },
  { key: "finance-budget-vs-actual" as const, title: "Finance budget vs actual", description: "Budget amounts alongside posted debit and credit totals for the same account/cost-center scope.", permission: "finance" as const },
  { key: "finance-donor-giving" as const, title: "Donor giving totals", description: "Posted donation credits, reversals, net giving, gift count, and latest gift by donor.", permission: "finance" as const },
];
const uuid = { type: "string", format: "uuid" };

type ReportAccess = Pick<FastifyRequest, "activeDepartmentRole" | "activeDepartmentPermissions" | "activeDepartmentModulePermissions">;

function canModule(request: ReportAccess, grant: "view" | "manage") {
  const grants = request.activeDepartmentModulePermissions?.reports ?? [];
  return request.activeDepartmentRole === "site_admin" || grants.includes("manage") || (grant === "view" && grants.includes("view"));
}
function hasPermission(request: ReportAccess, permission: "people" | "groups" | "events" | "finance" | "resources") {
  if (request.activeDepartmentRole === "site_admin") return true;
  const location = request.activeDepartmentPermissions ?? [];
  if (permission === "people") return location.includes("people_view_private") || location.includes("people_manage");
  if (permission === "groups") return location.includes("groups_manage");
  if (permission === "events") return location.includes("events_manage");
  if (permission === "resources") return location.includes("resources_manage") || (isServerModuleEnabled("resource-scheduler") && (request.activeDepartmentModulePermissions?.["resource-scheduler"] ?? []).includes("manage"));
  const finance = request.activeDepartmentModulePermissions?.finance ?? [];
  return finance.includes("view") || finance.includes("manage");
}
function cleanText(value: unknown, limit: number) {
  return typeof value === "string" ? value.trim().replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").slice(0, limit) : "";
}
function validDate(value: unknown) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value + "T00:00:00Z"));
}
function normalizeFilters(input: unknown): ReportFilters | string {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const value = input as Record<string, unknown>;
  for (const key of Object.keys(value)) if (!["from", "to", "groupId", "groupType", "status", "followUpStatus", "accountingYear", "period"].includes(key)) return "This report includes an unsupported filter.";
  const filters: ReportFilters = {};
  if (value.from !== undefined) { if (!validDate(value.from)) return "Choose a valid start date."; filters.from = String(value.from); }
  if (value.to !== undefined) { if (!validDate(value.to)) return "Choose a valid end date."; filters.to = String(value.to); }
  if (filters.from && filters.to && filters.from > filters.to) return "The start date must be before the end date.";
  if (value.groupId !== undefined && value.groupId !== "") {
    if (typeof value.groupId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.groupId)) return "Choose a valid group.";
    filters.groupId = value.groupId;
  }
  if (value.groupType !== undefined && value.groupType !== "") {
    if (typeof value.groupType !== "string" || value.groupType.length>85 || /[\u0000-\u001f\u007f]/.test(value.groupType)
      || (!["unknown","untyped"].includes(value.groupType) && (!value.groupType.startsWith("name:") || !value.groupType.slice(5).trim()))) {
      return "Choose a valid group type.";
    }
    filters.groupType = value.groupType.startsWith("name:") ? "name:" + value.groupType.slice(5).trim() : value.groupType;
  }
  if (value.status !== undefined) { if (value.status !== "member" && value.status !== "visitor") return "Choose a valid people status."; filters.status = value.status; }
  if (value.followUpStatus !== undefined) { if (!["needed", "done", "not_needed"].includes(String(value.followUpStatus))) return "Choose a valid follow-up status."; filters.followUpStatus = value.followUpStatus as ReportFilters["followUpStatus"]; }
  if (value.accountingYear !== undefined && value.accountingYear !== "") {
    const year = typeof value.accountingYear === "number" ? value.accountingYear : Number(value.accountingYear);
    if (!Number.isInteger(year) || year < 1900 || year > 2200) return "Choose a valid accounting year.";
    filters.accountingYear = year;
  }
  if (value.period !== undefined) {
    if (value.period !== "month" && value.period !== "week") return "Choose weekly or monthly grouping.";
    filters.period = value.period;
  }
  return filters;
}
function filterError(value: ReportFilters | string): value is string { return typeof value === "string"; }
function denied(reply: { code: (status: number) => { send: (body: object) => unknown } }) { return reply.code(403).send({ error: "You do not have access to this report." }); }
function available(request: ReportAccess, key: ReportKey) {
  const definition = catalog.find((item) => item.key === key);
  const absenceManager = request.activeDepartmentRole === "site_admin"
    || (request.activeDepartmentPermissions ?? []).includes("events_manage")
    || (request.activeDepartmentModulePermissions?.["event-absences"] ?? []).includes("manage");
  return Boolean(definition && canModule(request, "view") && hasPermission(request, definition.permission)
    && (key !== "visitor-follow-up" || hasPermission(request, "people"))
    && (key !== "event-registration-details" || hasPermission(request, "people"))
    && (key !== "event-absence-conflicts" || absenceManager));
}

export function registerModuleRoutes(app: FastifyInstance, context: ModuleServerContext) {
  const { pool, isDatabaseReady, resolveDepartmentId, validateMutation } = context;
  async function department(request: FastifyRequest, reply: FastifyReply) {
    if (!pool || !isDatabaseReady()) { reply.code(503).send({ error: "Reports are unavailable because the database is not ready." }); return null; }
    const id = await resolveDepartmentId(request, reply);
    if (!id) return null;
    if (!canModule(request, "view")) { reply.code(403).send({ error: "Reports view access is required." }); return null; }
    return id;
  }
  async function installedReports(departmentId: string, request: ReportAccess, db: Pool | PoolClient = pool!) {
    const present = await db.query<{ finance: boolean; financeBudgets: boolean; financeDonors: boolean; peopleConsents: boolean; peopleHistory: boolean; groupAttendance: boolean; groupFeedback: boolean; groupLifecycle: boolean; groupHierarchy: boolean; eventServicePlan: boolean; monthlyFacts: boolean; eventRegistrations: boolean; worship: boolean; resources: boolean; personDates: boolean; peopleFields: boolean; absenceConflicts: boolean }>(
      `SELECT to_regclass('public.finance_transactions') IS NOT NULL AS finance,
              to_regclass('public.finance_budgets') IS NOT NULL AS "financeBudgets",
              to_regclass('public.finance_donors') IS NOT NULL AS "financeDonors",
              to_regclass('public.people_record_consents') IS NOT NULL AS "peopleConsents",
              to_regclass('public.people_record_history') IS NOT NULL AS "peopleHistory",
              to_regclass('public.group_meetings') IS NOT NULL AND to_regclass('public.group_meeting_attendance') IS NOT NULL AS "groupAttendance",
              to_regclass('public.group_meetings') IS NOT NULL AND to_regclass('public.group_meeting_feedback_templates') IS NOT NULL AND to_regclass('public.group_meeting_feedback_responses') IS NOT NULL AND to_regclass('public.group_meeting_feedback_attendee_submissions') IS NOT NULL AS "groupFeedback",
              to_regclass('public.group_hierarchy_history') IS NOT NULL AS "groupLifecycle",
              (SELECT count(*)=4 FROM information_schema.columns WHERE table_schema='public' AND table_name='church_groups' AND column_name=ANY(ARRAY['parent_group_id','status','starts_on','ends_on'])) AS "groupHierarchy",
              to_regclass('public.service_events') IS NOT NULL AND to_regclass('public.worship_songs') IS NOT NULL AS "eventServicePlan",
              to_regclass('public.service_event_fact_definitions') IS NOT NULL
                AND (SELECT count(*)=2 FROM information_schema.columns WHERE table_schema='public'
                  AND table_name='service_events' AND column_name=ANY(ARRAY['recorded_facts','cancelled_at'])) AS "monthlyFacts",
              to_regclass('public.service_events') IS NOT NULL AND to_regclass('public.event_registrations') IS NOT NULL AS "eventRegistrations",
              to_regclass('public.worship_songs') IS NOT NULL AND to_regclass('public.service_events') IS NOT NULL AS worship,
              to_regclass('public.bookable_resources') IS NOT NULL AND to_regclass('public.resource_bookings') IS NOT NULL AS resources,
              to_regclass('public.people_record_person_dates') IS NOT NULL AS "personDates",
              to_regclass('public.people_record_values') IS NOT NULL AND EXISTS (
                SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='people_record_fields' AND column_name='visibility'
              ) AS "peopleFields",
              to_regclass('public.event_person_absences') IS NOT NULL AND to_regclass('public.service_events') IS NOT NULL AND to_regclass('public.event_position_responses') IS NOT NULL AS "absenceConflicts"`,
    );
    const state = present.rows[0];
    const firstContactField = state.peopleFields && available(request,"people-first-contact-trend")
      && (await db.query(`SELECT id FROM people_record_fields
        WHERE department_id=$1 AND field_key='first_contact_date' AND field_type='date' AND active
          AND ($2::boolean OR visibility='private_people')`, [departmentId,canManagePeopleFields(request)])).rows.length > 0;
    return catalog.filter((item) => available(request, item.key)
      && (item.permission !== "finance" || state.finance)
      && (item.key !== "people-consent-history" || state.peopleConsents)
      && (item.key !== "people-status-changes" || state.peopleHistory)
      && (item.key !== "people-first-contact-trend" || firstContactField)
      && (item.key !== "finance-budget-vs-actual" || (state.finance && state.financeBudgets))
      && (item.key !== "finance-donor-giving" || (state.finance && state.financeDonors))
      && (item.key !== "group-meeting-attendance" || state.groupAttendance)
      && (item.key !== "group-attendance-by-role" || (state.groupAttendance && state.groupLifecycle))
      && (item.key !== "group-meeting-feedback" || state.groupFeedback)
      && (!["group-lifecycle", "group-growth", "group-type-development"].includes(item.key) || state.groupLifecycle)
      && (item.key !== "group-hierarchy" || state.groupHierarchy)
      && (item.key !== "event-service-plan" || state.eventServicePlan)
      && (item.key !== "event-recorded-facts-monthly" || state.monthlyFacts)
      && (!item.key.startsWith("event-registration-") || state.eventRegistrations)
      && (item.key !== "worship-song-usage" || state.worship)
      && (!item.key.startsWith("upcoming-") || state.personDates)
      && (item.key !== "event-absence-conflicts" || state.absenceConflicts)
      && (item.key !== "resource-bookings" || state.resources)
      && (item.key !== "resource-utilization" || state.resources));
  }
  async function runReport(departmentId: string, reportKey: ReportKey, filters: ReportFilters, access: ReportAccess, db: Pool | PoolClient = pool!) {
    let columns: Array<{ key: string; label: string }>;
    let rows: ReportRow[];
    if (reportKey === "people-directory") {
      columns = [{ key: "firstName", label: "First name" }, { key: "lastName", label: "Last name" }, { key: "email", label: "Email" }, { key: "phone", label: "Phone" }, { key: "status", label: "Status" }, { key: "createdAt", label: "Created" }];
      const result = await db.query("SELECT first_name AS \"firstName\",last_name AS \"lastName\",COALESCE(email,'') AS email,COALESCE(phone,'') AS phone,status,created_at::date::text AS \"createdAt\" FROM contacts WHERE department_id=$1 AND ($2::text IS NULL OR status=$2) AND ($3::date IS NULL OR created_at::date >= $3::date) AND ($4::date IS NULL OR created_at::date <= $4::date) ORDER BY last_name,first_name LIMIT 5000", [departmentId, filters.status ?? null, filters.from ?? null, filters.to ?? null]);
      rows = result.rows;
    } else if (reportKey === "people-consent-history") {
      columns = [{ key: "person", label: "Person" }, { key: "purpose", label: "Purpose" }, { key: "status", label: "Consent status" }, { key: "capturedAt", label: "Captured" }, { key: "expiresAt", label: "Expires" }, { key: "actor", label: "Recorded by" }];
      const result = await db.query(
        `SELECT concat_ws(' ',contact.first_name,contact.last_name) AS person,consent.purpose,consent.status,
                consent.captured_at::text AS "capturedAt",consent.expires_at::text AS "expiresAt",
                COALESCE(actor.display_name,'System or imported update') AS actor
           FROM people_record_consents consent
           JOIN contacts contact ON contact.id=consent.contact_id AND contact.department_id=consent.department_id
           LEFT JOIN app_users actor ON actor.id=consent.actor_user_id
          WHERE consent.department_id=$1 AND ($2::date IS NULL OR consent.captured_at::date >= $2::date) AND ($3::date IS NULL OR consent.captured_at::date <= $3::date)
          ORDER BY consent.captured_at DESC,contact.last_name,contact.first_name,consent.purpose LIMIT 5000`,
        [departmentId, filters.from ?? null, filters.to ?? null],
      );
      rows = result.rows.map((row) => ({ ...row, capturedAt: row.capturedAt instanceof Date ? row.capturedAt.toISOString() : String(row.capturedAt ?? "") }));
    } else if (reportKey === "people-status-changes") {
      columns = [{ key: "changedAt", label: "Changed" }, { key: "person", label: "Person" }, { key: "previousStatus", label: "Previous status" }, { key: "newStatus", label: "New status" }, { key: "actor", label: "Changed by" }];
      const result = await db.query(
        `SELECT history.created_at::text AS "changedAt",concat_ws(' ',contact.first_name,contact.last_name) AS person,
                history.before_value->>'status' AS "previousStatus",history.after_value->>'status' AS "newStatus",
                COALESCE(actor.display_name,'System or imported update') AS actor
           FROM people_record_history history JOIN contacts contact ON contact.id=history.contact_id AND contact.department_id=history.department_id
           LEFT JOIN app_users actor ON actor.id=history.actor_user_id
          WHERE history.department_id=$1 AND history.action='profile_updated' AND history.subject IN ('contact_profile','bulk_status')
            AND history.before_value->>'status' IS NOT NULL AND history.after_value->>'status' IS NOT NULL
            AND history.before_value->>'status'<>history.after_value->>'status'
            AND ($2::date IS NULL OR history.created_at::date >= $2::date) AND ($3::date IS NULL OR history.created_at::date <= $3::date)
          ORDER BY history.created_at DESC,contact.last_name,contact.first_name LIMIT 5000`,
        [departmentId, filters.from ?? null, filters.to ?? null],
      );
      rows = result.rows;
    } else if (reportKey === "people-first-contact-trend") {
      if (!validGroupGrowthRange(filters.from, filters.to)) throw new Error("Choose a valid date range of up to 731 calendar days.");
      columns = [{ key: "month", label: "Month" }, { key: "firstContacts", label: "First contacts" }];
      const result = await db.query(firstContactTrendSql,[departmentId,filters.from,filters.to,canManagePeopleFields(access)]);
      rows = result.rows;
    } else if (reportKey === "upcoming-birthdays" || reportKey === "upcoming-anniversaries") {
      const kind = reportKey === "upcoming-birthdays" ? "birth_date" : "wedding_anniversary";
      columns = [{ key: "person", label: "Person" }, { key: "nextDate", label: "Next date" }, ...(kind === "wedding_anniversary" ? [{ key: "years", label: "Years married" }] : [])];
      const result = await db.query(
        `WITH base AS (
           SELECT contact.first_name,contact.last_name,dates.date_value,
                  extract(year FROM CURRENT_DATE)::int AS y,
                  extract(month FROM dates.date_value)::int AS m,extract(day FROM dates.date_value)::int AS d
             FROM people_record_person_dates dates JOIN contacts contact ON contact.id=dates.contact_id AND contact.department_id=dates.department_id
            WHERE dates.department_id=$1 AND dates.date_kind=$2
         ), occurrences AS (
           SELECT *,make_date(y,m,least(d,extract(day FROM (make_date(y,m,1)+interval '1 month - 1 day'))::int)) AS this_year,
                    make_date(y+1,m,least(d,extract(day FROM (make_date(y+1,m,1)+interval '1 month - 1 day'))::int)) AS next_year FROM base
         ), upcoming AS (
           SELECT *,CASE WHEN this_year < CURRENT_DATE THEN next_year ELSE this_year END AS next_date FROM occurrences
         ) SELECT concat_ws(' ',first_name,last_name) AS person,next_date::text AS "nextDate",
                  CASE WHEN $2='wedding_anniversary' THEN extract(year FROM age(next_date,date_value))::int END AS years
             FROM upcoming WHERE next_date BETWEEN CURRENT_DATE AND CURRENT_DATE+30
            ORDER BY next_date,last_name,first_name LIMIT 2000`,
        [departmentId, kind],
      );
      rows = result.rows;
    } else if (reportKey === "group-summary") {
      columns = [{ key: "groupName", label: "Group" }, { key: "memberCount", label: "Members" }, { key: "activeCount", label: "Active" }, { key: "pausedCount", label: "Paused" }, { key: "waitlistCount", label: "Waitlist" }];
      const result = await db.query("SELECT church_group.name AS \"groupName\",count(group_member.contact_id) FILTER (WHERE contact.id IS NOT NULL)::int AS \"memberCount\",count(group_member.contact_id) FILTER (WHERE contact.id IS NOT NULL AND group_member.status='active')::int AS \"activeCount\",count(group_member.contact_id) FILTER (WHERE contact.id IS NOT NULL AND group_member.status='paused')::int AS \"pausedCount\",count(group_member.contact_id) FILTER (WHERE contact.id IS NOT NULL AND group_member.status='waitlist')::int AS \"waitlistCount\" FROM church_groups church_group LEFT JOIN group_members group_member ON group_member.group_id=church_group.id LEFT JOIN contacts contact ON contact.id=group_member.contact_id AND contact.department_id=church_group.department_id WHERE church_group.department_id=$1 GROUP BY church_group.id,church_group.name ORDER BY church_group.name LIMIT 2000", [departmentId]);
      rows = result.rows;
    } else if (reportKey === "group-roster") {
      if (!filters.groupId) throw new Error("Choose a group to run this report.");
      columns = [{ key: "firstName", label: "First name" }, { key: "lastName", label: "Last name" }, { key: "role", label: "Role" }, { key: "status", label: "Membership status" }, { key: "joinedOn", label: "Joined on" }, { key: "email", label: "Email" }, { key: "phone", label: "Phone" }];
      const result = await db.query("SELECT contact.first_name AS \"firstName\",contact.last_name AS \"lastName\",group_member.role,group_member.status,group_member.joined_on::text AS \"joinedOn\",COALESCE(contact.email,'') AS email,COALESCE(contact.phone,'') AS phone FROM group_members group_member JOIN contacts contact ON contact.id=group_member.contact_id JOIN church_groups church_group ON church_group.id=group_member.group_id WHERE church_group.department_id=$1 AND church_group.id=$2 AND contact.department_id=$1 ORDER BY contact.last_name,contact.first_name LIMIT 5000", [departmentId, filters.groupId]);
      rows = result.rows;
    } else if (reportKey === "group-leaders") {
      columns = [{ key: "groupName", label: "Group" }, { key: "firstName", label: "First name" }, { key: "lastName", label: "Last name" }, { key: "role", label: "Role" }, { key: "joinedOn", label: "Membership start" }];
      const result = await db.query(
        `SELECT church_group.name AS "groupName",contact.first_name AS "firstName",contact.last_name AS "lastName",group_member.role,group_member.joined_on::text AS "joinedOn"
           FROM church_groups church_group
           JOIN group_members group_member ON group_member.group_id=church_group.id AND group_member.status='active'
           JOIN contacts contact ON contact.id=group_member.contact_id AND contact.department_id=church_group.department_id
          WHERE church_group.department_id=$1 AND church_group.status='active'
            AND ($2::uuid IS NULL OR church_group.id=$2)
            AND regexp_replace(lower(group_member.role),'[^a-z]','','g') IN ('leader','coleader','groupowner','groupmanager')
          ORDER BY church_group.name,regexp_replace(lower(group_member.role),'[^a-z]','','g'),contact.last_name,contact.first_name
          LIMIT 5000`,
        [departmentId, filters.groupId ?? null],
      );
      rows = result.rows;
    } else if (reportKey === "group-hierarchy") {
      columns = [{ key: "groupName", label: "Group" }, { key: "parentGroupName", label: "Parent group" }, { key: "childGroupNames", label: "Active child groups" }, { key: "status", label: "Status" }, { key: "startsOn", label: "Starts on" }, { key: "endsOn", label: "Ends on" }];
      const result = await db.query(
        `SELECT church_group.name AS "groupName",parent.name AS "parentGroupName",
                COALESCE(string_agg(child.name,', ' ORDER BY child.name),'') AS "childGroupNames",
                church_group.status,church_group.starts_on::text AS "startsOn",church_group.ends_on::text AS "endsOn"
           FROM church_groups church_group
           LEFT JOIN church_groups parent ON parent.id=church_group.parent_group_id AND parent.department_id=church_group.department_id
           LEFT JOIN church_groups child ON child.parent_group_id=church_group.id AND child.department_id=church_group.department_id AND child.status='active'
          WHERE church_group.department_id=$1 AND church_group.status='active'
            AND ($2::uuid IS NULL OR church_group.id=$2)
          GROUP BY church_group.id,parent.name
          ORDER BY church_group.name LIMIT 5000`,
        [departmentId, filters.groupId ?? null],
      );
      rows = result.rows;
    } else if (reportKey === "group-growth") {
      if (!validGroupGrowthRange(filters.from, filters.to)) throw new Error("Choose a valid date range of up to 731 calendar days.");
      const location = await db.query<{ time_zone: string | null }>("SELECT time_zone FROM departments WHERE id=$1", [departmentId]);
      const timeZone = canonicalTimeZone(location.rows[0]?.time_zone) ?? "UTC";
      columns = [
        { key: "periodStart", label: "Period starts" }, { key: "groupName", label: "Group" }, { key: "groupType", label: "Current group type" },
        { key: "gains", label: "Active gains" }, { key: "losses", label: "Active losses" }, { key: "net", label: "Net change" },
      ];
      const result = await db.query(groupGrowthSql, [departmentId, filters.groupId ?? null, filters.from, filters.to, filters.period ?? "month", timeZone]);
      rows = result.rows;
    } else if (reportKey === "group-type-development") {
      if (!validGroupGrowthRange(filters.from, filters.to)) throw new Error("Choose a valid date range of up to 731 calendar days.");
      const location = await db.query<{ time_zone: string | null }>("SELECT time_zone FROM departments WHERE id=$1", [departmentId]);
      const timeZone = canonicalTimeZone(location.rows[0]?.time_zone) ?? "UTC";
      columns = [
        { key: "periodStart", label: "Period starts" }, { key: "groupType", label: "Group type at time of change" },
        { key: "typeStatus", label: "Type evidence" }, { key: "gains", label: "Active gains" },
        { key: "losses", label: "Active losses" }, { key: "net", label: "Net change" },
      ];
      const result = await db.query(groupTypeDevelopmentSql,[departmentId,filters.from,filters.to,filters.period ?? "month",timeZone,filters.groupType ?? null]);
      if (result.rows.length > 5000) throw new Error("Choose a narrower date range or one group type to report at most 5,000 rows.");
      rows = result.rows;
    } else if (reportKey === "group-meeting-attendance") {
      columns = [{ key: "meetingDate", label: "Meeting date" }, { key: "groupName", label: "Group" }, { key: "meetingTitle", label: "Meeting" }, { key: "present", label: "Present" }, { key: "absent", label: "Absent" }, { key: "excused", label: "Excused" }];
      const result = await db.query(
        `SELECT meeting.meeting_date::text AS "meetingDate",church_group.name AS "groupName",meeting.title AS "meetingTitle",
                count(attendance.contact_id) FILTER (WHERE attendance.status='present')::int AS present,
                count(attendance.contact_id) FILTER (WHERE attendance.status='absent')::int AS absent,
                count(attendance.contact_id) FILTER (WHERE attendance.status='excused')::int AS excused
           FROM group_meetings meeting JOIN church_groups church_group ON church_group.id=meeting.group_id AND church_group.department_id=meeting.department_id
           LEFT JOIN group_meeting_attendance attendance ON attendance.meeting_id=meeting.id
           LEFT JOIN contacts contact ON contact.id=attendance.contact_id AND contact.department_id=meeting.department_id
          WHERE meeting.department_id=$1 AND ($2::date IS NULL OR meeting.meeting_date >= $2::date) AND ($3::date IS NULL OR meeting.meeting_date <= $3::date)
            AND ($4::uuid IS NULL OR meeting.group_id=$4) AND (attendance.contact_id IS NULL OR contact.id IS NOT NULL)
          GROUP BY meeting.id,church_group.name ORDER BY meeting.meeting_date DESC,church_group.name LIMIT 5000`,
        [departmentId, filters.from ?? null, filters.to ?? null, filters.groupId ?? null],
      );
      rows = result.rows;
    } else if (reportKey === "group-attendance-by-role") {
      if (!validGroupGrowthRange(filters.from, filters.to)) throw new Error("Choose a valid date range of up to 731 calendar days.");
      const location = await db.query<{ time_zone: string | null }>("SELECT time_zone FROM departments WHERE id=$1", [departmentId]);
      const timeZone = canonicalTimeZone(location.rows[0]?.time_zone) ?? "UTC";
      columns = [{ key: "month", label: "Month" }, { key: "role", label: "Role" }, { key: "present", label: "Present" },
        { key: "absent", label: "Absent" }, { key: "excused", label: "Excused" }];
      const result = await db.query(groupAttendanceByRoleSql,[departmentId, filters.groupId ?? null, filters.from, filters.to, timeZone]);
      rows = result.rows;
    } else if (reportKey === "group-meeting-feedback") {
      columns = [{ key: "meetingDate", label: "Meeting date" }, { key: "groupName", label: "Group" }, { key: "meetingTitle", label: "Meeting" }, { key: "formTitle", label: "Feedback form" }, { key: "responseType", label: "Response type" }, { key: "question", label: "Question" }, { key: "answer", label: "Answer" }, { key: "submittedAt", label: "Submitted" }];
      const result = await db.query(
        `WITH feedback_rows AS (
           SELECT feedback.department_id,feedback.group_id,feedback.meeting_id,feedback.answers,'Leader'::text AS response_type,feedback.updated_at AS submitted_at
             FROM group_meeting_feedback_responses feedback WHERE feedback.department_id=$1
           UNION ALL
           SELECT submission.department_id,submission.group_id,submission.meeting_id,submission.answers,'Attendee'::text AS response_type,
                  CASE WHEN submission.contact_id IS NULL THEN NULL ELSE submission.updated_at END AS submitted_at
             FROM group_meeting_feedback_attendee_submissions submission WHERE submission.department_id=$1
         )
         SELECT meeting.meeting_date::text AS "meetingDate",church_group.name AS "groupName",meeting.title AS "meetingTitle",template.title AS "formTitle",
                feedback.response_type AS "responseType",COALESCE(prompt.prompt,'Removed or renamed question') AS question,answer.answer_text AS answer,
                feedback.submitted_at::text AS "submittedAt"
           FROM feedback_rows feedback
           JOIN group_meetings meeting ON meeting.id=feedback.meeting_id AND meeting.department_id=feedback.department_id AND meeting.group_id=feedback.group_id
           JOIN church_groups church_group ON church_group.id=meeting.group_id AND church_group.department_id=meeting.department_id
           JOIN group_meeting_feedback_templates template ON template.department_id=feedback.department_id AND template.group_id=feedback.group_id
           CROSS JOIN LATERAL jsonb_each_text(feedback.answers) AS answer(question_id,answer_text)
           LEFT JOIN LATERAL (
             SELECT question.value->>'prompt' AS prompt,question.ordinality AS question_order
               FROM jsonb_array_elements(template.questions) WITH ORDINALITY AS question(value,ordinality)
              WHERE question.value->>'id'=answer.question_id LIMIT 1
           ) prompt ON TRUE
          WHERE feedback.department_id=$1 AND ($2::date IS NULL OR meeting.meeting_date >= $2::date) AND ($3::date IS NULL OR meeting.meeting_date <= $3::date)
            AND ($4::uuid IS NULL OR feedback.group_id=$4)
          ORDER BY meeting.meeting_date DESC,church_group.name,meeting.created_at DESC,prompt.question_order,feedback.response_type LIMIT 10000`,
        [departmentId, filters.from ?? null, filters.to ?? null, filters.groupId ?? null],
      );
      rows = result.rows;
    } else if (reportKey === "group-lifecycle") {
      columns = [{ key: "changedAt", label: "Changed" }, { key: "action", label: "Action" }, { key: "group", label: "Group" }, { key: "beforeName", label: "Previous name" }, { key: "afterName", label: "Updated name" }, { key: "beforeDescription", label: "Previous description" }, { key: "afterDescription", label: "Updated description" }, { key: "beforeParentId", label: "Previous parent group ID" }, { key: "afterParentId", label: "Updated parent group ID" }, { key: "actor", label: "Changed by" }];
      const result = await db.query(
        `SELECT history.created_at::text AS "changedAt",history.action,
                COALESCE(history.after_data->>'name',history.before_data->>'name') AS "group",
                history.before_data->>'name' AS "beforeName",history.after_data->>'name' AS "afterName",
                history.before_data->>'description' AS "beforeDescription",history.after_data->>'description' AS "afterDescription",
                history.before_data->>'parent_group_id' AS "beforeParentId",history.after_data->>'parent_group_id' AS "afterParentId",
                COALESCE(actor.display_name,'System or imported update') AS actor
           FROM group_hierarchy_history history LEFT JOIN app_users actor ON actor.id=history.actor_user_id
          WHERE history.department_id=$1 AND history.entity_kind='group'
            AND ($2::date IS NULL OR history.created_at::date >= $2::date) AND ($3::date IS NULL OR history.created_at::date <= $3::date)
          ORDER BY history.created_at DESC,history.id DESC LIMIT 5000`,
        [departmentId, filters.from ?? null, filters.to ?? null],
      );
      rows = result.rows;
    } else if (reportKey === "event-attendance") {
      columns = [{ key: "eventDate", label: "Date" }, { key: "title", label: "Event" }, { key: "kind", label: "Type" }, { key: "location", label: "Location" }, { key: "adults", label: "Adults" }, { key: "children", label: "Children" }, { key: "checkedIn", label: "Individual check-ins" }, { key: "firstTimeVisitors", label: "First-time visitors" }];
      const result = await db.query("SELECT event.event_date::text AS \"eventDate\",event.title,event.kind,event.location,event.attendance_adults AS adults,event.attendance_children AS children,count(contact.id)::int AS \"checkedIn\",count(contact.id) FILTER (WHERE checkin.first_time_visitor)::int AS \"firstTimeVisitors\" FROM service_events event LEFT JOIN event_attendance_checkins checkin ON checkin.event_id=event.id LEFT JOIN contacts contact ON contact.id=checkin.contact_id AND contact.department_id=event.department_id WHERE event.department_id=$1 AND ($2::date IS NULL OR event.event_date >= $2::date) AND ($3::date IS NULL OR event.event_date <= $3::date) GROUP BY event.id ORDER BY event.event_date DESC,event.start_time DESC LIMIT 2000", [departmentId, filters.from ?? null, filters.to ?? null]);
      rows = result.rows;
    } else if (reportKey === "event-recorded-facts-monthly") {
      if (!validGroupGrowthRange(filters.from, filters.to)) throw new Error("Choose a valid date range of up to 731 calendar days.");
      columns = [{ key: "month", label: "Month" }, { key: "label", label: "Fact" }, { key: "source", label: "Source" },
        { key: "choice", label: "Choice" }, { key: "unit", label: "Unit or currency" }, { key: "total", label: "Total" },
        { key: "samples", label: "Events with a recorded value" }];
      const result = await db.query(monthlyRecordedFactsSql,[departmentId,filters.from,filters.to]);
      if (result.rows.length > 5000) throw new Error("Choose a shorter date range to report at most 5,000 fact rows.");
      rows = result.rows;
    } else if (reportKey === "check-in-trend") {
      columns = [{ key: "eventDate", label: "Date" }, { key: "eventCount", label: "Events" }, { key: "checkIns", label: "Check-ins" }, { key: "firstTimeVisitors", label: "First-time visitors" }];
      const result = await db.query(
        `SELECT event.event_date::text AS "eventDate",count(DISTINCT event.id)::int AS "eventCount",count(checkin.contact_id)::int AS "checkIns",
                count(checkin.contact_id) FILTER (WHERE checkin.first_time_visitor)::int AS "firstTimeVisitors"
           FROM service_events event LEFT JOIN event_attendance_checkins checkin ON checkin.event_id=event.id
           LEFT JOIN contacts contact ON contact.id=checkin.contact_id AND contact.department_id=event.department_id
          WHERE event.department_id=$1 AND ($2::date IS NULL OR event.event_date >= $2::date) AND ($3::date IS NULL OR event.event_date <= $3::date)
            AND (checkin.contact_id IS NULL OR contact.id IS NOT NULL)
          GROUP BY event.event_date ORDER BY event.event_date DESC LIMIT 2000`,
        [departmentId, filters.from ?? null, filters.to ?? null],
      );
      rows = result.rows;
    } else if (reportKey === "event-staffing") {
      columns = [{ key: "eventDate", label: "Date" }, { key: "eventTitle", label: "Event" }, { key: "role", label: "Role" }, { key: "person", label: "Assigned person" }, { key: "response", label: "Response" }];
      const result = await db.query(
        `SELECT event.event_date::text AS "eventDate",event.title AS "eventTitle",position.value->>'name' AS role,
                concat_ws(' ',contact.first_name,contact.last_name) AS person,
                CASE COALESCE(response.status,'pending') WHEN 'accepted' THEN 'confirmed' WHEN 'declined' THEN 'declined' ELSE 'requested' END AS response
           FROM service_events event
           CROSS JOIN LATERAL jsonb_array_elements(event.positions) WITH ORDINALITY AS position(value,position_number)
           LEFT JOIN contacts contact ON contact.id=NULLIF(position.value->>'contactId','')::uuid AND contact.department_id=event.department_id
           LEFT JOIN event_position_responses response ON response.event_id=event.id AND response.position_index=(position.position_number-1)::int
          WHERE event.department_id=$1 AND ($2::date IS NULL OR event.event_date >= $2::date) AND ($3::date IS NULL OR event.event_date <= $3::date)
          ORDER BY event.event_date DESC,event.start_time DESC,position.position_number LIMIT 10000`,
        [departmentId, filters.from ?? null, filters.to ?? null],
      );
      rows = result.rows;
    } else if (reportKey === "event-service-plan") {
      columns = [{ key: "eventDate", label: "Date" }, { key: "eventTitle", label: "Event" }, { key: "location", label: "Location" }, { key: "itemNumber", label: "Order" }, { key: "startTime", label: "Start time" }, { key: "durationMinutes", label: "Duration (minutes)" }, { key: "itemTitle", label: "Plan item" }, { key: "songTitle", label: "Song" }, { key: "position", label: "Role category" }, { key: "notes", label: "Notes" }];
      const result = await db.query(
        `SELECT event.event_date::text AS "eventDate",event.title AS "eventTitle",event.location,
                plan.position_number::int AS "itemNumber",COALESCE(plan.value->>'startTime','') AS "startTime",
                CASE WHEN plan.value->>'durationMinutes' ~ '^[0-9]{1,4}$' THEN (plan.value->>'durationMinutes')::int END AS "durationMinutes",plan.value->>'title' AS "itemTitle",
                COALESCE(song.title,plan.value->>'title') AS "songTitle",COALESCE(plan.value->>'position','') AS position,
                COALESCE(plan.value->>'notes','') AS notes
           FROM service_events event
           CROSS JOIN LATERAL jsonb_array_elements(COALESCE(event.time_plan,'[]'::jsonb)) WITH ORDINALITY AS plan(value,position_number)
           LEFT JOIN worship_songs song ON song.id=CASE WHEN plan.value->>'songId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN (plan.value->>'songId')::uuid ELSE NULL END AND song.department_id=event.department_id
          WHERE event.department_id=$1 AND ($2::date IS NULL OR event.event_date >= $2::date) AND ($3::date IS NULL OR event.event_date <= $3::date)
          ORDER BY event.event_date DESC,event.start_time DESC,event.title,plan.position_number LIMIT 10000`,
        [departmentId, filters.from ?? null, filters.to ?? null],
      );
      rows = result.rows;
    } else if (reportKey === "event-registration-summary") {
      columns = [{ key: "eventDate", label: "Date" }, { key: "eventTitle", label: "Event" }, { key: "capacity", label: "Capacity" }, { key: "registered", label: "Registered" }, { key: "waitlisted", label: "Waitlisted" }, { key: "cancelled", label: "Cancelled" }, { key: "checkedIn", label: "Checked in" }, { key: "remaining", label: "Remaining places" }];
      const result = await db.query(
        `SELECT event.event_date::text AS "eventDate",event.title AS "eventTitle",event.registration_capacity AS capacity,
                count(registration.id) FILTER (WHERE registration.status='registered')::int AS registered,
                count(registration.id) FILTER (WHERE registration.status='waitlisted')::int AS waitlisted,
                count(registration.id) FILTER (WHERE registration.status='cancelled')::int AS cancelled,
                count(registration.id) FILTER (WHERE registration.status='registered' AND registration.checked_in_at IS NOT NULL)::int AS "checkedIn",
                CASE WHEN event.registration_capacity IS NULL THEN NULL ELSE GREATEST(event.registration_capacity-count(registration.id) FILTER (WHERE registration.status='registered'),0)::int END AS remaining
           FROM service_events event LEFT JOIN event_registrations registration ON registration.event_id=event.id
          WHERE event.department_id=$1 AND event.registration_enabled=TRUE AND ($2::date IS NULL OR event.event_date >= $2::date) AND ($3::date IS NULL OR event.event_date <= $3::date)
          GROUP BY event.id ORDER BY event.event_date DESC,event.start_time DESC LIMIT 5000`,
        [departmentId, filters.from ?? null, filters.to ?? null],
      );
      rows = result.rows;
    } else if (reportKey === "event-registration-details") {
      columns = [{ key: "eventDate", label: "Date" }, { key: "eventTitle", label: "Event" }, { key: "firstName", label: "First name" }, { key: "lastName", label: "Last name" }, { key: "email", label: "Email" }, { key: "status", label: "Registration status" }, { key: "registeredAt", label: "Registered" }, { key: "checkedInAt", label: "Checked in" }];
      const result = await db.query(
        `SELECT event.event_date::text AS "eventDate",event.title AS "eventTitle",registration.first_name AS "firstName",registration.last_name AS "lastName",registration.email,registration.status,
                registration.registered_at::text AS "registeredAt",registration.checked_in_at::text AS "checkedInAt"
           FROM event_registrations registration JOIN service_events event ON event.id=registration.event_id
          WHERE event.department_id=$1 AND event.registration_enabled=TRUE AND ($2::date IS NULL OR event.event_date >= $2::date) AND ($3::date IS NULL OR event.event_date <= $3::date)
          ORDER BY event.event_date DESC,event.start_time DESC,event.title,registration.registered_at,registration.last_name,registration.first_name LIMIT 5000`,
        [departmentId, filters.from ?? null, filters.to ?? null],
      );
      rows = result.rows.map((row) => ({ ...row, registeredAt: row.registeredAt instanceof Date ? row.registeredAt.toISOString() : String(row.registeredAt ?? ""), checkedInAt: row.checkedInAt instanceof Date ? row.checkedInAt.toISOString() : row.checkedInAt === null ? null : String(row.checkedInAt) }));
    } else if (reportKey === "event-absence-conflicts") {
      if (!filters.from || !filters.to) throw new Error("Choose a start and end date for the report.");
      const rangeDays = (Date.parse(`${filters.to}T00:00:00Z`) - Date.parse(`${filters.from}T00:00:00Z`)) / 86_400_000;
      if (rangeDays > 366) throw new Error("Choose a date range of 367 days or less.");
      columns = [{ key: "eventDate", label: "Date" }, { key: "eventTitle", label: "Event" }, { key: "role", label: "Role" }, { key: "person", label: "Assigned person" }, { key: "response", label: "Response" }, { key: "absenceStartsOn", label: "Absence starts" }, { key: "absenceEndsOn", label: "Absence ends" }, { key: "reason", label: "Absence reason" }];
      const result = await db.query(
        `SELECT event.event_date::text AS "eventDate",event.title AS "eventTitle",position.value->>'name' AS role,
                concat_ws(' ',person.first_name,person.last_name) AS person,
                CASE COALESCE(response.status,'pending') WHEN 'accepted' THEN 'confirmed' WHEN 'declined' THEN 'declined' ELSE 'requested' END AS response,
                absence.starts_on::text AS "absenceStartsOn",absence.ends_on::text AS "absenceEndsOn",absence.reason
           FROM service_events event
           CROSS JOIN LATERAL jsonb_array_elements(event.positions) WITH ORDINALITY AS position(value,position_number)
           JOIN contacts person ON person.department_id=event.department_id
            AND person.id=CASE WHEN position.value->>'contactId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN (position.value->>'contactId')::uuid ELSE NULL END
           LEFT JOIN event_position_responses response ON response.event_id=event.id AND response.position_index=(position.position_number-1)::int AND response.contact_id=person.id
           JOIN event_person_absences absence ON absence.department_id=event.department_id AND absence.contact_id=person.id AND absence.status='active'
            AND event.event_date BETWEEN absence.starts_on AND absence.ends_on
          WHERE event.department_id=$1 AND event.event_date BETWEEN $2::date AND $3::date
          ORDER BY event.event_date,event.start_time,lower(position.value->>'name'),person.last_name,person.first_name LIMIT 5000`,
        [departmentId, filters.from, filters.to],
      );
      rows = result.rows;
    } else if (reportKey === "visitor-follow-up") {
      columns = [{ key: "eventDate", label: "Event date" }, { key: "eventTitle", label: "Event" }, { key: "firstName", label: "First name" }, { key: "lastName", label: "Last name" }, { key: "followUpStatus", label: "Follow-up" }, { key: "checkedInAt", label: "Checked in" }];
      const result = await db.query("SELECT event.event_date::text AS \"eventDate\",event.title AS \"eventTitle\",contact.first_name AS \"firstName\",contact.last_name AS \"lastName\",checkin.follow_up_status AS \"followUpStatus\",checkin.checked_in_at AS \"checkedInAt\" FROM event_attendance_checkins checkin JOIN service_events event ON event.id=checkin.event_id JOIN contacts contact ON contact.id=checkin.contact_id WHERE event.department_id=$1 AND contact.department_id=$1 AND checkin.first_time_visitor=TRUE AND ($2::date IS NULL OR event.event_date >= $2::date) AND ($3::date IS NULL OR event.event_date <= $3::date) AND ($4::text IS NULL OR checkin.follow_up_status=$4) ORDER BY event.event_date DESC,contact.last_name,contact.first_name LIMIT 3000", [departmentId, filters.from ?? null, filters.to ?? null, filters.followUpStatus ?? null]);
      rows = result.rows.map((row) => ({ ...row, checkedInAt: row.checkedInAt instanceof Date ? row.checkedInAt.toISOString() : String(row.checkedInAt ?? "") }));
    } else if (reportKey === "worship-song-usage") {
      columns = [{ key: "songTitle", label: "Song" }, { key: "uses", label: "Uses" }, { key: "latestUse", label: "Latest use" }];
      const present = await db.query<{ present: boolean }>("SELECT to_regclass('public.worship_songs') IS NOT NULL AND to_regclass('public.worship_song_arrangements') IS NOT NULL AS present");
      if (!present.rows[0]?.present) throw new Error("Worship Planning is not installed for this site.");
      const result = await db.query(
        `SELECT song.title AS "songTitle",count(*)::int AS uses,max(event.event_date)::text AS "latestUse"
           FROM service_events event CROSS JOIN LATERAL jsonb_array_elements(event.time_plan) item(value)
           JOIN worship_songs song ON song.id=NULLIF(item.value->>'songId','')::uuid AND song.department_id=event.department_id
          WHERE event.department_id=$1 AND ($2::date IS NULL OR event.event_date >= $2::date) AND ($3::date IS NULL OR event.event_date <= $3::date)
          GROUP BY song.id,song.title ORDER BY uses DESC,song.title LIMIT 2000`,
        [departmentId, filters.from ?? null, filters.to ?? null],
      );
      rows = result.rows;
    } else if (reportKey === "resource-bookings") {
      columns = [{ key: "resourceName", label: "Resource" }, { key: "category", label: "Category" }, { key: "bookings", label: "Bookings" }, { key: "requested", label: "Requested" }, { key: "approved", label: "Approved" }, { key: "declined", label: "Declined" }, { key: "cancelled", label: "Cancelled" }];
      const result = await db.query(
        `SELECT resource.name AS "resourceName",resource.category,count(booking.id)::int AS bookings,
                count(booking.id) FILTER (WHERE booking.status='requested')::int AS requested,
                count(booking.id) FILTER (WHERE booking.status='approved')::int AS approved,
                count(booking.id) FILTER (WHERE booking.status='declined')::int AS declined,
                count(booking.id) FILTER (WHERE booking.status='cancelled')::int AS cancelled
           FROM bookable_resources resource LEFT JOIN resource_bookings booking ON booking.resource_id=resource.id AND booking.department_id=resource.department_id
             AND ($2::date IS NULL OR booking.starts_at::date >= $2::date) AND ($3::date IS NULL OR booking.starts_at::date <= $3::date)
          WHERE resource.department_id=$1 GROUP BY resource.id,resource.name,resource.category ORDER BY resource.name LIMIT 2000`,
        [departmentId, filters.from ?? null, filters.to ?? null],
      );
      rows = result.rows;
    } else if (reportKey === "resource-utilization") {
      columns = [{ key: "month", label: "Month" }, { key: "resourceName", label: "Resource" }, { key: "category", label: "Category" }, { key: "bookingCount", label: "Bookings" }, { key: "requestedCount", label: "Requested" }, { key: "approvedCount", label: "Approved" }, { key: "declinedCount", label: "Declined" }, { key: "cancelledCount", label: "Cancelled" }, { key: "requestedHours", label: "Requested hours" }, { key: "approvedHours", label: "Approved hours" }];
      const result = await db.query(
        `SELECT date_trunc('month',booking.starts_at)::date::text AS month,resource.name AS "resourceName",resource.category,
                count(booking.id)::int AS "bookingCount",
                count(booking.id) FILTER (WHERE booking.status='requested')::int AS "requestedCount",
                count(booking.id) FILTER (WHERE booking.status='approved')::int AS "approvedCount",
                count(booking.id) FILTER (WHERE booking.status='declined')::int AS "declinedCount",
                count(booking.id) FILTER (WHERE booking.status='cancelled')::int AS "cancelledCount",
                COALESCE(round((sum(extract(epoch FROM (booking.ends_at-booking.starts_at))/3600) FILTER (WHERE booking.status='requested'))::numeric,2),0)::text AS "requestedHours",
                COALESCE(round((sum(extract(epoch FROM (booking.ends_at-booking.starts_at))/3600) FILTER (WHERE booking.status='approved'))::numeric,2),0)::text AS "approvedHours"
           FROM resource_bookings booking JOIN bookable_resources resource ON resource.id=booking.resource_id AND resource.department_id=booking.department_id
          WHERE booking.department_id=$1 AND NOT booking.is_intake_request
            AND ($2::date IS NULL OR booking.starts_at::date >= $2::date) AND ($3::date IS NULL OR booking.starts_at::date <= $3::date)
          GROUP BY date_trunc('month',booking.starts_at)::date,resource.id,resource.name,resource.category
          ORDER BY month DESC,resource.name LIMIT 5000`,
        [departmentId, filters.from ?? null, filters.to ?? null],
      );
      rows = result.rows;
    } else if (reportKey === "finance-budget-vs-actual") {
      columns = [{ key: "year", label: "Accounting year" }, { key: "account", label: "Account scope" }, { key: "costCenter", label: "Cost-center scope" }, { key: "budgetCents", label: "Budget (minor units)" }, { key: "actualDebitsCents", label: "Posted debits (minor units)" }, { key: "actualCreditsCents", label: "Posted credits (minor units)" }, { key: "note", label: "Budget note" }];
      const present = await db.query<{ present: boolean }>("SELECT to_regclass('public.finance_budgets') IS NOT NULL AND to_regclass('public.finance_transactions') IS NOT NULL AS present");
      if (!present.rows[0]?.present) throw new Error("Finance budgets are not installed for this site.");
      const result = await db.query(
        `SELECT budget.accounting_year AS year,
                CASE WHEN budget.account_id IS NULL THEN 'All accounts' ELSE concat_ws(' · ',account.code,account.name) END AS account,
                CASE WHEN budget.cost_center_id IS NULL THEN 'All cost centers' ELSE concat_ws(' · ',center.code,center.name) END AS "costCenter",
                budget.amount_cents::text AS "budgetCents",
                COALESCE(sum(line.debit_cents) FILTER (WHERE txn.id IS NOT NULL),0)::text AS "actualDebitsCents",
                COALESCE(sum(line.credit_cents) FILTER (WHERE txn.id IS NOT NULL),0)::text AS "actualCreditsCents",
                budget.note
           FROM finance_budgets budget
           LEFT JOIN finance_accounts account ON account.id=budget.account_id AND account.department_id=budget.department_id
           LEFT JOIN finance_cost_centers center ON center.id=budget.cost_center_id AND center.department_id=budget.department_id
           LEFT JOIN finance_transaction_lines line ON line.department_id=budget.department_id
            AND (budget.account_id IS NULL OR line.account_id=budget.account_id)
            AND (budget.cost_center_id IS NULL OR line.cost_center_id IS NOT DISTINCT FROM budget.cost_center_id)
           LEFT JOIN finance_transactions txn ON txn.id=line.transaction_id AND txn.department_id=line.department_id
            AND txn.status='posted' AND txn.accounting_year=budget.accounting_year
          WHERE budget.department_id=$1 AND ($2::smallint IS NULL OR budget.accounting_year=$2::smallint)
          GROUP BY budget.id,budget.accounting_year,budget.account_id,account.code,account.name,budget.cost_center_id,center.code,center.name,budget.amount_cents,budget.note
          ORDER BY budget.accounting_year DESC,account.code NULLS FIRST,center.code NULLS FIRST LIMIT 5000`,
        [departmentId, filters.accountingYear ?? null],
      );
      rows = result.rows;
    } else if (reportKey === "finance-donor-giving") {
      columns = [{ key: "donor", label: "Donor" }, { key: "donorType", label: "Type" }, { key: "giftTransactions", label: "Posted transactions" }, { key: "grossCreditsCents", label: "Credits (minor units)" }, { key: "reversalsCents", label: "Debits/reversals (minor units)" }, { key: "netGivingCents", label: "Net giving (minor units)" }, { key: "lastGiftDate", label: "Latest transaction" }];
      const result = await db.query(
        `SELECT donor.display_name AS donor,donor.donor_type AS "donorType",
                count(DISTINCT txn.id)::int AS "giftTransactions",
                COALESCE(sum(line.credit_cents) FILTER (WHERE txn.id IS NOT NULL),0)::text AS "grossCreditsCents",
                COALESCE(sum(line.debit_cents) FILTER (WHERE txn.id IS NOT NULL),0)::text AS "reversalsCents",
                COALESCE(sum(line.credit_cents-line.debit_cents) FILTER (WHERE txn.id IS NOT NULL),0)::text AS "netGivingCents",
                max(txn.booking_date)::text AS "lastGiftDate"
           FROM finance_donors donor
           LEFT JOIN finance_transaction_lines line ON line.donor_id=donor.id AND line.department_id=donor.department_id
           LEFT JOIN finance_transactions txn ON txn.id=line.transaction_id AND txn.department_id=line.department_id AND txn.status='posted'
            AND ($2::date IS NULL OR txn.booking_date >= $2::date) AND ($3::date IS NULL OR txn.booking_date <= $3::date)
          WHERE donor.department_id=$1
          GROUP BY donor.id,donor.display_name,donor.donor_type
          ORDER BY sum(line.credit_cents-line.debit_cents) FILTER (WHERE txn.id IS NOT NULL) DESC NULLS LAST,lower(donor.display_name) LIMIT 3000`,
        [departmentId, filters.from ?? null, filters.to ?? null],
      );
      rows = result.rows;
    } else {
      columns = [{ key: "year", label: "Accounting year" }, { key: "accountCode", label: "Account code" }, { key: "accountName", label: "Account" }, { key: "accountType", label: "Class" }, { key: "debitsCents", label: "Debits (minor units)" }, { key: "creditsCents", label: "Credits (minor units)" }];
      const available = await db.query<{ present: boolean }>("SELECT to_regclass('public.finance_transactions') IS NOT NULL AS present");
      if (!available.rows[0]?.present) throw new Error("The Finance module is not installed for this site.");
      const result = await db.query("SELECT txn.accounting_year AS year,account.code AS \"accountCode\",account.name AS \"accountName\",account.account_type AS \"accountType\",COALESCE(sum(line.debit_cents),0)::text AS \"debitsCents\",COALESCE(sum(line.credit_cents),0)::text AS \"creditsCents\" FROM finance_transaction_lines line JOIN finance_transactions txn ON txn.id=line.transaction_id AND txn.department_id=line.department_id JOIN finance_accounts account ON account.id=line.account_id AND account.department_id=line.department_id WHERE line.department_id=$1 AND txn.status='posted' AND ($2::date IS NULL OR txn.booking_date >= $2::date) AND ($3::date IS NULL OR txn.booking_date <= $3::date) GROUP BY txn.accounting_year,account.code,account.name,account.account_type ORDER BY txn.accounting_year DESC,account.code LIMIT 5000", [departmentId, filters.from ?? null, filters.to ?? null]);
      rows = result.rows;
    }
    return { reportKey, title: catalog.find((item) => item.key === reportKey)!.title, generatedAt: new Date().toISOString(), columns, rows };
  }

  app.get("/api/modules/reports/catalog", async (request, reply) => {
    const departmentId = await department(request, reply);
    if (!departmentId) return reply;
    return installedReports(departmentId, request);
  });
  app.get("/api/modules/reports/groups", async (request, reply) => {
    const departmentId = await department(request, reply);
    if (!departmentId) return reply;
    if (!hasPermission(request, "groups")) return denied(reply);
    return (await pool!.query("SELECT id,name FROM church_groups WHERE department_id=$1 ORDER BY name LIMIT 2000", [departmentId])).rows;
  });
  app.get("/api/modules/reports/historical-group-types", async (request, reply) => {
    const departmentId = await department(request, reply);
    if (!departmentId) return reply;
    if (!(await installedReports(departmentId,request)).some(item => item.key==="group-type-development")) return denied(reply);
    const result = await pool!.query<{ label: string }>(historicalGroupTypeOptionsSql,[departmentId]);
    return reply.header("Cache-Control","private, no-store").send(result.rows.map(row => row.label));
  });
  app.get<{ Querystring: ExportFormatQuery & ReportFilters & { reportKey?: ReportKey } }>("/api/modules/reports/run", {
    schema: { querystring: { type: "object", additionalProperties: false, required: ["reportKey"], properties: { ...exportFormatQuery.properties, reportKey: { type: "string", enum: catalog.map((item) => item.key) }, from: { type: "string", format: "date" }, to: { type: "string", format: "date" }, groupId: uuid, groupType: { type: "string", maxLength: 85 }, status: { type: "string", enum: ["member", "visitor"] }, followUpStatus: { type: "string", enum: ["needed", "done", "not_needed"] }, accountingYear: { type: "integer", minimum: 1900, maximum: 2200 }, period: { type: "string", enum: ["month", "week"] } } } },
  }, async (request, reply) => {
    const departmentId = await department(request, reply);
    if (!departmentId) return reply;
    const reportKey = request.query.reportKey!;
    if (!(await installedReports(departmentId, request)).some((item) => item.key === reportKey)) return denied(reply);
    const filterInput: Record<string, unknown> = { ...request.query };
    delete filterInput.reportKey;
    delete filterInput.format;
    const filters = normalizeFilters(filterInput);
    if (filterError(filters)) return reply.code(400).send({ error: filters });
    try {
      const report = await runReport(departmentId, reportKey, filters, request);
      if (reportKey === "people-first-contact-trend" || reportKey === "event-recorded-facts-monthly") reply.header("Cache-Control","private, no-store");
      return request.query.format === "xlsx" ? sendReportWorkbook(reply, report, reportKey) : report;
    }
    catch (error) { return reply.code(error instanceof Error && error.message.startsWith("Choose") ? 400 : 503).send({ error: error instanceof Error ? error.message : "The report could not be generated." }); }
  });
  app.get("/api/modules/reports/saved", async (request, reply) => {
    const departmentId = await department(request, reply);
    if (!departmentId) return reply;
    const result = await pool!.query<SavedReport & { share_scope: "private" | "department"; can_edit: boolean }>("SELECT id,report_key,name,filters,owner_user_id,updated_at,share_scope,schedule_days,notify_when_ready,next_run_at,last_run_at,last_run_status,CASE WHEN owner_user_id=$2 THEN run_history END AS run_history,(owner_user_id=$2 OR $3::boolean) AS can_edit FROM saved_report_definitions WHERE department_id=$1 AND (owner_user_id=$2 OR share_scope='department') ORDER BY lower(name),id", [departmentId, request.authenticatedUser!.id, request.activeDepartmentRole === "site_admin"]);
    const availableKeys = new Set((await installedReports(departmentId, request)).map((item) => item.key));
    return result.rows.filter((saved) => availableKeys.has(saved.report_key)).map((saved) => ({ id: saved.id, reportKey: saved.report_key, name: saved.name, filters: saved.filters, ownerId: saved.owner_user_id, updatedAt: saved.updated_at, shareScope: saved.share_scope, canEdit: saved.can_edit, ...(saved.owner_user_id === request.authenticatedUser!.id ? { scheduleDays: saved.schedule_days, notifyWhenReady: saved.notify_when_ready, nextRunAt: saved.next_run_at, lastRunAt: saved.last_run_at, lastRunStatus: saved.last_run_status, runHistory: saved.run_history } : {}) }));
  });
  app.post<{ Body: { reportKey: ReportKey; name: string; filters: unknown; shareScope?: "private" | "department" } }>("/api/modules/reports/saved", {
    schema: { body: { type: "object", additionalProperties: false, required: ["reportKey", "name", "filters"], properties: { reportKey: { type: "string", enum: catalog.map((item) => item.key) }, name: { type: "string", minLength: 1, maxLength: 120 }, filters: { type: "object", additionalProperties: true }, shareScope: { type: "string", enum: ["private", "department"] } } } },
  }, async (request, reply) => {
    const departmentId = await department(request, reply);
    if (!departmentId) return reply;
    if (!canModule(request, "manage")) return denied(reply);
    if (!validateMutation(request, reply)) return reply;
    if (!(await installedReports(departmentId, request)).some((item) => item.key === request.body.reportKey)) return denied(reply);
    const filters = normalizeFilters(request.body.filters);
    if (filterError(filters)) return reply.code(400).send({ error: filters });
    if (["group-growth","people-first-contact-trend","group-attendance-by-role","event-recorded-facts-monthly","group-type-development"].includes(request.body.reportKey) && !validGroupGrowthRange(filters.from, filters.to)) {
      return reply.code(400).send({ error: "Choose a valid date range of up to 731 calendar days." });
    }
    const name = cleanText(request.body.name, 120);
    if (!name) return reply.code(400).send({ error: "Enter a name for this saved report." });
    try {
      const result = await pool!.query("INSERT INTO saved_report_definitions(id,department_id,owner_user_id,report_key,name,filters,share_scope) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7) RETURNING id,report_key AS \"reportKey\",name,filters,share_scope AS \"shareScope\",updated_at AS \"updatedAt\"", [randomUUID(), departmentId, request.authenticatedUser!.id, request.body.reportKey, name, JSON.stringify(filters), request.body.shareScope ?? "private"]);
      return reply.code(201).send(result.rows[0]);
    } catch { return reply.code(409).send({ error: "A saved report with that name already exists in your account." }); }
  });
  app.put<{ Params: { id: string }; Body: { shareScope: "private" | "department" } }>("/api/modules/reports/saved/:id/sharing", {
    schema: { params: { type: "object", additionalProperties: false, required: ["id"], properties: { id: uuid } }, body: { type: "object", additionalProperties: false, required: ["shareScope"], properties: { shareScope: { type: "string", enum: ["private", "department"] } } } },
  }, async (request, reply) => {
    const departmentId = await department(request, reply); if (!departmentId) return reply;
    if (!canModule(request, "manage")) return denied(reply);
    if (!validateMutation(request, reply)) return reply;
    const result = await pool!.query("UPDATE saved_report_definitions SET share_scope=$4,updated_at=now() WHERE id=$1 AND department_id=$2 AND (owner_user_id=$3 OR $5::boolean) RETURNING id,share_scope AS \"shareScope\"", [request.params.id, departmentId, request.authenticatedUser!.id, request.body.shareScope, request.activeDepartmentRole === "site_admin"]);
    if (!result.rowCount) return reply.code(404).send({ error: "Saved report not found or you cannot change its sharing." });
    return result.rows[0];
  });
  app.delete<{ Params: { id: string } }>("/api/modules/reports/saved/:id", {
    schema: { params: { type: "object", additionalProperties: false, required: ["id"], properties: { id: uuid } } },
  }, async (request, reply) => {
    const departmentId = await department(request, reply);
    if (!departmentId) return reply;
    if (!canModule(request, "manage")) return denied(reply);
    if (!validateMutation(request, reply)) return reply;
    const result = await pool!.query("DELETE FROM saved_report_definitions WHERE id=$1 AND department_id=$2 AND (owner_user_id=$3 OR $4) RETURNING id", [request.params.id, departmentId, request.authenticatedUser!.id, request.activeDepartmentRole === "site_admin"]);
    if (!result.rowCount) return reply.code(404).send({ error: "Saved report not found or you cannot delete it." });
    return { deleted: true };
  });
  app.put<{ Params: { id: string }; Body: { days: 1 | 7 | null; notifyWhenReady?: boolean; runNow?: boolean } }>("/api/modules/reports/saved/:id/schedule", {
    schema: {
      params: { type: "object", required: ["id"], properties: { id: uuid } },
      body: { type: "object", additionalProperties: false, required: ["days"], properties: { days: { anyOf: [{ type: "integer", enum: [1, 7] }, { type: "null" }] }, notifyWhenReady: { type: "boolean" }, runNow: { type: "boolean" } } },
    },
  }, async (request, reply) => {
    const departmentId = await department(request, reply);
    if (!departmentId) return reply;
    if (!canModule(request, "manage")) return denied(reply);
    if (!validateMutation(request, reply)) return reply;
    const keys = (await installedReports(departmentId, request)).map((item) => item.key);
    const client = await pool!.connect();
    try {
      await client.query("BEGIN");
      if (!await context.lockDepartmentForWrite(client, departmentId)) {
        await client.query("ROLLBACK");
        return reply.code(423).send({ error: "This location is read-only." });
      }
      const result = await client.query(
        `UPDATE saved_report_definitions SET schedule_days=$4, notify_when_ready=COALESCE($6,notify_when_ready), next_run_at=CASE WHEN $4::int IS NULL THEN NULL WHEN $7::boolean THEN now() WHEN $4=schedule_days THEN next_run_at ELSE now() END,
           scheduled_result=CASE WHEN $4=schedule_days THEN scheduled_result END, last_run_at=CASE WHEN $4=schedule_days THEN last_run_at END, last_run_status=CASE WHEN $4=schedule_days THEN last_run_status END
         WHERE id=$1 AND department_id=$2 AND owner_user_id=$3 AND (NOT $7::boolean OR ($4::int IS NOT NULL AND schedule_days=$4 AND $6::boolean IS NULL)) AND ($4::int IS NULL OR report_key=ANY($5::text[])) RETURNING id`,
        [request.params.id, departmentId, request.authenticatedUser!.id, request.body.days, keys, request.body.notifyWhenReady ?? null, request.body.runNow ?? false],
      );
      await client.query("COMMIT");
      if (!result.rowCount) return reply.code(404).send({ error: "No accessible saved report owned by your account." });
      return { scheduled: request.body.days !== null };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  });

  app.get<{ Params: { id: string }; Querystring: ExportFormatQuery }>("/api/modules/reports/saved/:id/scheduled-result", {
    schema: { querystring: exportFormatQuery, params: { type: "object", required: ["id"], properties: { id: uuid } } },
  }, async (request, reply) => {
    const departmentId = await department(request, reply);
    if (!departmentId) return reply;
    const keys = (await installedReports(departmentId, request)).map((item) => item.key);
    const result = await pool!.query<{ scheduled_result: Awaited<ReturnType<typeof runReport>> | null }>(
      `SELECT scheduled_result FROM saved_report_definitions
        WHERE id=$1 AND department_id=$2 AND owner_user_id=$3 AND report_key=ANY($4::text[])`,
      [request.params.id, departmentId, request.authenticatedUser!.id, keys],
    );
    const report = result.rows[0]?.scheduled_result;
    if (!report) return reply.code(404).send({ error: "No scheduled result is available." });
    if (report.reportKey === "group-meeting-feedback") {
      // Stored attendee result rows omit identity, so older results cannot distinguish anonymous submissions.
      report.rows = report.rows.map((row) => row.responseType === "Attendee" ? { ...row, submittedAt: null } : row);
    }
    if (request.query.format === "xlsx") return sendReportWorkbook(reply, report, report.reportKey);
    return reply.header("cache-control", "private, no-store").send(report);
  });

  const designer = registerReportDesigner(app, context);
  let scheduleRunning = false;
  async function runDueReports() {
    if (!pool || !isDatabaseReady() || !context.activation.isEnabled() || scheduleRunning) return;
    scheduleRunning = true;
    try {
      const redundancy = await pool.query<{ ready: boolean }>("SELECT to_regclass('public.sync_site_redundancy') IS NOT NULL AS ready");
      const primaryOnly = redundancy.rows[0]?.ready
        ? "AND EXISTS (SELECT 1 FROM sync_site_redundancy state WHERE state.department_id=saved.department_id AND state.role='primary')"
        : "";
      const candidates = await pool.query<{ id: string; department_id: string; kind: "catalog" | "designer" }>(
        `SELECT id, department_id, kind FROM (
           SELECT saved.id, saved.department_id, saved.next_run_at, 'catalog' AS kind
           FROM saved_report_definitions saved JOIN departments location ON location.id=saved.department_id
           WHERE saved.next_run_at <= now() AND 'reports'=ANY(location.enabled_modules) ${primaryOnly}
           UNION ALL
           SELECT saved.id, saved.department_id, saved.next_run_at, 'designer' AS kind
           FROM saved_designer_reports saved JOIN departments location ON location.id=saved.department_id
           WHERE saved.next_run_at <= now() AND 'reports'=ANY(location.enabled_modules) ${primaryOnly}
         ) due ORDER BY next_run_at, id, kind LIMIT 50`,
      );
      for (const candidate of candidates.rows) {
        const table = candidate.kind === "designer" ? "saved_designer_reports" : "saved_report_definitions";
        if (!await context.isDepartmentWritable(candidate.department_id)) continue;
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          if (!await context.lockDepartmentForWrite(client, candidate.department_id)) {
            await client.query("ROLLBACK");
            continue;
          }
          const due = await client.query<SavedReport & { definition: Record<string, unknown> }>(
            `SELECT saved.* FROM ${table} saved JOIN departments location ON location.id=saved.department_id
             WHERE saved.id=$1 AND saved.department_id=$2 AND saved.next_run_at<=now() AND 'reports'=ANY(location.enabled_modules)
             FOR UPDATE OF saved SKIP LOCKED`,
            [candidate.id, candidate.department_id],
          );
          const saved = due.rows[0];
          if (!saved) {
            await client.query("ROLLBACK");
            continue;
          }
          const membership = await client.query<{ role: ReportAccess["activeDepartmentRole"]; permissions: ReportAccess["activeDepartmentPermissions"]; module_permissions: ReportAccess["activeDepartmentModulePermissions"] }>(
            "SELECT role, permissions, module_permissions FROM department_memberships WHERE department_id=$1 AND user_id=$2 FOR SHARE",
            [candidate.department_id, saved.owner_user_id],
          );
          const grants = membership.rows[0];
          const access = grants && {
            activeDepartmentRole: grants.role,
            activeDepartmentPermissions: grants.permissions,
            activeDepartmentModulePermissions: grants.module_permissions,
          };
          let status = "unavailable";
          let output: string | null = null;
          if (access && canModule(access, "manage")) {
            await client.query("SAVEPOINT generate_report");
            try {
              const report = candidate.kind === "designer"
                ? await designer.runSavedDesign(access, candidate.department_id, saved.definition, client)
                : (await installedReports(candidate.department_id, access, client)).some((entry) => entry.key === saved.report_key)
                  ? await runReport(candidate.department_id, saved.report_key, saved.filters, access, client)
                  : null;
              if (report) {
                const document = JSON.stringify(report);
                if (Buffer.byteLength(document) <= 2_000_000) {
                  output = document;
                  status = "ready";
                } else status = "too_large";
              }
            } catch {
              await client.query("ROLLBACK TO SAVEPOINT generate_report");
              status = "failed";
            }
          }
          await client.query(
            `UPDATE ${table} SET last_run_at=now(), last_run_status=$2, scheduled_result=$3::jsonb,
              next_run_at=now()+schedule_days*interval '24 hours',
              run_history=(jsonb_build_array(jsonb_build_object('ranAt',now(),'status',$2::text)) || run_history) - 20 WHERE id=$1`,
            [saved.id, status, output],
          );
          if (status === "ready" && saved.notify_when_ready && isServerModuleEnabled("notifications")) {
            await client.query("SAVEPOINT notify_report_owner");
            try {
              const readiness = await client.query<{ ready: boolean }>(
                "SELECT to_regclass('public.module_notifications') IS NOT NULL AS ready",
              );
              if (readiness.rows[0]?.ready) {
                await client.query(
                  "INSERT INTO module_notifications(id,department_id,recipient_user_id,kind,title,body,in_app_enabled,email_enabled) VALUES($1,$2,$3,'report_ready',$4,$5,true,false)",
                  [randomUUID(), candidate.department_id, saved.owner_user_id, "Scheduled report ready", "Open Reports to view your latest scheduled result."],
                );
              }
            } catch (error) {
              await client.query("ROLLBACK TO SAVEPOINT notify_report_owner");
              app.log.warn({ err: error, savedReportId: saved.id }, "Could not create scheduled report notification.");
            }
            await client.query("RELEASE SAVEPOINT notify_report_owner");
          }
          await client.query("COMMIT");
        } catch (error) {
          await client.query("ROLLBACK");
          app.log.error({ err: error, savedReportId: candidate.id }, "Could not process scheduled report.");
        } finally {
          client.release();
        }
      }
    } catch (error) {
      app.log.error({ err: error }, "Could not scan scheduled reports.");
    } finally {
      scheduleRunning = false;
    }
  }
  const scheduleTimer = setInterval(() => void runDueReports(), 60_000);
  scheduleTimer.unref();
  app.addHook("onClose", async () => clearInterval(scheduleTimer));

}
