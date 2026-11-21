import type { ServiceEvent, ServicePlanItem } from "@smart-church/contracts";

function timeInMinutes(value?: string) {
  if (!value || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) return null;
  return Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
}

type TimedRunSheetItem = { item: ServicePlanItem; start: number; end: number };
export function timedRunSheet(event: ServiceEvent): TimedRunSheetItem[] {
  const eventStart = event.isAllDay ? null : timeInMinutes(event.startTime);
  const endOnClock = event.isAllDay ? null : timeInMinutes(event.endTime ?? undefined);
  const overnightEnd = eventStart !== null && endOnClock !== null && endOnClock < eventStart
    ? endOnClock : null;
  const eventEnd = overnightEnd === null ? endOnClock : overnightEnd + 1440;
  const scheduled = (event.timePlan ?? []).flatMap((item) => {
    const onClock = timeInMinutes(item.startTime);
    if (onClock === null) return [];
    const start = overnightEnd !== null && onClock <= overnightEnd ? onClock + 1440 : onClock;
    return [{ item, start }];
  }).sort((left, right) => left.start - right.start);
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
