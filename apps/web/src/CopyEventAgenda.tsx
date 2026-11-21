import { useState } from "react";
import type { ServiceEvent, ServicePlanItem } from "@smart-church/contracts";
import { translate } from "./i18n";

export function eventAgendaSources(events: ServiceEvent[], targetId: string, date: string) {
  return events.filter((event) => event.id !== targetId && event.eventDate === date && !event.cancelledAt && event.timePlan?.length);
}

export function copiedEventAgenda(items: ServicePlanItem[]): ServicePlanItem[] {
  return items.map(({ title, section, startTime, durationMinutes, songId, arrangementId }) =>
    ({ title, section, startTime, durationMinutes, songId, arrangementId }));
}

export function CopyEventAgenda({ events, targetId, date, formatTime, onCopy }: {
  events: ServiceEvent[]; targetId: string; date: string; formatTime: (event: ServiceEvent) => string;
  onCopy: (plan: ServicePlanItem[]) => void;
}) {
  const [sourceId, setSourceId] = useState("");
  const [copied, setCopied] = useState(false);
  const candidates = eventAgendaSources(events, targetId, date);
  const source = candidates.find(({ id }) => id === sourceId);
  if (!candidates.length) return null;
  return <div className="service-agenda-copy">
    <label>{translate("events.copyAgendaFrom")}<select value={source?.id ?? ""} onChange={(event) => {
      setSourceId(event.target.value);
      setCopied(false);
    }}>
      <option value="">{translate("events.copyAgendaChoose")}</option>
      {candidates.map((event) => <option key={event.id} value={event.id}>{event.title} · {formatTime(event)}</option>)}
    </select></label>
    <button className="button button-secondary" type="button" disabled={!source} onClick={() => {
      if (!source?.timePlan) return;
      onCopy(copiedEventAgenda(source.timePlan));
      setCopied(true);
    }}>{translate("events.copyAgendaDraft")}</button>
    <p>{translate("events.copyAgendaHelp")}</p>
    {copied && <p role="status">{translate("events.copyAgendaDone")}</p>}
  </div>;
}
