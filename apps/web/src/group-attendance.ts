export type GroupAttendanceStatus = "present" | "absent" | "excused";
export type GroupAttendanceEntry = { contactId: string; firstName: string; lastName: string; status: GroupAttendanceStatus; role?: string | null };

export function groupAttendanceChanges(
  baseline: Pick<GroupAttendanceEntry, "contactId" | "status">[],
  draft: Pick<GroupAttendanceEntry, "contactId" | "status">[],
) {
  const precedingStatus = new Map(baseline.map((row) => [row.contactId, row.status]));
  return draft.flatMap(({ contactId, status }) => {
    const expectedStatus = precedingStatus.get(contactId);
    return expectedStatus && expectedStatus !== status ? [{ contactId, status, expectedStatus }] : [];
  });
}

export type GroupAttendanceSnapshot = {
  attendance: GroupAttendanceEntry[];
  completedAt: string | null;
  canAddAttendees?: boolean;
  canCreateAttendees?: boolean;
};

export function groupAttendanceUrl(meetingId: string) {
  return "/api/group-meetings/" + meetingId + "/attendance";
}

export async function getGroupAttendance(meetingId: string, departmentId: string, signal?: AbortSignal) {
  const response = await fetch(groupAttendanceUrl(meetingId) + "?withCompletion=true", {
    headers: { "x-department-id": departmentId }, signal,
  });
  const result = await response.json() as Partial<GroupAttendanceSnapshot> & { error?: string };
  if (!response.ok || !Array.isArray(result.attendance)) throw new Error(result.error ?? "Could not load attendance.");
  return { attendance: result.attendance, completedAt: result.completedAt ?? null };
}

export async function setGroupAttendanceCompletion(meetingId: string, departmentId: string, csrfToken: string, completedAt: string | null, feedback?: CompletionFeedbackDraft) {
  const response = await fetch(groupAttendanceUrl(meetingId) + "/completion", {
    method: "PUT",
    headers: { "content-type": "application/json", "x-department-id": departmentId, "x-csrf-token": csrfToken },
    body: JSON.stringify({ completed: !completedAt, expectedCompletedAt: completedAt, ...(feedback ? { feedback } : {}) }),
  });
  const result = await response.json() as { completedAt?: string | null; error?: string };
  if (!response.ok || result.completedAt === undefined) throw new Error(result.error ?? "Could not change group meeting completion.");
  return result.completedAt;
}

export type CompletionFeedbackDraft = {
  comment?: string;
  guestCount?: number | null;
  answers: Record<string, string>;
  expectedUpdatedAt: string | null;
};
type CompletionFeedbackForm = CompletionFeedbackDraft & {
  title: string | null;
  questions: { id: string; prompt: string }[];
  comment: string;
  guestCount: number | null;
};

export async function getGroupCompletionFeedback(meetingId: string, departmentId: string, signal?: AbortSignal) {
  const response = await fetch(groupAttendanceUrl(meetingId) + "/completion-feedback", {
    headers: { "x-department-id": departmentId }, signal, cache: "no-store",
  });
  const result = await response.json() as { feedback?: CompletionFeedbackForm | null; error?: string };
  if (!response.ok || result.feedback === undefined) throw new Error(result.error ?? "Could not load leader feedback.");
  return result.feedback;
}
