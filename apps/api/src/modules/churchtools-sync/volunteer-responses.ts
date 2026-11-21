import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { parseChurchToolsEventDateTime } from "./event-time.js";

type Db = Pick<PoolClient, "query">;
type Scope = { departmentId: string; instanceUrl: string; eventId: string };
type VisibleAssignment = { sourceId: string; serviceId: string; personId: string; name: string; accepted: boolean };
const object = (value: unknown) => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const id = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? String(value) : null;
const roleKey = (role: string, person: string) => JSON.stringify([role, person]);

export function readChurchToolsVolunteerResponses(payload: unknown, eventId: string) {
  const event = object(object(payload)?.data);
  if (id(event?.id) !== eventId || !Array.isArray(event?.eventServices) || event.isCanceled !== false
    || typeof event.startDate !== "string" || !event.startDate.endsWith("Z") || !Number.isFinite(Date.parse(event.startDate))
    || event.eventServices.length > 500) throw new Error("ChurchTools did not return the selected active event and its visible assignments.");
  const visible: VisibleAssignment[] = [];
  const counts = { hiddenOrUnassigned: 0, inactive: 0, pending: 0, unsupported: 0 };
  const seen = new Set<string>();
  for (const value of event.eventServices) {
    const row = object(value);
    const sourceId = id(row?.id);
    if (!row || !sourceId || seen.has(sourceId)) throw new Error("ChurchTools returned an invalid or repeated assignment ID.");
    seen.add(sourceId);
    if (row.isValid !== true) { counts.inactive += 1; continue; }
    const person = object(row.person);
    const personId = person?.domainIdentifier;
    if (person?.domainType !== "person" || typeof personId !== "string" || !/^[1-9][0-9]{0,15}$/.test(personId)
      || (row.personId != null && id(row.personId) !== personId)) {
      counts.hiddenOrUnassigned += 1;
      continue;
    }
    const serviceId = id(row.serviceId);
    const name = typeof row.serviceName === "string" ? row.serviceName.trim() : "";
    if (!serviceId || !name || name.length > 160 || typeof row.isAccepted !== "boolean") {
      counts.unsupported += 1;
      continue;
    }
    if (!row.isAccepted) counts.pending += 1;
    visible.push({ sourceId, serviceId, personId, name, accepted: row.isAccepted });
  }
  return { counts, visible, startDate: event.startDate };
}

type Source = ReturnType<typeof readChurchToolsVolunteerResponses>;
type LocalEvent = { id: string; title: string; date: string; startTime: string; allDay: boolean; timeZone: string; active: boolean; positions: unknown };
type Planned = { sourceId: string; name: string; positionIndex: number | null; status: string };
type Review = { event: LocalEvent; counts: Source["counts"]; rows: Planned[]; ready: Array<VisibleAssignment & { positionIndex: number; contactId: string }>; reviewHash: string };

