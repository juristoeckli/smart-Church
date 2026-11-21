import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { canonicalTimeZone } from "../../calendar-time.js";
import { validVolunteerAbsenceRange } from "../../event-volunteer-absences.js";
import { describeTimedVolunteerAbsence } from "../../volunteer-absence-time.js";
import type { readChurchToolsAbsencePreview } from "./absence-preview.js";

type Db = Pick<PoolClient, "query">;
export type AbsenceScope = { departmentId: string; instanceUrl: string; personId: string; from: string; through: string };
type SourcePreview = ReturnType<typeof readChurchToolsAbsencePreview>;
type SourceRow = SourcePreview["dates"][number];
type Range = { startsOn: string; endsOn: string };
type TimeRange = Range & { startUtc?: string | null; endUtc?: string | null };
type LocalRange = TimeRange & { timed: boolean };
type Candidate = LocalRange & { startsAt?: string; endsAt?: string };
type Consent = Range & { confirmedAt: string; allowTimed: boolean; timedZone?: string | null };
type Receipt = { source_absence_id: string; absence_id: string | null; originalStart: string; originalEnd: string; localStart: string | null; localEnd: string | null;
  sourceStartUtc: string | null; sourceEndUtc: string | null; localStartUtc: string | null; localEndUtc: string | null };
const clockSql = (field: string) => `to_char(${field} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS".000Z"')`;
const contained = (inner: Range, outer: Range) => inner.startsOn >= outer.startsOn && inner.endsOn <= outer.endsOn;

export async function verifiedAbsenceContact(db: Db, scope: AbsenceScope, lock = false) {
  const { rows } = await db.query<{ contact_id: string }>(`SELECT proof.contact_id FROM churchtools_migration_person_provenance proof
    JOIN contacts person ON person.department_id=proof.department_id AND person.id=proof.contact_id AND person.archived_at IS NULL
    WHERE proof.department_id=$1 AND proof.instance_url=$2 AND proof.source_person_id=$3 ${lock ? "FOR SHARE OF proof,person" : ""}`,
  [scope.departmentId, scope.instanceUrl, scope.personId]);
  return rows[0]?.contact_id ?? null;
}

function overlaps(left: TimeRange, right: TimeRange) {
  return left.startUtc && left.endUtc && right.startUtc && right.endUtc
    ? left.startUtc < right.endUtc && right.startUtc < left.endUtc
    : left.startsOn <= right.endsOn && right.startsOn <= left.endsOn;
}

function candidateInterval(source: SourceRow, scope: AbsenceScope, sourceZone: string | null, localZone: string | null): { candidate: Candidate | null; insideReview: boolean } {
  const sourceWindow = { startsOn: scope.from, endsOn: scope.through };
  const { sourceStartDate, sourceEndDate, timed, startUtc, endUtc } = source;
  if (!timed) {
    const candidate = { startsOn: sourceStartDate, endsOn: sourceEndDate, timed };
    return { candidate, insideReview: contained(candidate, sourceWindow) };
  }
  if (!sourceZone || !localZone || !startUtc || !endUtc) return { candidate: null, insideReview: false };
  const proved = describeTimedVolunteerAbsence(startUtc, endUtc, sourceZone);
  // ChurchTools returns application-calendar date fields alongside the two UTC
  // boundaries. Check both labels before using the instants in a different zone.
  if (proved.startsOn !== sourceStartDate || proved.endsAt.slice(0, 10) !== sourceEndDate) {
    return { candidate: null, insideReview: false };
  }
  const candidate = { ...describeTimedVolunteerAbsence(startUtc, endUtc, localZone), timed, startUtc, endUtc };
  return { candidate, insideReview: contained(proved, sourceWindow) };
}

