import { useEffect, useState } from "react";

type Resource = {
  id: string; name: string; location: string; active: boolean;
  totalUnits: number; defaultLeadInMinutes: number; defaultCleanupMinutes: number;
};
type Selection = { resourceId: string; quantity: string; leadInMinutes: string; cleanupMinutes: string };
type Props = {
  appointmentId: string; occurrenceStartAt: string; defaultPurpose: string; startsAt: string; endsAt: string;
  headers: Record<string, string>; onCreated: () => void;
};

export function CalendarResourceRequest({ appointmentId, occurrenceStartAt, defaultPurpose, startsAt, endsAt, headers, onCreated }: Props) {
  const [data, setData] = useState<{ resources: Resource[]; canManage: boolean }>();
  const [open, setOpen] = useState(false);
  const [selections, setSelections] = useState<Selection[]>([]);
  const [purpose, setPurpose] = useState(defaultPurpose);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const day = startsAt.slice(0, 10);
    fetch("/api/modules/resource-scheduler/bootstrap?from=" + encodeURIComponent(day) + "&to=" + encodeURIComponent(day), { headers, signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Resource Scheduler is unavailable for this location.");
        setData(await response.json());
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not load resources.");
      });
    return () => controller.abort();
  }, [headers, open, startsAt]);

  const resources = data?.resources.filter((resource) => resource.active) ?? [];
  const available = resources.filter((resource) => !selections.some((selection) => selection.resourceId === resource.id));

  function addResource(id: string) {
    const resource = available.find((item) => item.id === id);
    if (!resource || selections.length >= 20) return;
    setSelections((current) => [...current, {
      resourceId: resource.id, quantity: "1", leadInMinutes: String(resource.defaultLeadInMinutes),
      cleanupMinutes: String(resource.defaultCleanupMinutes),
    }]);
  }

  function updateResource(id: string, field: "quantity" | "leadInMinutes" | "cleanupMinutes", value: string) {
    setSelections((current) => current.map((item) => item.resourceId === id ? { ...item, [field]: value } : item));
  }

  async function book() {
    if (!selections.length || !data?.canManage || !purpose.trim() || busy) return;
    const payload = [];
    for (const selection of selections) {
      const resource = resources.find((item) => item.id === selection.resourceId);
      if (!resource) {
        setError("One of the selected resources is no longer available. Remove it before booking.");
        return;
      }
      const quantity = Number(selection.quantity);
      const leadInMinutes = Number(selection.leadInMinutes);
      const cleanupMinutes = Number(selection.cleanupMinutes);
      if (!selection.quantity.trim() || !selection.leadInMinutes.trim() || !selection.cleanupMinutes.trim()
          || !Number.isInteger(quantity) || quantity < 1 || quantity > resource.totalUnits
          || ![leadInMinutes, cleanupMinutes].every((minutes) => Number.isInteger(minutes) && minutes >= 0 && minutes <= 10080)) {
        setError(`Enter a valid quantity and setup and cleanup times for ${resource.name}.`);
        return;
      }
      payload.push({ resourceId: resource.id, quantity, leadInMinutes, cleanupMinutes });
    }
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/modules/resource-scheduler/occurrence-bookings", {
        method: "POST",
        headers,
        body: JSON.stringify({
          purpose: purpose.trim(), startsAt, endsAt, resources: payload,
          linkedAppointmentId: appointmentId, linkedOccurrenceStartAt: occurrenceStartAt,
        }),
      });
      const body = await response.json() as { error?: string; bookings?: { bookingId: string }[] };
      if (!response.ok) throw new Error(body.error ?? "Could not reserve these resources.");
      if (body.bookings?.length !== payload.length) throw new Error("The booking response was incomplete. Reload before trying again.");
      onCreated();
      setOpen(false);
      setSelections([]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not reserve these resources.");
    } finally {
      setBusy(false);
    }
  }

  return <div className="church-calendar-extra-date wide">
    {!open ? <button type="button" className="button button-secondary" onClick={() => { setOpen(true); setError(""); }}>Book resources</button> : <>
      <strong>Book resources for this occurrence</strong>
      <small>Uses the saved appointment time. Resources are booked together when all selected resources are available.</small>
      {data?.canManage && <div>
        <label>Booking purpose<input value={purpose} onChange={(event) => setPurpose(event.target.value)} maxLength={240} disabled={busy} /><small>Shown in Resource Scheduler.</small></label>
        <label>Add a resource<select value="" onChange={(event) => addResource(event.target.value)} disabled={busy || !available.length || selections.length >= 20}>
          <option value="">{selections.length >= 20 ? "20-resource limit reached" : available.length ? "Choose a resource…" : "No more resources available"}</option>
          {available.map((resource) => <option key={resource.id} value={resource.id}>{resource.name}{resource.location ? " · " + resource.location : ""}</option>)}
        </select></label>
        {selections.map((selection) => {
          const resource = resources.find((item) => item.id === selection.resourceId);
          return <fieldset key={selection.resourceId} className="church-calendar-extra-date">
            <legend>{resource?.name ?? "Unavailable resource"}</legend>
            <label>Quantity<input type="number" min={1} max={resource?.totalUnits ?? 1} value={selection.quantity} onChange={(event) => updateResource(selection.resourceId, "quantity", event.target.value)} disabled={busy} /></label>
            <label>Setup minutes<input type="number" min={0} max={10080} value={selection.leadInMinutes} onChange={(event) => updateResource(selection.resourceId, "leadInMinutes", event.target.value)} disabled={busy} /></label>
            <label>Cleanup minutes<input type="number" min={0} max={10080} value={selection.cleanupMinutes} onChange={(event) => updateResource(selection.resourceId, "cleanupMinutes", event.target.value)} disabled={busy} /></label>
            <button type="button" className="button button-secondary" onClick={() => setSelections((current) => current.filter((item) => item.resourceId !== selection.resourceId))} disabled={busy} aria-label={`Remove ${resource?.name ?? "unavailable resource"}`}>Remove</button>
          </fieldset>;
        })}
        <button type="button" className="button button-secondary" onClick={() => void book()} disabled={!selections.length || !purpose.trim() || busy}>{busy ? "Booking…" : "Reserve and link"}</button>
      </div>}
      {!data && !error && <small>Loading resources…</small>}
      {data && !data.canManage && <small>Resource manager access is required to link a booking.</small>}
      {error && <p role="alert">{error}</p>}
    </>}
  </div>;
}
