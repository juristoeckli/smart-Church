import { useEffect, useState } from "react";
import { zonedInputToUtc } from "../resource-scheduler/zoned-input";

type Resource = {
  id: string; name: string; location: string; active: boolean;
  totalUnits: number; defaultLeadInMinutes: number; defaultCleanupMinutes: number;
};

type Props = {
  appointmentId: string; title: string; startsAt: string; endsAt: string;
  headers: Record<string, string>; onCreated: (bookingId: string) => void;
};

export function CalendarResourceRequest({ appointmentId, title, startsAt, endsAt, headers, onCreated }: Props) {
  const [data, setData] = useState<{ resources: Resource[]; timeZone: string; canManage: boolean }>();
  const [open, setOpen] = useState(false);
  const [resourceId, setResourceId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [leadIn, setLeadIn] = useState("0");
  const [cleanup, setCleanup] = useState("0");
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
  const selected = resources.find((resource) => resource.id === resourceId);
  function selectResource(id: string) {
    const resource = resources.find((item) => item.id === id);
    setResourceId(id);
    setLeadIn(String(resource?.defaultLeadInMinutes ?? 0));
    setCleanup(String(resource?.defaultCleanupMinutes ?? 0));
    setQuantity("1");
  }
  async function book() {
    if (!selected || !data?.canManage || busy) return;
    const units = Number(quantity), before = Number(leadIn), after = Number(cleanup);
    if (!quantity.trim() || !leadIn.trim() || !cleanup.trim() || !Number.isInteger(units) || units < 1 || units > selected.totalUnits
        || ![before, after].every((minutes) => Number.isInteger(minutes) && minutes >= 0 && minutes <= 10080)) {
      setError("Enter a valid quantity and setup and cleanup times.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/modules/resource-scheduler/series", {
        method: "POST",
        headers,
        body: JSON.stringify({
          resourceId, purpose: title, quantity: units, leadInMinutes: before, cleanupMinutes: after,
          startsAt: zonedInputToUtc(startsAt.slice(0, 16), data.timeZone),
          endsAt: zonedInputToUtc(endsAt.slice(0, 16), data.timeZone),
          linkedAppointmentId: appointmentId,
        }),
      });
      const body = await response.json() as { error?: string; bookingIds?: string[] };
      if (!response.ok) throw new Error(body.error ?? "Could not reserve this resource.");
      if (!body.bookingIds?.[0]) throw new Error("The booking response was incomplete. Reload before trying again.");
      onCreated(body.bookingIds[0]);
      setOpen(false);
      selectResource("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not reserve this resource.");
    } finally {
      setBusy(false);
    }
  }
  return <div className="church-calendar-extra-date wide">
    {!open ? <button type="button" className="button button-secondary" onClick={() => setOpen(true)}>Book a resource</button> : <>
      <strong>Book a resource for this occurrence</strong>
      <small>Uses the saved appointment time{data ? " in " + data.timeZone : ""}. Booking is saved separately from appointment edits.</small>
      {data?.canManage && <div>
        <label>Resource<select value={resourceId} onChange={(event) => selectResource(event.target.value)} disabled={busy}>
          <option value="">Choose a resource…</option>
          {resources.map((resource) => <option key={resource.id} value={resource.id}>{resource.name}{resource.location ? " · " + resource.location : ""}</option>)}
        </select></label>
        <label>Quantity<input type="number" min={1} max={selected?.totalUnits ?? 1} value={quantity} onChange={(event) => setQuantity(event.target.value)} disabled={busy} /></label>
        <label>Setup minutes<input type="number" min={0} max={10080} value={leadIn} onChange={(event) => setLeadIn(event.target.value)} disabled={busy} /></label>
        <label>Cleanup minutes<input type="number" min={0} max={10080} value={cleanup} onChange={(event) => setCleanup(event.target.value)} disabled={busy} /></label>
        <button type="button" className="button button-secondary" onClick={() => void book()} disabled={!selected || busy}>{busy ? "Booking…" : "Reserve and link"}</button>
      </div>}
      {!data && !error && <small>Loading resources…</small>}
      {data && !data.canManage && <small>Resource manager access is required to link a booking.</small>}
      {error && <p role="alert">{error}</p>}
    </>}
  </div>;
}