function absenceStatus(source: SourceRow, candidate: Candidate | null, receipt: Receipt | undefined, insideReview: boolean,
  consent: Consent | undefined, local: LocalRange[], localZone: string | null,
) {
  if (receipt) {
    if (receipt.originalStart !== source.sourceStartDate || receipt.originalEnd !== source.sourceEndDate
      || (receipt.sourceStartUtc ?? null) !== (source.startUtc ?? null) || (receipt.sourceEndUtc ?? null) !== (source.endUtc ?? null)
      || source.timed !== !!receipt.sourceStartUtc) return "source_changed";
    if (!receipt.absence_id) return "local_removed";
    if (source.timed) return receipt.localStartUtc === source.startUtc && receipt.localEndUtc === source.endUtc ? "already_imported" : "local_changed";
    return !receipt.localStartUtc && receipt.localStart === source.sourceStartDate && receipt.localEnd === source.sourceEndDate
      ? "already_imported" : "local_changed";
  }
  if (source.timed && !consent?.allowTimed) return "timed_consent_required";
  if (!candidate) return "unverified_source_time";
  if (source.timed && consent?.timedZone !== localZone) return "timed_consent_timezone_changed";
  if (!validVolunteerAbsenceRange(candidate)) return "unsupported_range";
  if (!insideReview) return "outside_review";
  if (!consent) return "consent_required";
  if (!contained(candidate, consent)) return "outside_consent";
  if (local.some((row) => row.timed === candidate.timed && (candidate.timed
    ? row.startUtc === candidate.startUtc && row.endUtc === candidate.endUtc
    : row.startsOn === candidate.startsOn && row.endsOn === candidate.endsOn))) return "local_copy_present";
  if (local.some((row) => overlaps(row, candidate))) return "local_overlap";
  return "ready";
}

export async function reviewChurchToolsAbsenceImport(db: Db, scope: AbsenceScope, contactId: string, source: SourcePreview,
  lock = false, sourceZone: string | null = null,
) {
  const args = [scope.departmentId, scope.instanceUrl, scope.personId, contactId];
  const { rows: [consent] } = await db.query<Consent>(`SELECT grant_row.starts_on::text AS "startsOn",
    grant_row.ends_on::text AS "endsOn",grant_row.consented_at::text AS "confirmedAt",grant_row.allow_timed AS "allowTimed",grant_row.timed_zone AS "timedZone"
    FROM event_volunteer_absence_import_consents grant_row JOIN department_memberships member
      ON member.department_id=grant_row.department_id AND member.user_id=grant_row.actor_user_id AND member.contact_id=grant_row.contact_id
    WHERE grant_row.department_id=$1 AND grant_row.instance_url=$2 AND grant_row.source_person_id=$3 AND grant_row.contact_id=$4
    ${lock ? "FOR SHARE OF grant_row,member" : ""}`, args);
  let localZone: string | null = null;
  if (sourceZone && source.dates.some(({ startUtc }) => startUtc)) {
    const { rows } = await db.query<{ time_zone: string }>("SELECT time_zone FROM departments WHERE id=$1" + (lock ? " FOR SHARE" : ""), [scope.departmentId]);
    localZone = canonicalTimeZone(rows[0]?.time_zone);
  }
  const candidates = [...source.dates].sort((a, b) => a.sourceStartDate.localeCompare(b.sourceStartDate) || a.sourceId.localeCompare(b.sourceId))
    .map((row) => ({ row, ...candidateInterval(row, scope, sourceZone, localZone) }));
  let localFrom = scope.from;
  let localThrough = scope.through;
  for (const { candidate } of candidates) {
    if (!candidate) continue;
    if (candidate.startsOn < localFrom) localFrom = candidate.startsOn;
    if (candidate.endsOn > localThrough) localThrough = candidate.endsOn;
  }
  if (lock) await db.query("LOCK TABLE event_volunteer_absences IN SHARE ROW EXCLUSIVE MODE");
  const [local, receipts] = await Promise.all([
    db.query<LocalRange>(`SELECT first_day::text AS "startsOn",last_day::text AS "endsOn",timed,"startUtc","endUtc" FROM (
      SELECT COALESCE((a.starts_at AT TIME ZONE d.time_zone)::date,a.starts_on) AS first_day,
        COALESCE(((a.ends_at - interval '1 microsecond') AT TIME ZONE d.time_zone)::date,a.ends_on) AS last_day,
        a.starts_at IS NOT NULL AS timed,${clockSql("a.starts_at")} AS "startUtc",${clockSql("a.ends_at")} AS "endUtc"
      FROM event_volunteer_absences a JOIN departments d ON d.id=a.department_id
      WHERE a.department_id=$1 AND a.contact_id=$2
    ) local_ranges WHERE first_day<=$4::date AND last_day>=$3::date ORDER BY first_day,last_day,timed`,
    [scope.departmentId, contactId, localFrom, localThrough]),
    db.query<Receipt>(`SELECT receipt.source_absence_id,receipt.absence_id,receipt.original_start::text AS "originalStart",
      receipt.original_end::text AS "originalEnd",local_record.starts_on::text AS "localStart",local_record.ends_on::text AS "localEnd",
      ${clockSql("receipt.original_starts_at")} AS "sourceStartUtc",${clockSql("receipt.original_ends_at")} AS "sourceEndUtc",
      ${clockSql("local_record.starts_at")} AS "localStartUtc",${clockSql("local_record.ends_at")} AS "localEndUtc"
      FROM churchtools_migration_absence_receipts receipt LEFT JOIN event_volunteer_absences local_record
        ON local_record.id=receipt.absence_id AND local_record.department_id=receipt.department_id AND local_record.contact_id=receipt.contact_id
      WHERE receipt.department_id=$1 AND receipt.instance_url=$2 AND receipt.source_person_id=$3 AND receipt.contact_id=$4`, args),
  ]);
  const bySource = new Map(receipts.rows.map((row) => [row.source_absence_id, row]));
  const records = candidates.map(({ row, candidate, insideReview }) => ({
    row, candidate, insideReview, status: absenceStatus(row, candidate, bySource.get(row.sourceId), insideReview, consent, local.rows, localZone),
  }));
  const dates = records.map(({ row: { startUtc: _start, endUtc: _end, ...row }, candidate, insideReview, status }) => ({
    ...row, status,
    ...(insideReview && consent?.allowTimed && consent.timedZone === localZone && candidate?.timed && contained(candidate, consent)
      ? { localStart: candidate.startsAt, localEnd: candidate.endsAt, localZone, startUtc: candidate.startUtc, endUtc: candidate.endUtc } : {}),
  }));
  const reviewHash = createHash("sha256").update(JSON.stringify([scope, contactId, consent ?? null, sourceZone, localZone, source.unsupported, dates])).digest("hex");
  return { dates, unsupported: source.unsupported, reviewHash, consentGranted: !!consent, records };
}

