import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { defaultSignupPolicy, signupPolicySchema, type SignupPolicyDraft } from "./signup-policy.js";

type QuestionDraft = { label: string; type: "text" | "choice"; required: boolean; options?: string[] };
export type SignupQuestion = QuestionDraft & { id: string };
export type SignupForm = { revision: string | null; questions: SignupQuestion[]; policy: SignupPolicyDraft };
export type SignupSettings = { expectedRevision: string | null; questions: QuestionDraft[]; policy?: SignupPolicyDraft };

const uuid = { type: "string", format: "uuid" } as const;
export const signupSettingsSchema = {
  type: "object", additionalProperties: false, required: ["expectedRevision", "questions"], properties: {
    expectedRevision: { type: ["string", "null"], format: "uuid" },
    policy: signupPolicySchema,
    questions: { type: "array", maxItems: 8, items: {
      type: "object", additionalProperties: false, required: ["label", "type", "required"], properties: {
        label: { type: "string", minLength: 1, maxLength: 120 },
        type: { type: "string", enum: ["text", "choice"] },
        required: { type: "boolean" },
        options: { type: "array", maxItems: 8, items: { type: "string", minLength: 1, maxLength: 80 } },
      },
    } },
  },
} as const;
export const signupAnswerFields = {
  formRevision: uuid,
  answers: { type: "object", maxProperties: 8, additionalProperties: { type: "string", maxLength: 160 } },
} as const;

export function prepareSignupQuestions(drafts: QuestionDraft[]) {
  const questions = drafts.map(({ label, type, required, options }) => ({
    id: randomUUID(), label: label.trim(), type, required,
    ...(type === "choice" ? { options: (options ?? []).map((option) => option.trim()) } : {}),
  }));
  const labels = new Set(questions.map(({ label }) => label.toLowerCase()));
  if (labels.size !== questions.length || questions.some(({ label }) => !label)) return "Enter a unique label for each signup question.";
  if (questions.some(({ options }) => options && (
    options.length < 2 || options.some((option) => !option) || new Set(options.map((option) => option.toLowerCase())).size !== options.length
  ))) return "Choice questions require two to eight distinct options.";
  return questions;
}

export async function readSignupForm(db: Pool | PoolClient, departmentId: string, groupId: string): Promise<SignupForm> {
  const result = await db.query<SignupForm & SignupPolicyDraft>(
    `SELECT revision,questions,
       to_char(opens_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "opensAt",
       to_char(closes_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "closesAt",
       default_role AS "defaultRole",heading,active_seat_limit AS "activeSeatLimit",waitlist_limit AS "waitlistLimit",counted_roles AS "countedRoles" FROM group_signup_forms WHERE department_id=$1 AND group_id=$2`,
    [departmentId, groupId],
  );
  const row = result.rows[0];
  return row ? { revision: row.revision, questions: row.questions, policy: {
    opensAt: row.opensAt, closesAt: row.closesAt, defaultRole: row.defaultRole, heading: row.heading,
    activeSeatLimit: row.activeSeatLimit, waitlistLimit: row.waitlistLimit, countedRoles: row.countedRoles,
  } } : { revision: null, questions: [], policy: defaultSignupPolicy };
}

type SignupAnswer = { questionId: string; label: string; value: string };
export function captureSignupAnswers(form: SignupForm, revision: string | undefined, answers: Record<string, string> = {}): { error: string; status: 400 | 409 } | { saved: SignupAnswer[] } {
  if ((form.questions.length ? form.revision : null) !== (revision ?? null)) return { error: "The signup questions changed. Reload the form before submitting.", status: 409 } as const;
  const validIds = new Set(form.questions.map((question) => question.id));
  if (Object.keys(answers).some((id) => !validIds.has(id))) return { error: "These answers do not match the signup questions.", status: 400 } as const;
  const saved: SignupAnswer[] = [];
  for (const question of form.questions) {
    const value = answers[question.id]?.trim() ?? "";
    if (question.required && !value) return { error: "Answer every required signup question.", status: 400 } as const;
    if (value && question.type === "choice" && !question.options?.includes(value)) {
      return { error: "Choose a listed answer for each selection question.", status: 400 } as const;
    }
    if (value) saved.push({ questionId: question.id, label: question.label, value });
  }
  return { saved } as const;
}
