import { useState } from "react";
import type { ServiceEvent, ServicePlanItem } from "@smart-church/contracts";
import { AgendaItemVisibility } from "./AgendaItemVisibility";
import { translate } from "./i18n";

export function SharedEventAgenda({ target, events, canManage, departmentId, csrfToken, formatTime, onChanged, onPlanChanged }: {
  target: ServiceEvent; events: ServiceEvent[]; canManage: boolean; departmentId: string; csrfToken: string;
  formatTime: (event: ServiceEvent) => string; onChanged: () => void; onPlanChanged: (plan: ServicePlanItem[]) => void;
}) {
  const [selected, select] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const current = target.sharedAgendaSourceId;
  const source = current ? events.find((event) => event.id === current) : undefined;
  const canChange = canManage && !target.cancelledAt && !target.importedFrom && !target.seriesId;
  const sources = canChange && !current && !events.some((event) => event.sharedAgendaSourceId === target.id)
    ? events.filter((event) => event.id !== target.id && !event.cancelledAt && !event.importedFrom && !event.seriesId
      && !event.sharedAgendaSourceId && event.eventDate === target.eventDate && Boolean(event.isAllDay) === Boolean(target.isAllDay) && event.timePlan?.length)
    : [];
  if (!current && !sources.length) return null;

  async function update(sourceId: string | null) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/events/" + target.id + "/shared-agenda", {
        method: "PUT", headers: { "Content-Type": "application/json", "x-department-id": departmentId, "x-csrf-token": csrfToken },
        body: JSON.stringify({ sourceId, expectedSourceId: current ?? null }),
      });
      if (!response.ok) {
        const result = await response.json() as { error?: string };
        setError(result.error ?? translate("events.sharedAgendaFailed"));
      } else {
        onChanged();
      }
    } catch {
      setError(translate("events.sharedAgendaFailed"));
    } finally {
      setBusy(false);
    }
  }

  return <section className="event-details-section">
    <h3>{translate("events.sharedAgenda")}</h3>
    {current ? <>
      <p>{translate("events.sharedAgendaSource").replace("{event}", source?.title ?? translate("events.sharedAgenda"))}</p>
      {canChange && <button type="button" className="button button-secondary" disabled={busy} onClick={() => void update(null)}>
        {translate("events.sharedAgendaUnlink")}
      </button>}
      {canChange && <AgendaItemVisibility key={current} targetId={target.id} sourceId={current}
        departmentId={departmentId} csrfToken={csrfToken} onPlanChanged={onPlanChanged} />}
    </> : <>
      <label>{translate("events.sharedAgendaChoose")}<select value={selected} disabled={busy} onChange={(event) => select(event.target.value)}>
        <option value="">{translate("events.copyAgendaChoose")}</option>
        {sources.map((event) => <option key={event.id} value={event.id}>{event.title} · {formatTime(event)}</option>)}
      </select></label>
      <p>{translate("events.sharedAgendaLinkHelp")}</p>
      <button type="button" className="button button-secondary" disabled={busy || !sources.some((event) => event.id === selected)}
        onClick={() => void update(selected)}>{translate("events.sharedAgendaLink")}</button>
    </>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
