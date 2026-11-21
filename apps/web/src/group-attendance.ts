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
