import { useEffect, useState } from "react";

type Resource = {
  id: string; name: string; location: string; active: boolean; intakeOnly?: boolean;
  requires_approval?: boolean; managerBookingOnly?: boolean;
  totalUnits: number; defaultLeadInMinutes: number; defaultCleanupMinutes: number;
};

export type CalendarDraftResource = {
  resourceId: string; quantity: number; leadInMinutes: number; cleanupMinutes: number;
};

export function CalendarDraftResources({ draftDate, headers, selections, onChange, disabled }: {
  draftDate: string; headers: Record<string, string>; selections: CalendarDraftResource[];
  onChange: (items: CalendarDraftResource[]) => void; disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<{ resources: Resource[]; canManage: boolean }>();
  const [error, setError] = useState("");
  const day = draftDate.slice(0, 10);

  useEffect(() => {
    if (!open || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return;
    const controller = new AbortController();
    setError("");
    const query = new URLSearchParams({ from: day, to: day });
    void fetch("/api/modules/resource-scheduler/bootstrap?" + query, { headers, signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Resource Scheduler is unavailable for this location.");
        const value = await response.json() as { resources: Resource[]; canManage: boolean };
        if (!controller.signal.aborted) setData(value);
      }).catch(() => {
        if (!controller.signal.aborted) { setData(undefined); setError("The resource list could not be loaded."); }
      });
    return () => controller.abort();
  }, [day, headers, open]);

  const resources = data?.resources.filter((resource) => resource.active && !resource.intakeOnly && (!resource.managerBookingOnly || data.canManage)) ?? [];
  const available = resources.filter((resource) => !selections.some((selection) => selection.resourceId === resource.id));

  function add(id: string) {
    const resource = available.find((choice) => choice.id === id);
    if (!resource || disabled || selections.length >= 20) return;
    onChange([...selections, {
      resourceId: id, quantity: 1,
      leadInMinutes: resource.defaultLeadInMinutes, cleanupMinutes: resource.defaultCleanupMinutes,
    }]);
  }

  function update(id: string, field: "quantity" | "leadInMinutes" | "cleanupMinutes", value: number) {
    onChange(selections.map((selection) => selection.resourceId === id ? { ...selection, [field]: value } : selection));
  }

  if (!open) return <div className="wide"><button type="button" className="button button-secondary"
    disabled={disabled || !day} onClick={() => setOpen(true)}>Book resources with this appointment</button></div>;
  return <section className="church-calendar-extra-date wide" aria-label="Book resources with this appointment">
    <strong>New resource bookings</strong>
    <small>Resources are requested for the appointment’s start and end. Availability is checked when you save.</small>
    {error && <p role="alert">{error}</p>}
    {!data && !error && <p role="status">Loading resources…</p>}
    {data && <label>Add resource<select value="" disabled={disabled || !available.length || selections.length >= 20} onChange={(event) => add(event.target.value)}>
      <option value="">{available.length ? "Choose a resource" : "No more eligible resources"}</option>
      {available.map((resource) => <option value={resource.id} key={resource.id}>
        {resource.name}{resource.location ? " · " + resource.location : ""}
      </option>)}
    </select></label>}
    {selections.map((choice) => {
      const resource = resources.find(({ id }) => id === choice.resourceId);
      return <fieldset key={choice.resourceId} disabled={disabled} className="church-calendar-form-grid">
        <legend>{resource?.name ?? "Unavailable resource"}</legend>
        <label>Quantity<input type="number" min={1} max={resource?.totalUnits ?? 10000} required value={choice.quantity || ""}
          onChange={(event) => update(choice.resourceId, "quantity", Number(event.target.value))} /></label>
        <label>Setup minutes<input type="number" min={0} max={10080} required value={choice.leadInMinutes}
          onChange={(event) => update(choice.resourceId, "leadInMinutes", Number(event.target.value))} /></label>
        <label>Cleanup minutes<input type="number" min={0} max={10080} required value={choice.cleanupMinutes}
          onChange={(event) => update(choice.resourceId, "cleanupMinutes", Number(event.target.value))} /></label>
        {resource && <small>{resource.requires_approval && !data?.canManage ? "Requires approval" : "Automatically confirmed if available"}</small>}
        <button type="button" className="button button-secondary" onClick={() => onChange(selections.filter(({ resourceId }) => resourceId !== choice.resourceId))}>Remove resource</button>
      </fieldset>;
    })}
    <button type="button" className="button button-secondary" disabled={disabled} onClick={() => {
      onChange([]); setOpen(false); setData(undefined);
    }}>Clear resource bookings</button>
  </section>;
}