type Review = Awaited<ReturnType<typeof reviewChurchToolsAbsenceImport>>;
export class AbsenceImportReviewError extends Error {}

export async function applyChurchToolsAbsenceImport(db: Db, scope: AbsenceScope, contactId: string, review: Review,
  reviewHash: string, selected: string[],
) {
  const bySource = new Map(review.records.map((record) => [record.row.sourceId, record]));
  if (selected.some((id) => !["ready", "already_imported"].includes(bySource.get(id)?.status ?? ""))) {
    throw new AbsenceImportReviewError("A selected absence is no longer eligible. Open a fresh review.");
  }
  const pending = review.records.flatMap(({ status, row, candidate }) => status === "ready" && candidate && selected.includes(row.sourceId)
    ? [{ row, candidate }] : []);
  if (!pending.length) return { imported: 0, replayed: true };
  if (reviewHash !== review.reviewHash) throw new AbsenceImportReviewError("The source dates, consent, or local availability changed. Open a fresh review.");
  if (pending.some(({ candidate }, index) => pending.slice(0, index).some((entry) => overlaps(entry.candidate, candidate)))) {
    throw new AbsenceImportReviewError("Selected source dates overlap. Select a single covering period.");
  }
  for (const { row, candidate } of pending) {
    const absenceId = randomUUID();
    await db.query(`INSERT INTO event_volunteer_absences(id,department_id,contact_id,starts_on,ends_on,starts_at,ends_at)
      VALUES($1,$2,$3,$4,$5,$6,$7)`,
    [absenceId, scope.departmentId, contactId, candidate.startsOn, candidate.endsOn, candidate.startUtc ?? null, candidate.endUtc ?? null]);
    const claimed = await db.query(`INSERT INTO churchtools_migration_absence_receipts
      (department_id,contact_id,instance_url,source_person_id,source_absence_id,original_start,original_end,absence_id,original_starts_at,original_ends_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT DO NOTHING`,
    [scope.departmentId, contactId, scope.instanceUrl, scope.personId, row.sourceId, row.sourceStartDate, row.sourceEndDate,
      absenceId, candidate.startUtc ?? null, candidate.endUtc ?? null]);
    if (!claimed.rowCount) throw new AbsenceImportReviewError("A selected absence already has a source receipt.");
  }
  return { imported: pending.length, replayed: false };
}
