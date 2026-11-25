import { useEffect, useRef, useState } from "react";

type Scope = "occurrence" | "future" | "series";
type Impact = { scope: Scope; canRelease: boolean; confirmed: number; pending: number; protectedCount: number; revision?: string };

export function CalendarRemoval({ appointmentId, scope, original, departmentId, csrfToken, busy, onBusy, onBack, onRemoved }: {
  appointmentId: string; scope: Scope; original: string; departmentId: string; csrfToken: string;
  busy: boolean; onBusy: (busy: boolean) => void; onBack: () => void; onRemoved: (released: number) => void;
}) {
  const [impact, setImpact] = useState<Impact>();
  const [policy, setPolicy] = useState<"keep" | "release">();
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const active = useRef<AbortController | null>(null);
  const base = "/api/modules/church-calendar/appointments/" + appointmentId;
  const search = new URLSearchParams({ scope, occurrenceStartAt: original }).toString();

  useEffect(() => {
    const controller = new AbortController();
    setImpact(undefined); setPolicy(undefined); setError("");
    void fetch(base + "?" + search, { headers: { "x-department-id": departmentId }, cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = await response.json() as Impact & { error?: string };
        if (!response.ok) throw new Error(body.error ?? "Removal details could not be loaded.");
        if (!controller.signal.aborted) setImpact(body);
      }).catch((reason) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Removal details could not be loaded.");
      });
    return () => { controller.abort(); active.current?.abort(); };
  }, [base,search,departmentId,reload]);

  async function remove() {
    if (!impact || busy) return;
    const canChoose = impact.canRelease && impact.confirmed + impact.pending > 0;
    if (canChoose && !policy) return;
    const controller = new AbortController();
    active.current = controller;
    const query = new URLSearchParams(search);
    query.set("reservationPolicy", policy ?? "keep");
    if (policy === "release" && impact.revision) query.set("impactRevision", impact.revision);
    onBusy(true);
    setError("");
    try {
      const response = await fetch(base + "?" + query, {
        method: "DELETE", headers: { "x-department-id": departmentId, "x-csrf-token": csrfToken }, signal: controller.signal,
      });
      const body = await response.json() as { released?: number; error?: string };
      if (!response.ok) throw new Error(body.error ?? "The appointment could not be removed.");
      if (!controller.signal.aborted) onRemoved(body.released ?? 0);
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "The appointment could not be removed.");
    } finally {
      onBusy(false);
    }
  }

  const canChoose = impact?.canRelease && impact.confirmed + impact.pending > 0;
  const scopeLabel = impact?.scope === "future" ? "Remove this and following occurrences" : impact?.scope === "occurrence"
    ? "Remove this occurrence" : "Remove the appointment";
  return <section className="church-calendar-extra-date wide" aria-label="Review appointment removal">
    <strong>{scopeLabel}</strong>
    {!impact && !error && <p role="status">Checking affected reservations…</p>}
    {canChoose && impact && <fieldset disabled={busy}>
      <legend>Resource reservations</legend>
      <p>{impact.confirmed} confirmed and {impact.pending} pending reservations are eligible for release.</p>
      <label><input type="radio" name="calendar-reservation-policy" checked={policy === "keep"} onChange={() => setPolicy("keep")} /> Keep reservations in Resources</label>
      <label><input type="radio" name="calendar-reservation-policy" checked={policy === "release"} onChange={() => setPolicy("release")} /> Release eligible reservations</label>
    </fieldset>}
    {!!impact?.protectedCount && <p>Manage {impact.protectedCount} shared or series-wide reservations separately in Resources.</p>}
    {impact && !impact.canRelease && <p>Manage resource reservations separately in Resources.</p>}
    {error && <p role="alert">{error}</p>}
    <div className="form-actions">
      <button type="button" className="button button-secondary" disabled={busy} onClick={onBack}>Back</button>
      {error && <button type="button" className="button button-secondary" disabled={busy} onClick={() => setReload((value) => value + 1)}>Review again</button>}
      <button type="button" className="button button-danger" disabled={busy || !impact || (canChoose && !policy) || !!error}
        onClick={() => void remove()}>Confirm removal</button>
    </div>
  </section>;
}
