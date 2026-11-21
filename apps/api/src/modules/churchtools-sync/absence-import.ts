import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { validVolunteerAbsenceRange } from "../../event-volunteer-absences.js";
import type { readChurchToolsAbsencePreview } from "./absence-preview.js";

type Db = Pick<PoolClient, "query">;
export type AbsenceScope = { departmentId: string; instanceUrl: string; personId: string; from: string; through: string };
type SourcePreview = ReturnType<typeof readChurchToolsAbsencePreview>;
type Receipt = { source_absence_id: string; absence_id: string | null; originalStart: string; originalEnd: string; localStart: string | null; localEnd: string | null };
type Range = { startsOn: string; endsOn: string };
type LocalRange = Range & { timed: boolean };
type Consent = Range & { confirmedAt: string };

export async function verifiedAbsenceContact(db: Db, scope: AbsenceScope, lock = false) {
  const { rows } = await db.query<{ contact_id: string }>(`SELECT proof.contact_id FROM churchtools_migration_person_provenance proof
    JOIN contacts person ON person.department_id=proof.department_id AND person.id=proof.contact_id AND person.archived_at IS NULL
    WHERE proof.department_id=$1 AND proof.instance_url=$2 AND proof.source_person_id=$3 ${lock ? "FOR SHARE OF proof,person" : ""}`,
  [scope.departmentId, scope.instanceUrl, scope.personId]);
  return rows[0]?.contact_id ?? null;
}

function absenceStatus(source: SourcePreview["dates"][number], receipt: Receipt | undefined, scope: Pick<AbsenceScope, "from" | "through">,
  consent: Consent | null, local: LocalRange[],
) {
  const { sourceStartDate: start, sourceEndDate: end, timed } = source;
  if (timed) return "timed_source";
  if (receipt) {
    if (receipt.originalStart !== start || receipt.originalEnd !== end) return "source_changed";
    if (!receipt.absence_id) return "local_removed";
    return receipt.localStart === start && receipt.localEnd === end ? "already_imported" : "local_changed";
  }
  if (!validVolunteerAbsenceRange({ startsOn: start, endsOn: end })) return "unsupported_range";
  if (start < scope.from || end > scope.through) return "outside_review";
  if (!consent) return "consent_required";
  if (start < consent.startsOn || end > consent.endsOn) return "outside_consent";
  if (local.some(({ startsOn, endsOn, timed }) => !timed && startsOn === start && endsOn === end)) return "local_copy_present";
  if (local.some(({ startsOn, endsOn }) => start <= endsOn && end >= startsOn)) return "local_overlap";
  return "ready";
}

