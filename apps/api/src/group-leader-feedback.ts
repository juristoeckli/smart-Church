import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";

type Scope = { departmentId: string; groupId: string; meetingId: string };
type Question = { id: string; prompt: string };
type FeedbackDraft = { answers: Record<string, string>; comment?: string; guestCount?: number | null };
export type CompletionFeedback = FeedbackDraft & { expectedUpdatedAt: string | null };
const revisionSql = `to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

const feedbackFields = {
  answers: { type: "object", maxProperties: 10, additionalProperties: { type: "string", maxLength: 2000 } },
  comment: { type: "string", maxLength: 2000 },
  guestCount: { type: ["integer", "null"], minimum: 0, maximum: 100000 },
} as const;

export const completionFeedbackSchema = {
  type: "object", additionalProperties: false, required: ["answers", "expectedUpdatedAt"],
  properties: { ...feedbackFields, expectedUpdatedAt: { type: ["string", "null"], format: "date-time" } },
} as const;

export async function groupFeedbackEnabled(db: Pool | PoolClient, departmentId: string) {
  return Boolean((await db.query("SELECT 1 FROM departments WHERE id=$1 AND 'group-operations'=ANY(enabled_modules)", [departmentId])).rowCount);
}

async function readFeedbackTemplate(db: Pool | PoolClient, scope: Scope, lock = false) {
  const result = await db.query<{ title: string; questions: Question[] }>(
    "SELECT title,questions FROM group_meeting_feedback_templates WHERE department_id=$1 AND group_id=$2" + (lock ? " FOR SHARE" : ""),
    [scope.departmentId, scope.groupId],
  );
  return result.rows[0] ?? null;
}

export async function readGroupLeaderFeedback(db: Pool | PoolClient, scope: Scope) {
  const template = await readFeedbackTemplate(db, scope);
  const result = await db.query<{ answers: Record<string, string>; comment: string; guestCount: number | null; updatedAt: string }>(
    `SELECT answers,meeting_comment AS comment,guest_count AS "guestCount",${revisionSql} AS "updatedAt"
       FROM group_meeting_feedback_responses WHERE department_id=$1 AND group_id=$2 AND meeting_id=$3`,
    [scope.departmentId, scope.groupId, scope.meetingId],
  );
  const response = result.rows[0];
  const questions = template?.questions ?? [];
  return {
    title: template?.title ?? null,
    questions,
    answers: Object.fromEntries(questions.map(({ id }) => [id, response?.answers[id] ?? ""])),
    comment: response?.comment ?? "",
    guestCount: response?.guestCount ?? null,
    expectedUpdatedAt: response?.updatedAt ?? null,
  };
}

// Call inside a transaction after locking the native meeting row.
export async function saveGroupLeaderFeedback(client: PoolClient, scope: Scope, draft: FeedbackDraft, actorId: string | null, revision?: { expectedUpdatedAt: string | null }) {
  const template = await readFeedbackTemplate(client, scope, true);
  const activeQuestionIds = template?.questions.map(({ id }) => id) ?? [];
  if (Object.keys(draft.answers).some((id) => !activeQuestionIds.includes(id))) {
    return { status: revision ? 409 : 400, error: "The feedback form changed. Reload it before saving." };
  }
  if (revision) {
    const previous = await client.query<{ updated_at: string }>(
      `SELECT ${revisionSql} AS updated_at FROM group_meeting_feedback_responses WHERE department_id=$1 AND group_id=$2 AND meeting_id=$3`,
      [scope.departmentId, scope.groupId, scope.meetingId],
    );
    if ((previous.rows[0]?.updated_at ?? null) !== revision.expectedUpdatedAt) {
      return { status: 409, error: "Leader feedback changed. Reload it before completing the meeting." };
    }
  }
  const answers = Object.fromEntries(Object.entries(draft.answers).map(([id, value]) => [id, value.trim()]));
  const saved = await client.query(`INSERT INTO group_meeting_feedback_responses AS prior
      (id,department_id,group_id,meeting_id,answers,created_by,updated_by,meeting_comment,guest_count)
    VALUES($1,$2,$3,$4,$5::jsonb,$6,$6,COALESCE($7,''),$8)
    ON CONFLICT(meeting_id) DO UPDATE SET
      answers=(prior.answers - $9::text[]) || EXCLUDED.answers,
      updated_by=EXCLUDED.updated_by,updated_at=clock_timestamp(),
      meeting_comment=COALESCE($7,prior.meeting_comment),
      guest_count=CASE WHEN $10 THEN EXCLUDED.guest_count ELSE prior.guest_count END
    WHERE prior.department_id=EXCLUDED.department_id AND prior.group_id=EXCLUDED.group_id
    RETURNING id`, [
      randomUUID(), scope.departmentId, scope.groupId, scope.meetingId, JSON.stringify(answers), actorId,
      draft.comment?.trim() ?? null, draft.guestCount ?? null, revision ? [] : activeQuestionIds, draft.guestCount !== undefined,
    ]);
  if (!saved.rowCount) return { status: 409, error: "The meeting feedback belongs to a different group or location." };
  await client.query(
    "INSERT INTO group_operations_audit(id,department_id,group_id,actor_user_id,action,record_id,details) VALUES($1,$2,$3,$4,'meeting_feedback_saved',$5,$6::jsonb)",
    [randomUUID(), scope.departmentId, scope.groupId, actorId, scope.meetingId, JSON.stringify({ answerCount: Object.keys(answers).length })],
  );
  return null;
}
