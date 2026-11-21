import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { AlertTriangle, CalendarDays, CalendarOff, Plus, RotateCcw } from "lucide-react";
import type { ModuleContext } from "../../module-registry";
import "./event-absences.css";

type Reason = "holiday" | "illness" | "family" | "work" | "other";
type Absence = { id: string; startsOn: string; endsOn: string; reason: Reason; privateNote: string; status: "active" | "cancelled"; createdAt: string; cancelledAt: string | null };
type RoleConflict = { eventId: string; eventDate: string; eventTitle: string; role: string; contactId: string; personName: string; responseStatus: string; absenceId: string; absenceStartsOn: string; absenceEndsOn: string; reason: Reason };
const reasons: Record<Reason, string> = { holiday: "Holiday", illness: "Illness", family: "Family", work: "Work", other: "Other" };
const isoDay = (value: Date) => value.toISOString().slice(0, 10);

export function EventAbsencesModule({ departmentId, csrfToken }: ModuleContext) {
  const [absences, setAbsences] = useState<Absence[]>([]);
  const [conflicts, setConflicts] = useState<RoleConflict[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [from, setFrom] = useState(isoDay(new Date()));
  const [to, setTo] = useState(isoDay(new Date(Date.now() + 60 * 86_400_000)));
  const [startsOn, setStartsOn] = useState(isoDay(new Date()));
  const [endsOn, setEndsOn] = useState(isoDay(new Date()));
  const [reason, setReason] = useState<Reason>("holiday");
  const [privateNote, setPrivateNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const headers = useMemo(() => ({ "x-department-id": departmentId }), [departmentId]);
  const loadMine = useCallback(async () => {
    const response = await fetch("/api/modules/event-absences/bootstrap", { headers, cache: "no-store" });
    const data = await response.json() as { absences?: Absence[]; canManage?: boolean; error?: string };
    if (!response.ok) throw new Error(data.error ?? "Could not load your absence records.");
    setAbsences(data.absences ?? []); setCanManage(Boolean(data.canManage));
  }, [headers]);
  const loadConflicts = useCallback(async () => {
    const parameters = new URLSearchParams({ from, to });
    const response = await fetch(`/api/modules/event-absences/role-conflicts?${parameters}`, { headers, cache: "no-store" });
    const data = await response.json() as RoleConflict[] | { error?: string };
    if (!response.ok) throw new Error("error" in data ? data.error ?? "Could not load staffing conflicts." : "Could not load staffing conflicts.");
    setConflicts(Array.isArray(data) ? data : []);
  }, [from, headers, to]);

  useEffect(() => {
    let active = true;
    setLoading(true); setError("");
    void loadMine().then(async () => {
      if (active && canManage) await loadConflicts();
    }).catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : "Could not load absences."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [loadConflicts, loadMine, canManage]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/modules/event-absences/absences", { method: "POST", headers: { ...headers, "content-type": "application/json", "x-csrf-token": csrfToken }, body: JSON.stringify({ startsOn, endsOn, reason, privateNote }) });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Could not save this absence.");
      setNotice("Availability updated."); setPrivateNote(""); await loadMine();
      if (canManage) await loadConflicts();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save this absence."); }
    finally { setBusy(false); }
  }

  async function cancel(absence: Absence) {
    if (!window.confirm(`Cancel your ${absence.startsOn} to ${absence.endsOn} absence?`)) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/modules/event-absences/absences/${absence.id}/cancel`, { method: "POST", headers: { ...headers, "x-csrf-token": csrfToken } });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Could not cancel this absence.");
      setNotice("Absence cancelled."); await loadMine(); if (canManage) await loadConflicts();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not cancel this absence."); }
    finally { setBusy(false); }
  }

  async function refreshConflicts() {
    setError("");
    try { await loadConflicts(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not load staffing conflicts."); }
  }

  return <main className="event-absences">
    <header className="event-absences-header"><div><span className="event-absences-eyebrow">VOLUNTEER AVAILABILITY</span><h1>Absences</h1><p>Record dates when you are unavailable so event managers can see role conflicts.</p></div><span className="event-absences-icon"><CalendarOff size={22} /></span></header>
    {error && <div className="event-absences-message is-error" role="alert">{error}</div>}
    {notice && <div className="event-absences-message is-success" role="status">{notice}</div>}
    <div className="event-absences-layout">
      <section className="event-absences-panel">
        <h2><Plus size={17} /> Add an absence</h2>
        <form onSubmit={(event) => void submit(event)} className="event-absences-form">
          <div className="event-absences-date-grid"><label>From<input type="date" required value={startsOn} onChange={(event) => { setStartsOn(event.target.value); if (endsOn < event.target.value) setEndsOn(event.target.value); }} /></label><label>Through<input type="date" min={startsOn} required value={endsOn} onChange={(event) => setEndsOn(event.target.value)} /></label></div>
          <label>Reason<select value={reason} onChange={(event) => setReason(event.target.value as Reason)}>{Object.entries(reasons).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
          <label>Private note <span>(visible to you and event managers)</span><textarea maxLength={1000} rows={3} value={privateNote} onChange={(event) => setPrivateNote(event.target.value)} placeholder="Optional details" /></label>
          <button className="button button-primary" type="submit" disabled={busy}><CalendarDays size={15} /> Save absence</button>
        </form>
      </section>
      <section className="event-absences-panel">
        <h2><CalendarDays size={17} /> My absence history</h2>
        {loading ? <p className="event-absences-empty">Loading your dates…</p> : absences.length ? <div className="event-absence-list">{absences.map((absence) => <article key={absence.id} className={`event-absence-card ${absence.status}`}><div><strong>{absence.startsOn === absence.endsOn ? absence.startsOn : `${absence.startsOn} – ${absence.endsOn}`}</strong><span>{reasons[absence.reason]} · {absence.status === "active" ? "Active" : "Cancelled"}</span>{absence.privateNote && <p>{absence.privateNote}</p>}</div>{absence.status === "active" && <button className="event-absence-cancel" type="button" disabled={busy} onClick={() => void cancel(absence)}><RotateCcw size={14} /> Cancel</button>}</article>)}</div> : <p className="event-absences-empty">You have not recorded any unavailable dates.</p>}
      </section>
    </div>
    {canManage && <section className="event-absences-panel event-absence-conflicts">
      <div className="event-conflict-heading"><div><h2><AlertTriangle size={17} /> Assigned volunteers unavailable</h2><p>This view identifies assignments that overlap an active absence. It never changes the roster.</p></div><div className="event-absences-range"><label>From<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label><label>To<input type="date" min={from} value={to} onChange={(event) => setTo(event.target.value)} /></label><button className="button button-secondary" type="button" onClick={() => void refreshConflicts()}>Refresh</button></div></div>
      {conflicts.length ? <div className="event-conflict-table-wrap"><table><thead><tr><th>Date</th><th>Event</th><th>Role</th><th>Person</th><th>Response</th><th>Unavailable</th><th>Reason</th></tr></thead><tbody>{conflicts.map((conflict) => <tr key={`${conflict.eventId}:${conflict.contactId}:${conflict.absenceId}`}><td>{conflict.eventDate}</td><td>{conflict.eventTitle}</td><td>{conflict.role}</td><td>{conflict.personName}</td><td>{conflict.responseStatus}</td><td>{conflict.absenceStartsOn} – {conflict.absenceEndsOn}</td><td>{reasons[conflict.reason]}</td></tr>)}</tbody></table></div> : <p className="event-absences-empty">No assigned role conflicts in this date range.</p>}
    </section>}
  </main>;
}