export async function reviewChurchToolsAbsenceImport(db: Db, scope: AbsenceScope, contactId: string, source: SourcePreview, lock = false) {
  const args = [scope.departmentId, scope.instanceUrl, scope.personId, contactId];
  const { rows: [consent] } = await db.query<Consent>(`SELECT grant_row.starts_on::text AS "startsOn",
    grant_row.ends_on::text AS "endsOn",grant_row.consented_at::text AS "confirmedAt"
    FROM event_volunteer_absence_import_consents grant_row JOIN department_memberships member
      ON member.department_id=grant_row.department_id AND member.user_id=grant_row.actor_user_id AND member.contact_id=grant_row.contact_id
    WHERE grant_row.department_id=$1 AND grant_row.instance_url=$2 AND grant_row.source_person_id=$3 AND grant_row.contact_id=$4
    ${lock ? "FOR SHARE OF grant_row,member" : ""}`, args);
  if (lock) await db.query("LOCK TABLE event_volunteer_absences IN SHARE ROW EXCLUSIVE MODE");
  const [local, receipts] = await Promise.all([
    db.query<LocalRange>(`SELECT first_day::text AS "startsOn",last_day::text AS "endsOn",timed FROM (
      SELECT COALESCE((a.starts_at AT TIME ZONE d.time_zone)::date,a.starts_on) AS first_day,
        COALESCE(((a.ends_at - interval '1 microsecond') AT TIME ZONE d.time_zone)::date,a.ends_on) AS last_day,
        a.starts_at IS NOT NULL AS timed
      FROM event_volunteer_absences a JOIN departments d ON d.id=a.department_id
      WHERE a.department_id=$1 AND a.contact_id=$2
    ) local_ranges WHERE first_day<=$4::date AND last_day>=$3::date ORDER BY first_day,last_day,timed`,
    [scope.departmentId, contactId, scope.from, scope.through]),
    db.query<Receipt>(`SELECT receipt.source_absence_id,receipt.absence_id,receipt.original_start::text AS "originalStart",
      receipt.original_end::text AS "originalEnd",CASE WHEN local_record.starts_at IS NULL THEN local_record.starts_on::text END AS "localStart",
      CASE WHEN local_record.starts_at IS NULL THEN local_record.ends_on::text END AS "localEnd"
      FROM churchtools_migration_absence_receipts receipt LEFT JOIN event_volunteer_absences local_record
        ON local_record.id=receipt.absence_id AND local_record.department_id=receipt.department_id AND local_record.contact_id=receipt.contact_id
      WHERE receipt.department_id=$1 AND receipt.instance_url=$2 AND receipt.source_person_id=$3 AND receipt.contact_id=$4`, args),
  ]);
  const bySource = new Map(receipts.rows.map((row) => [row.source_absence_id, row]));
  const dates = [...source.dates].sort((a, b) => a.sourceStartDate.localeCompare(b.sourceStartDate) || a.sourceId.localeCompare(b.sourceId)).map((row) => ({ ...row, status: absenceStatus(row, bySource.get(row.sourceId), scope, consent ?? null, local.rows) }));
  const reviewHash = createHash("sha256").update(JSON.stringify([scope, contactId, consent ?? null, source.unsupported, dates])).digest("hex");
  return { dates, unsupported: source.unsupported, reviewHash, consentGranted: !!consent };
}

type Review = Awaited<ReturnType<typeof reviewChurchToolsAbsenceImport>>;
export class AbsenceImportReviewError extends Error {}

export async function applyChurchToolsAbsenceImport(db: Db, scope: AbsenceScope, contactId: string, review: Review,
  reviewHash: string, selected: string[],
) {
  const bySource = new Map(review.dates.map((row) => [row.sourceId, row]));
  if (selected.some((id) => !["ready", "already_imported"].includes(bySource.get(id)?.status ?? ""))) {
    throw new AbsenceImportReviewError("A selected absence is no longer eligible. Open a fresh review.");
  }
  const pending = review.dates.filter(({ status, sourceId }) => status === "ready" && selected.includes(sourceId))
    .sort((a, b) => a.sourceStartDate.localeCompare(b.sourceStartDate));
  if (!pending.length) return { imported: 0, replayed: true };
  if (reviewHash !== review.reviewHash) throw new AbsenceImportReviewError("The source dates, consent, or local availability changed. Open a fresh review.");
  if (pending.some((row, index) => index > 0 && row.sourceStartDate <= pending[index - 1].sourceEndDate)) {
    throw new AbsenceImportReviewError("Selected source dates overlap. Select a single covering period.");
  }
  for (const row of pending) {
    const absenceId = randomUUID();
    await db.query(`INSERT INTO event_volunteer_absences(id,department_id,contact_id,starts_on,ends_on) VALUES($1,$2,$3,$4,$5)`,
    [absenceId, scope.departmentId, contactId, row.sourceStartDate, row.sourceEndDate]);
    const claimed = await db.query(`INSERT INTO churchtools_migration_absence_receipts
      (department_id,contact_id,instance_url,source_person_id,source_absence_id,original_start,original_end,absence_id)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING`,
    [scope.departmentId, contactId, scope.instanceUrl, scope.personId, row.sourceId, row.sourceStartDate, row.sourceEndDate, absenceId]);
    if (!claimed.rowCount) throw new AbsenceImportReviewError("A selected absence already has a source receipt.");
  }
  return { imported: pending.length, replayed: false };
}
