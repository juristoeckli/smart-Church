export type GroupAttendanceStatus = "present" | "absent" | "excused";
export type GroupAttendanceEntry = { contactId: string; firstName: string; lastName: string; status: GroupAttendanceStatus };

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

export async function setGroupAttendanceCompletion(meetingId: string, departmentId: string, csrfToken: string, completedAt: string | null) {
  const response = await fetch(groupAttendanceUrl(meetingId) + "/completion", {
    method: "PUT",
    headers: { "content-type": "application/json", "x-department-id": departmentId, "x-csrf-token": csrfToken },
    body: JSON.stringify({ completed: !completedAt, expectedCompletedAt: completedAt }),
  });
  const result = await response.json() as { completedAt?: string | null; error?: string };
  if (!response.ok || result.completedAt === undefined) throw new Error(result.error ?? "Could not change group meeting completion.");
  return result.completedAt;
}
