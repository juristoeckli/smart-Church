import { useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";
import { formatUserDate } from "./date-format";
import { translate } from "./i18n";

type Assignment = { eventId: string; title: string; date: string; time: string; positionIndex: number; positionName: string };
type Swap = { id: string; eventId: string; title: string; date: string; time: string; requesterName: string; fromPositionName: string; toPositionName: string };
type DutyRequests = { assignments: Assignment[]; swaps: Swap[]; hasMore: boolean };

export function HomeDutyRequests({ departmentId, csrfToken, onOpenEvent, onOpenSchedule }: {
  departmentId: string;
  csrfToken: string;
  onOpenEvent: (id: string) => void;
  onOpenSchedule: () => void;
}) {
  const [requests, setRequests] = useState<DutyRequests>();
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ text: string; error?: boolean }>();

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/modules/notifications/home-duty-requests", {
      headers: { "x-department-id": departmentId }, signal: controller.signal,
    }).then(async (response) => {
      if (!response.ok) throw new Error(translate("overview.dutyRequestsUnavailable"));
      const result = await response.json() as DutyRequests;
      if (!controller.signal.aborted) setRequests(result);
    }).catch(() => {
      if (!controller.signal.aborted) setFeedback({ text: translate("overview.dutyRequestsUnavailable"), error: true });
    });
    return () => controller.abort();
  }, [departmentId, refresh]);

  async function respond(request: Assignment | Swap, decision: "accepted" | "declined") {
    const swap = "id" in request;
    const url = swap ? `/api/event-position-swaps/${encodeURIComponent(request.id)}`
      : `/api/events/${encodeURIComponent(request.eventId)}/positions/${request.positionIndex}/response`;
    setBusy(true);
    setFeedback(undefined);
    try {
      const response = await fetch(url, {
        method: "PUT",
        headers: { "x-department-id": departmentId, "x-csrf-token": csrfToken, "content-type": "application/json" },
        body: JSON.stringify(swap ? { decision } : { status: decision }),
      });
      if (!response.ok) {
        const problem = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(problem?.error ?? translate("overview.dutyResponseFailed"));
      }
      setRequests((current) => current && (swap
        ? { ...current, swaps: current.swaps.filter((item) => item.id !== request.id) }
        : { ...current, assignments: current.assignments.filter((item) => item.eventId !== request.eventId || item.positionIndex !== request.positionIndex) }));
      setFeedback({ text: translate(decision === "accepted" ? "overview.dutyAccepted" : "overview.dutyDeclined") });
    } catch (reason) {
      setFeedback({ text: reason instanceof Error ? reason.message : translate("overview.dutyResponseFailed"), error: true });
    } finally {
      setRefresh((value) => value + 1);
      setBusy(false);
    }
  }

  const items = [...(requests?.assignments ?? []), ...(requests?.swaps ?? [])]
    .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
  if (!items.length && !feedback) return null;

  return <section className="directory-card community-upcoming-card" aria-label={translate("overview.dutyRequests")}>
    <div className="directory-heading">
      <div><h2>{translate("overview.dutyRequests")}</h2><p>{translate("overview.dutyRequestsHelp")}</p></div>
      <button className="button button-secondary" type="button" onClick={onOpenSchedule}>{translate("overview.openCalendar")} <ArrowRight size={14} /></button>
    </div>
    {items.length > 0 && <ul className="community-upcoming-list home-duty-list" aria-busy={busy}>
      {items.map((item) => {
        const swap = "id" in item;
        return <li className="community-upcoming-item home-duty-item" key={swap ? `swap:${item.id}` : `assignment:${item.eventId}:${item.positionIndex}`}>
          <span className="community-upcoming-date">{formatUserDate(item.date)} · {item.time}</span>
          <div>
            <button className="button button-secondary" type="button" onClick={() => onOpenEvent(item.eventId)}>{item.title}</button>
            <small>{swap ? translate("overview.dutySwapDescription").replace("{person}", item.requesterName)
              .replace("{from}", item.fromPositionName).replace("{to}", item.toPositionName) : item.positionName}</small>
          </div>
          <div className="home-duty-actions">
            <button className="button button-primary" type="button" disabled={busy} onClick={() => void respond(item, "accepted")}>{translate(swap ? "overview.acceptSwap" : "overview.acceptDuty")}</button>
            <button className="button button-secondary" type="button" disabled={busy} onClick={() => void respond(item, "declined")}>{translate(swap ? "overview.declineSwap" : "overview.declineDuty")}</button>
          </div>
        </li>;
      })}
    </ul>}
    {requests?.hasMore && <p className="community-empty">{translate("overview.moreDutyRequests")}</p>}
    {feedback && <p className="community-empty" role={feedback.error ? "alert" : "status"}>{feedback.text}</p>}
  </section>;
}
