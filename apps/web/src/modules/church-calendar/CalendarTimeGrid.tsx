import { Plus } from "lucide-react";
import { useLayoutEffect, useRef, type CSSProperties } from "react";

type GridEvent = {
  id: string; startsAt: string; endsAt: string; allDay?: boolean;
  title: string; time: string; detail?: string; color?: string; open: () => void;
};
type GridDay = { date: string; label: string; add: () => void };
const minutesPerDay = 24 * 60;
const hours = Array.from({ length: 24 }, (_, hour) => hour);
const minute = (timestamp: string) =>
  Number(timestamp.slice(11, 13)) * 60 + Number(timestamp.slice(14, 16)) + (Number(timestamp.slice(17, 19)) || 0) / 60;

export function layoutCalendarDay(date: string, events: GridEvent[]) {
  const timed = events.flatMap((event) => {
    if (event.allDay) return [];
    const firstDay = event.startsAt.slice(0, 10);
    const lastDay = event.endsAt.slice(0, 10);
    if (date < firstDay || date > lastDay || (date !== firstDay && date === lastDay && minute(event.endsAt) === 0)) return [];
    const start = firstDay === date ? minute(event.startsAt) : 0;
    const end = Math.min(minutesPerDay, Math.max(start + 20, lastDay === date ? minute(event.endsAt) : minutesPerDay));
    return [{ event, start, end, lane: 0, lanes: 1 }];
  }).sort((left, right) => left.start - right.start || right.end - left.end || left.event.id.localeCompare(right.event.id));
  let groupStart = 0;
  let groupEnd = 0;
  let laneEnds: number[] = [];
  function finishGroup(index: number) {
    for (const entry of timed.slice(groupStart, index)) entry.lanes = laneEnds.length;
    groupStart = index;
    groupEnd = 0;
    laneEnds = [];
  }
  timed.forEach((entry, index) => {
    if (entry.start >= groupEnd) finishGroup(index);
    const free = laneEnds.findIndex((end) => end <= entry.start);
    entry.lane = free < 0 ? laneEnds.length : free;
    laneEnds[entry.lane] = entry.end;
    groupEnd = Math.max(groupEnd, entry.end);
  });
  finishGroup(timed.length);
  return {
    timed,
    allDay: events.filter((event) => event.allDay && event.startsAt.slice(0, 10) <= date
      && (date < event.endsAt.slice(0, 10) || date === event.startsAt.slice(0, 10))),
  };
}

function GridButton({ event, className, style, showTime = true }: {
  event: GridEvent; className?: string; style?: CSSProperties; showTime?: boolean;
}) {
  const text = [event.time, event.title].join(" ");
  const label = [text, event.detail].filter(Boolean).join(" · ");
  return <button type="button" title={label} aria-label={label} className={["church-calendar-grid-event", className].filter(Boolean).join(" ")}
    style={{ "--calendar-accent": event.color ?? "#3b82f6", ...style } as CSSProperties} onClick={event.open}>
    <strong>{showTime ? text : event.title}</strong>
    {event.detail && <span>{event.detail}</span>}
  </button>;
}

export function CalendarTimeGrid({ days, events, formatHour }: {
  days: GridDay[]; events: GridEvent[]; formatHour: (hour: number) => string;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const timeline = useRef<HTMLDivElement>(null);
  const columns = days.map((day) => ({ ...day, ...layoutCalendarDay(day.date, events) }));
  const firstStart = Math.min(8 * 60, ...columns.flatMap(({ timed }) => timed.map(({ start }) => start)));
  useLayoutEffect(() => {
    if (scroller.current && timeline.current) {
      scroller.current.scrollTop = firstStart / minutesPerDay * timeline.current.offsetHeight;
    }
  }, [days[0]?.date, firstStart]);
  return <div className="church-calendar-time-scroll" ref={scroller} aria-label="Hourly calendar">
    <div className="church-calendar-time-grid" style={{ "--calendar-grid-days": days.length } as CSSProperties}>
      <div className="church-calendar-time-headers">
        <span aria-hidden="true" />
        {columns.map(({ date, label, add }) => <header key={date}><strong>{label}</strong>
          <button type="button" onClick={add} aria-label={"New appointment " + date}><Plus size={14} /></button>
        </header>)}
      </div>
      <div className="church-calendar-time-all-day">
        <span>All day</span>
        {columns.map(({ date, allDay }) => <div key={date}>{allDay.map((event) =>
          <GridButton key={event.id} event={event} showTime={false} />)}</div>)}
      </div>
      <div className="church-calendar-time-body" ref={timeline}>
        <div className="church-calendar-time-hours" aria-hidden="true">{hours.map((hour) => <div key={hour}>{formatHour(hour)}</div>)}</div>
        {columns.map(({ date, label, timed }) => <div className="church-calendar-time-day" key={date} aria-label={label} role="group">
          {timed.map(({ event, start, end, lane, lanes }) => <GridButton key={event.id} event={event} className="church-calendar-timed-event"
            style={{ top: (start / minutesPerDay * 100) + "%", height: ((end - start) / minutesPerDay * 100) + "%",
              left: (lane / lanes * 100) + "%", width: (100 / lanes) + "%" }} />)}
        </div>)}
      </div>
    </div>
  </div>;
}
