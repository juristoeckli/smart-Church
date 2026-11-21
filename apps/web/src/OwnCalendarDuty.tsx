import type { ServiceEvent } from "@smart-church/contracts";
import { translate } from "./i18n";

export function OwnCalendarDuty({ event }: { event: ServiceEvent }) {
  if (event.cancelledAt) return null;
  const own = event.positions?.filter((position) => position.canRespond) ?? [];
  const confirmed = own.some((position) => position.responseStatus === "accepted");
  const requested = own.some((position) => (position.responseStatus ?? "pending") === "pending");
  if (!confirmed && !requested) return null;
  return <span className="schedule-calendar-own-duty">
    {confirmed && <span className="is-confirmed">{translate("events.ownDutyConfirmed")}</span>}
    {requested && <span className="is-requested">{translate("events.ownDutyRequested")}</span>}
  </span>;
}
