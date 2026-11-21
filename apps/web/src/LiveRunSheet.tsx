import { useEffect, useMemo, useState } from "react";
import type { ServiceEvent } from "@smart-church/contracts";
import { scheduledRunSheetProgress, timedRunSheet } from "./live-run-sheet-schedule";

function localMinutesFromEventDate(clock: Intl.DateTimeFormat, date: Date, eventDate: string) {
  const parts = Object.fromEntries(clock.formatToParts(date).map(({ type, value }) => [type, value]));
  const local = Date.parse(parts.year + "-" + parts.month + "-" + parts.day + "T00:00:00Z");
  const serviceDay = Date.parse(eventDate + "T00:00:00Z");
  return (local - serviceDay) / 60_000 + Number(parts.hour) * 60 + Number(parts.minute);
}

export function LiveRunSheet({ event, timeZone }: { event: ServiceEvent; timeZone: string }) {
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const rows = useMemo(() => timedRunSheet(event), [event]);
  const clock = useMemo(() => new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }), [timeZone]);

  useEffect(() => {
    if (!open) return;
    let timer: number;
    function update() {
      setNow(new Date());
      timer = window.setTimeout(update, 60_000 - Date.now() % 60_000);
    }
    update();
    return () => window.clearTimeout(timer);
  }, [open]);

  if (!rows.length || event.cancelledAt) return null;
  const { current, next, minutesLeft } = scheduledRunSheetProgress(rows, localMinutesFromEventDate(clock, now, event.eventDate));
  return <details onToggle={(change) => setOpen(change.currentTarget.open)}>
    <summary>Live run sheet</summary>
    {open && <>
      <p>Scheduled times · {timeZone}</p>
      <p role="status">{current ? <>Current item · <strong>{current.item.title}</strong></> : "No timed item is scheduled now."}</p>
      {current && <p>{minutesLeft} {minutesLeft === 1 ? "minute" : "minutes"} remaining</p>}
      {next ? <p>Next · {next.item.startTime} · <strong>{next.item.title}</strong></p> : <p>No later timed item.</p>}
    </>}
  </details>;
}
