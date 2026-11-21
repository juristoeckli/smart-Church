import { useEffect, useMemo, useState } from "react";
import type { ServiceEvent, ServicePlanItem } from "@smart-church/contracts";

function timeInMinutes(value?: string) {
  if (!value || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) return null;
  return Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
}

function localMinutesFromEventDate(clock: Intl.DateTimeFormat, date: Date, eventDate: string) {
  const parts = Object.fromEntries(clock.formatToParts(date).map(({ type, value }) => [type, value]));
  const local = Date.parse(parts.year + "-" + parts.month + "-" + parts.day + "T00:00:00Z");
  const serviceDay = Date.parse(eventDate + "T00:00:00Z");
  return (local - serviceDay) / 60_000 + Number(parts.hour) * 60 + Number(parts.minute);
}

type TimedRunSheetItem = { item: ServicePlanItem; start: number; end: number };
export function timedRunSheet(event: ServiceEvent): TimedRunSheetItem[] {
  const scheduled = (event.timePlan ?? []).flatMap((item) => {
    const start = timeInMinutes(item.startTime);
    return start === null ? [] : [{ item, start }];
  }).sort((left, right) => left.start - right.start);
  const eventEnd = event.isAllDay ? null : timeInMinutes(event.endTime ?? undefined);
  return scheduled.map(({ item, start }, index) => {
    const following = scheduled[index + 1]?.start;
    const end = typeof item.durationMinutes === "number" && item.durationMinutes > 0 ? start + item.durationMinutes
      : following ?? (eventEnd !== null && eventEnd > start ? eventEnd : start);
    return { item, start, end: following === undefined ? end : Math.min(end, following) };
  });
}

export function scheduledRunSheetProgress(items: TimedRunSheetItem[], minute: number) {
  const current = items.find((entry) => entry.start <= minute && minute < entry.end);
  const next = items.find((entry) => entry.start > minute);
  return { current, next, minutesLeft: current ? current.end - minute : 0 };
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