export async function reviewChurchToolsVolunteerResponses(db: Db, scope: Scope, source: Source, lock = false): Promise<Review | null> {
  const { rows: [event] } = await db.query<LocalEvent>(`SELECT e.id,e.title,e.event_date::text AS date,to_char(e.start_time,'HH24:MI') AS "startTime",
      e.is_all_day AS "allDay",d.time_zone AS "timeZone",(e.cancelled_at IS NULL) AS active,e.positions
    FROM churchtools_service_event_provenance link JOIN service_events e ON e.id=link.event_id AND e.department_id=link.department_id
    JOIN departments d ON d.id=e.department_id
    WHERE link.department_id=$1 AND link.instance_url=$2 AND link.source_event_id=$3 AND e.kind='service' ${lock ? "FOR SHARE OF link FOR UPDATE OF e" : ""}`,
  [scope.departmentId, scope.instanceUrl, scope.eventId]);
  if (!event || !event.active || !Array.isArray(event.positions)) return null;
  const accepted = source.visible.filter((row) => row.accepted);
  const sourceStart = parseChurchToolsEventDateTime(source.startDate, undefined, undefined, event.timeZone);
  const matchingEventTime = !event.allDay && sourceStart?.date === event.date && sourceStart.time === event.startTime;
  const [people, responses, receipts] = await Promise.all([
    db.query<{ source_person_id: string; contact_id: string }>(`SELECT proof.source_person_id,proof.contact_id
      FROM churchtools_migration_person_provenance proof JOIN contacts c ON c.id=proof.contact_id AND c.department_id=proof.department_id
      WHERE proof.department_id=$1 AND proof.instance_url=$2 AND proof.source_person_id=ANY($3::text[])
      ${lock ? "FOR SHARE OF proof,c" : ""}`, [scope.departmentId, scope.instanceUrl, [...new Set(accepted.map(({ personId }) => personId))]]),
    db.query<{ position_index: number }>(`SELECT position_index FROM event_position_responses WHERE event_id=$1 ${lock ? "FOR UPDATE" : ""}`, [event.id]),
    db.query<{ source_assignment_id: string }>(`SELECT source_assignment_id FROM churchtools_migration_volunteer_responses
      WHERE department_id=$1 AND instance_url=$2 AND source_event_id=$3`, [scope.departmentId, scope.instanceUrl, scope.eventId]),
  ]);
  const contacts = new Map(people.rows.map((row) => [row.source_person_id, row.contact_id]));
  const replied = new Set(responses.rows.map((response) => response.position_index));
  const imported = new Set(receipts.rows.map(({ source_assignment_id }) => source_assignment_id));
  const counts = new Map<string, number>();
  for (const row of source.visible) {
    const key = roleKey(row.name, row.personId);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const ready: Review["ready"] = [];
  const rows = accepted.map((row) => {
    const start = { sourceId: row.sourceId, name: row.name, positionIndex: null };
    if (imported.has(row.sourceId)) return { ...start, status: "already_imported" };
    const contactId = contacts.get(row.personId);
    if (!matchingEventTime) return { ...start, status: "local_event_time_changed" };
    if (!contactId) return { ...start, status: "person_not_verified" };
    if (counts.get(roleKey(row.name, row.personId)) !== 1) return { ...start, status: "source_slot_ambiguous" };
    const positions = (event.positions as unknown[]).flatMap((value, index) => {
      const position = object(value);
      return position?.contactId === contactId && position.name === row.name ? [index] : [];
    });
    if (positions.length !== 1) return { ...start, status: positions.length ? "local_slot_ambiguous" : "local_slot_changed" };
    const positionIndex = positions[0];
    if (replied.has(positionIndex)) return { ...start, positionIndex, status: "local_response_present" };
    ready.push({ ...row, positionIndex, contactId });
    return { ...start, positionIndex, status: "ready" };
  });
  const reviewHash = createHash("sha256").update(JSON.stringify([scope, event.id, event.date, event.startTime, source.startDate, source.counts, rows, ready])).digest("hex");
  return { event, counts: source.counts, rows, ready, reviewHash };
}

export class VolunteerResponseReviewError extends Error {}

export async function applyChurchToolsVolunteerResponses(db: Db, scope: Scope, review: Review, reviewHash: string, selected: string[]) {
  const bySource = new Map(review.rows.map((row) => [row.sourceId, row]));
  if (selected.some((id) => !["ready", "already_imported"].includes(bySource.get(id)?.status ?? ""))) {
    throw new VolunteerResponseReviewError("A selected response changed or no longer has an exact local role slot.");
  }
  const pending = review.ready.filter(({ sourceId }) => selected.includes(sourceId));
  if (!pending.length) return { imported: 0, replayed: true };
  if (review.reviewHash !== reviewHash) throw new VolunteerResponseReviewError("The source assignments or local schedule changed. Review them again.");
  for (const row of pending) {
    const response = await db.query(`INSERT INTO event_position_responses(event_id,position_index,contact_id,status)
      VALUES($1,$2,$3,'accepted') ON CONFLICT DO NOTHING`, [review.event.id, row.positionIndex, row.contactId]);
    if (!response.rowCount) throw new VolunteerResponseReviewError("A local response was recorded during the review.");
    const receipt = await db.query(`INSERT INTO churchtools_migration_volunteer_responses
      (department_id,instance_url,source_event_id,source_assignment_id,source_service_id,source_person_id,event_id,contact_id,original_position_index)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING`,
    [scope.departmentId, scope.instanceUrl, scope.eventId, row.sourceId, row.serviceId, row.personId, review.event.id, row.contactId, row.positionIndex]);
    if (!receipt.rowCount) throw new VolunteerResponseReviewError("A selected response already has a source receipt.");
  }
  return { imported: pending.length, replayed: false };
}
