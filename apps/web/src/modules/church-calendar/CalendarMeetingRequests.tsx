import { useEffect, useState } from "react";

type Status = "pending" | "accepted" | "declined";
type MeetingRequests = {
  window: string; myStatus: Status | null;
  members?: Array<{ userId: string; name: string; status: Status | null }>;
  truncated?: boolean;
};

const labels: Record<Status, string> = { pending: "Awaiting response", accepted: "Accepted", declined: "Declined" };

export function CalendarMeetingRequests({ appointmentId, originalStart, departmentId, csrfToken }: {
  appointmentId: string; originalStart: string; departmentId: string; csrfToken: string;
}) {
  const [data, setData] = useState<MeetingRequests | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const endpoint = `/api/modules/church-calendar/appointments/${appointmentId}/occurrences/${encodeURIComponent(originalStart)}/meeting-requests`;

  useEffect(() => {
    const controller = new AbortController();
    fetch(endpoint, { headers: { "x-department-id": departmentId }, cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (response.status === 404) {
          if (!controller.signal.aborted) setData(null);
          return;
        }
        if (!response.ok) throw new Error("Could not load meeting requests.");
        const view = await response.json() as MeetingRequests;
        if (!controller.signal.aborted) setData(view);
      })
      .catch(() => { if (!controller.signal.aborted) setError("Could not load meeting requests."); });
    return () => controller.abort();
  }, [departmentId, endpoint, revision]);

  async function update(method: "POST" | "PUT", payload: { recipientIds: string[] } | { status: "accepted" | "declined" }) {
    if (busy || !data) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(endpoint, {
        method,
        headers: { "content-type": "application/json", "x-department-id": departmentId, "x-csrf-token": csrfToken },
        body: JSON.stringify({ ...payload, window: data.window }),
      });
      const result = await response.json() as { error?: string; invited?: number };
      if (!response.ok) throw new Error(result.error ?? "Could not save the meeting request.");
      if (method === "POST") {
        setSelected([]);
        setNotice(result.invited ? `${result.invited} invitation${result.invited === 1 ? "" : "s"} added.` : "Everyone selected already has an invitation.");
      } else {
        setNotice("Response saved.");
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save the meeting request.");
    } finally {
      setRevision((value) => value + 1);
      setBusy(false);
    }
  }

  if (!data?.myStatus && !data?.members && !error) return null;
  return <div className="church-calendar-extra-date wide">
    <strong>Meeting requests</strong>
    {data?.myStatus && <div>
      <span>Your response · {labels[data.myStatus]}</span>
      <button type="button" className="button button-secondary" disabled={busy || data.myStatus === "accepted"} onClick={() => void update("PUT", { status: "accepted" })}>Accept</button>
      <button type="button" className="button button-secondary" disabled={busy || data.myStatus === "declined"} onClick={() => void update("PUT", { status: "declined" })}>Decline</button>
    </div>}
    {data?.members && <>
      <button type="button" className="button button-secondary" aria-expanded={open} onClick={() => setOpen((value) => !value)}>{open ? "Hide invitees" : "Manage invitees"}</button>
      {open && <>
        <p>Invite eligible members to this occurrence. Changes to the meeting time require fresh invitations.</p>
        {data.members.length ? <ul>{data.members.map((member) => <li key={member.userId}>
          {member.status ? <span>{member.name} · {labels[member.status]}</span> : <label>
            <input type="checkbox" checked={selected.includes(member.userId)} disabled={busy || (selected.length >= 100 && !selected.includes(member.userId))}
              onChange={(event) => { const checked = event.target.checked; setSelected((value) => checked ? [...value, member.userId] : value.filter((id) => id !== member.userId)); }} />
            {member.name}
          </label>}
        </li>)}</ul> : <p>No active group members have linked accounts.</p>}
        {data.truncated && <small>Showing the first 500 eligible members.</small>}
        <button type="button" className="button button-primary" disabled={busy || !selected.length} onClick={() => void update("POST", { recipientIds: selected })}>Send invitations</button>
      </>}
    </>}
    {error && <p role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
  </div>;
}
