import { useEffect, useState } from "react";
import type { ModuleContext } from "../../module-registry";
import { getActiveLanguage } from "../../i18n";

type MonthlySummary = { month: string; confirmed: number; requested: number; declined: number };
type Assignment = { eventId: string; title: string; eventDate: string; positionIndex: number; role: string | null; category: string | null; status: "confirmed" | "requested" | "declined" };
type Workload = { selectedMonth: string; months: MonthlySummary[]; assignments: Assignment[]; total: number; offset: number; pageSize: number };
const statusLabels = { confirmed: "Confirmed", requested: "Requested", declined: "Declined" } as const;

export function PersonServiceWorkload({ departmentId, contactId, onNavigateEntity }: {
  departmentId: string;
  contactId: string;
  onNavigateEntity: ModuleContext["onNavigateEntity"];
}) {
  const [view, setView] = useState({ month: "", offset: 0 });
  const [state, setState] = useState<{ personScope: string; scope: string; payload: Workload }>();
  const [loadError, setLoadError] = useState<{ scope: string; message: string }>();
  const personScope = JSON.stringify([departmentId, contactId]);
  const scope = JSON.stringify([personScope, view.month, view.offset]);
  const summary = state?.personScope === personScope ? state.payload : null;
  const workload = state?.scope === scope ? state.payload : null;
  const error = loadError?.scope === scope ? loadError.message : null;
  const dateFormat = new Intl.DateTimeFormat(getActiveLanguage(), { dateStyle: "medium", timeZone: "UTC" });
  const monthFormat = new Intl.DateTimeFormat(getActiveLanguage(), { month: "long", year: "numeric", timeZone: "UTC" });

  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams({ offset: String(view.offset) });
    if (view.month) query.set("month", view.month);
    fetch("/api/people-records/" + encodeURIComponent(contactId) + "/service-workload?" + query, {
      headers: { "x-department-id": departmentId }, cache: "no-store", signal: controller.signal,
    }).then(async (response) => {
      if (!response.ok) throw new Error("Could not load service assignments.");
      const payload = await response.json() as Workload;
      if (!controller.signal.aborted) setState({ personScope, scope, payload });
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted) setLoadError({ scope, message: reason instanceof Error ? reason.message : "Could not load service assignments." });
    });
    return () => controller.abort();
  }, [personScope, scope, departmentId, contactId, view.month, view.offset]);

  return <section aria-label="Service workload">
    <h3>Service workload</h3>
    {summary && <div className="module-tabs" role="group" aria-label="Assignment month">
      {summary.months.map((month) => <button key={month.month} type="button" aria-pressed={month.month === (workload?.selectedMonth ?? (view.month || summary.selectedMonth))}
        onClick={() => setView({ month: month.month, offset: 0 })}>
        <strong>{monthFormat.format(new Date(month.month + "-01T12:00:00Z"))}</strong>{" · "}
        <span>{month.confirmed} confirmed · {month.requested} requested · {month.declined} declined</span>
      </button>)}
    </div>}
    {error ? <p role="alert">{error}</p> : !workload
      ? <p role="status">Loading service assignments…</p>
      : <>
        <p>Counts are by assigned role. Cancelled events are excluded.</p>
        {workload.assignments.length ? <ul aria-label="Service assignments">
          {workload.assignments.map((assignment) => <li key={assignment.eventId + ":" + assignment.positionIndex}>
            {onNavigateEntity ? <button type="button" className="button button-secondary" onClick={() => onNavigateEntity("event", assignment.eventId)}>{assignment.title}</button> : <strong>{assignment.title}</strong>}
            {" · "}{dateFormat.format(new Date(assignment.eventDate + "T12:00:00Z"))}{" · "}{assignment.role || "Unnamed role"}
            {assignment.category && " · " + assignment.category}{" · "}{statusLabels[assignment.status]}
          </li>)}
        </ul> : <p>No recorded assignments in this month.</p>}
        {workload.total > workload.pageSize && <nav className="module-toolbar" aria-label="Service assignment pages">
          <button type="button" disabled={!workload.offset} onClick={() => setView({ month: workload.selectedMonth, offset: Math.max(0, workload.offset - workload.pageSize) })}>Previous page</button>
          <span>{workload.offset + 1}–{Math.min(workload.offset + workload.pageSize, workload.total)} of {workload.total}</span>
          <button type="button" disabled={workload.offset + workload.pageSize >= workload.total} onClick={() => setView({ month: workload.selectedMonth, offset: workload.offset + workload.pageSize })}>Next page</button>
        </nav>}
      </>}
  </section>;
}
