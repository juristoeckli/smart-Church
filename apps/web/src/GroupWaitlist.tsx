import { useEffect, useState } from "react";

type WaitlistRow = { contactId: string; firstName: string; lastName: string; role: string; position: number };

export function GroupWaitlist({ departmentId, groupId, csrfToken, rosterRevision, disabled, onPending, onChanged }: {
  departmentId: string;
  groupId: string;
  csrfToken: string;
  rosterRevision: string;
  disabled: boolean;
  onPending: (busy: boolean) => void;
  onChanged: () => Promise<void>;
}) {
  const [rows, setRows] = useState<WaitlistRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const path = "/api/groups/" + groupId + "/waitlist";

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    void fetch(path, { signal: controller.signal, headers: { "x-department-id": departmentId } })
      .then(async (result) => {
        const data = await result.json() as WaitlistRow[] | { error?: string };
        if (!result.ok || !Array.isArray(data)) throw new Error(Array.isArray(data) ? "Could not load the waitlist." : data.error ?? "Could not load the waitlist.");
        if (!controller.signal.aborted) setRows(data);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not load the waitlist.");
      }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [path, departmentId, rosterRevision, version]);

  async function change(action: { order: string[] } | { promoteContactId: string }) {
    if (busy || loading || disabled) return;
    setBusy(true);
    onPending(true);
    setNotice("");
    setError("");
    try {
      const response = await fetch(path, {
        method: "PUT",
        headers: { "content-type": "application/json", "x-department-id": departmentId, "x-csrf-token": csrfToken },
        body: JSON.stringify({ expectedOrder: rows.map((row) => row.contactId), ...action }),
      });
      const data = await response.json() as WaitlistRow[] | { error?: string };
      if (!response.ok || !Array.isArray(data)) throw new Error(Array.isArray(data) ? "Could not update the waitlist." : data.error ?? "Could not update the waitlist.");
      setRows(data);
      const promoted = "promoteContactId" in action;
      if (promoted) await onChanged();
      setNotice(promoted ? "The person is now an active group member." : "Waitlist order saved.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not update the waitlist.");
    } finally {
      setBusy(false);
      onPending(false);
    }
  }

  function move(position: number, destination: number) {
    const order = rows.map((row) => row.contactId);
    [order[position], order[destination]] = [order[destination], order[position]];
    void change({ order });
  }

  return <section className="group-attendance-section">
    <div className="community-members-heading">
      <div><h3>Membership waitlist</h3>{notice && <p role="status">{notice}</p>}</div>
      <button className="button button-secondary" type="button" disabled={busy || loading} onClick={() => setVersion((current) => current + 1)}>Refresh waitlist</button>
    </div>
    {error && <p role="alert" className="community-empty">{error}</p>}
    {loading && <p role="status" className="community-empty">Loading waitlist…</p>}
    {!loading && !error && !rows.length && <p className="community-empty">Set a member’s status to Waitlist to add them here.</p>}
    {!loading && rows.length > 0 && <ol className="group-attendance-list">
      {rows.map((record, index) => {
        const name = record.firstName + " " + record.lastName;
        const blocked = busy || disabled || Boolean(error);
        return <li key={record.contactId} className="community-member-row">
          <span className="community-member-avatar">{record.position}</span>
          <span><strong>{name}</strong> <small>{record.role}</small></span>
          <div className="community-inline-actions">
            <button className="button button-secondary" type="button" aria-label={"Move " + name + " up"} disabled={blocked || index === 0} onClick={() => move(index, index - 1)}>Move up</button>
            <button className="button button-secondary" type="button" aria-label={"Move " + name + " down"} disabled={blocked || index === rows.length - 1} onClick={() => move(index, index + 1)}>Move down</button>
            <button className="button button-secondary" type="button" disabled={blocked} onClick={() => {
              if (window.confirm("Promote " + name + " to active membership?")) void change({ promoteContactId: record.contactId });
            }}>Promote</button>
          </div>
        </li>;
      })}
    </ol>}
  </section>;
}
