import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";

type QuestionDraft = { label: string; type: "text" | "choice"; required: boolean; options?: string[] };
export type SignupQuestion = QuestionDraft & { id: string };
export type SignupForm = { revision: string | null; questions: SignupQuestion[] };
export type SignupSettings = { expectedRevision: string | null; questions: QuestionDraft[] };

const uuid = { type: "string", format: "uuid" } as const;
export const signupSettingsSchema = {
  type: "object", additionalProperties: false, required: ["expectedRevision", "questions"], properties: {
    expectedRevision: { type: ["string", "null"], format: "uuid" },
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
  const result = await db.query<SignupForm>(
    "SELECT revision,questions FROM group_signup_forms WHERE department_id=$1 AND group_id=$2",
    [departmentId, groupId],
  );
  return result.rows[0] ?? { revision: null, questions: [] };
}

type SignupAnswer = { questionId: string; label: string; value: string };
export function captureSignupAnswers(form: SignupForm, revision: string | undefined, answers: Record<string, string> = {}): { error: string; status: 400 | 409 } | { saved: SignupAnswer[] } {
  if (form.revision !== (revision ?? null)) return { error: "The signup questions changed. Reload the form before submitting.", status: 409 } as const;
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
