import { useEffect, useState } from "react";
import type { GroupMeetingTarget } from "../check-in/GroupMeetingAttendance";

export function CalendarGroupMeeting({ appointmentId, originalStart, departmentId, csrfToken, onOpen }: {
  appointmentId: string;
  originalStart: string;
  departmentId: string;
  csrfToken: string;
  onOpen: (meeting: GroupMeetingTarget) => void;
}) {
  const path = "/api/modules/church-calendar/appointments/" + appointmentId + "/group-meetings/" + encodeURIComponent(originalStart);
  const [meeting, setMeeting] = useState<GroupMeetingTarget | null>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setError("");
    setMeeting(undefined);
    void fetch(path, { signal: controller.signal, headers: { "x-department-id": departmentId } })
      .then(async (response) => {
        const result = await response.json() as { meeting: GroupMeetingTarget | null; error?: string };
        if (!response.ok) throw new Error(result.error ?? "Could not load the group meeting.");
        if (!controller.signal.aborted) setMeeting(result.meeting);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not load the group meeting.");
      });
    return () => controller.abort();
  }, [departmentId, path, version]);

  async function createMeeting() {
    if (saving || meeting !== null) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch(path, {
        method: "POST",
        headers: { "x-department-id": departmentId, "x-csrf-token": csrfToken },
      });
      const result = await response.json() as { meeting: GroupMeetingTarget | null; error?: string };
      if (!response.ok || !result.meeting) throw new Error(result.error ?? "Could not create the group meeting.");
      setMeeting(result.meeting);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not create the group meeting.");
    } finally {
      setSaving(false);
    }
  }

  return <div className="church-calendar-extra-date wide">
    <strong>Group meeting attendance</strong>
    {error && <div role="alert">{error}</div>}
    {meeting === undefined && (error ? <button className="button button-secondary" type="button" onClick={() => setVersion((value) => value + 1)}>Retry</button> : <small role="status">Loading group meeting…</small>)}
    {meeting === null && <>
      <small>Create a roster from the group’s current active members.</small>
      <button className="button button-secondary" type="button" disabled={saving} onClick={() => void createMeeting()}>{saving ? "Creating…" : "Create group meeting"}</button>
    </>}
    {meeting && <div>
      <small>{meeting.date} · {meeting.title}</small>
      <button className="button button-secondary" type="button" onClick={() => onOpen(meeting)}>Open attendance</button>
    </div>}
  </div>;
}
