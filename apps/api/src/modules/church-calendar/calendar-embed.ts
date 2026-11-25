import { addDays, localDateTime, wallDate } from "../../calendar-occurrences.js";

export const calendarEmbedContentPolicy = "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors *; sandbox; base-uri 'none'; form-action 'none'";

type CalendarPeriod = "day" | "week" | "month";
export type EmbedSettings = {
  days?: number; entries?: number; searchEntry?: string; title?: string; darkmode?: boolean;
  viewname?: "eventView" | "calView"; period?: CalendarPeriod; date?: string; startdate?: string; enddate?: string;
  category_id?: string; category_select?: string;
};
const dayKey = (date: Date) => localDateTime(date).slice(0, 10);

export function publicEmbedDateRange(today: string, settings: EmbedSettings) {
  const { startdate, enddate, days = 60, viewname } = settings;
  const from = startdate && startdate > today ? startdate : today;
  const horizon = dayKey(addDays(wallDate(today + "T00:00:00"), 366));
  if (from > horizon) return { from, to: horizon };
  const limit = viewname === "calView" ? horizon : dayKey(addDays(wallDate(from + "T00:00:00"), (enddate ? 120 : days) - 1));
  const to = [enddate ?? horizon, limit, horizon].sort()[0];
  return { from, to };
}

export function publicEmbedCalendarWindow(today: string, settings?: EmbedSettings) {
  if (settings?.viewname !== "calView") return null;
  const { period = "month" } = settings;
  const { from: first, to: last } = publicEmbedDateRange(today, settings);
  const expired = first > last;
  if (settings.date && (settings.date < first || settings.date > last)) return null;
  const anchor = settings.date ?? (expired ? today : first);
  const date = wallDate(anchor + "T00:00:00");
  let start = date;
  let end = date;
  if (period === "week") {
    start = addDays(date, -((date.getUTCDay() + 6) % 7));
    end = addDays(start, 6);
  } else if (period === "month") {
    start = addDays(date, 1 - date.getUTCDate());
    const nextMonth = new Date(start);
    nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
    end = addDays(nextMonth, -1);
  }
  const bound = (value: string) => value < first ? first : value > last ? last : value;
  const previous = dayKey(addDays(start, -1));
  const next = dayKey(addDays(end, 1));
  return { period, anchor, today, first: expired ? null : first, start, end,
    from: expired ? first : bound(dayKey(start)), to: expired ? last : bound(dayKey(end)),
    previous: !expired && previous >= first ? previous : null, next: !expired && next <= last ? next : null };
}
export type EmbedAppointment = {
  id: string; originalStart: string; startsAt: string; endsAt: string; allDay: boolean; title: string; subtitle: string; place: string;
  calendarName?: string; calendarOrder?: number;
};

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}

type CalendarChoice = { id: string; name: string };
export function publicEmbedCalendarSelection(calendars: CalendarChoice[], { category_id, category_select }: EmbedSettings) {
  const identifiers = (value: string) => new Set(value.toLowerCase().split(","));
  const allowed = category_id === undefined ? null : identifiers(category_id);
  const selected = category_select === undefined ? null : identifiers(category_select);
  const choices = allowed ? calendars.filter(({ id }) => allowed.has(id)) : calendars;
  return { choices, selectedIds: choices.filter(({ id }) => !selected || selected.has(id)).map(({ id }) => id) };
}

function embedNavigation(settings: EmbedSettings) {
  const keys = ["viewname", "period", "date", "title", "searchEntry", "entries", "days", "darkmode", "startdate", "enddate", "category_id", "category_select"] as const;
  const query = new URLSearchParams();
  for (const key of keys) {
    const value = settings[key];
    if (value !== undefined) query.set(key, String(value));
  }
  return escapeHtml("?" + query);
}

function renderCalendarSelector(selection: ReturnType<typeof publicEmbedCalendarSelection>, settings: EmbedSettings) {
  if (selection.choices.length < 2) return "";
  const selected = new Set(selection.selectedIds);
  return `<nav class="calendar-nav" aria-label="Show or hide calendars">${selection.choices.map(({ id, name }) => {
    const visible = selected.has(id);
    const next = selection.choices.filter((choice) => choice.id === id ? !visible : selected.has(choice.id)).map((choice) => choice.id);
    return `<a href="${embedNavigation({ ...settings, category_select: next.join(",") })}">${visible ? "Hide" : "Show"} ${escapeHtml(name)}</a>`;
  }).join("")}</nav>`;
}

function renderCalendarGrid(window: NonNullable<ReturnType<typeof publicEmbedCalendarWindow>>, days: Map<string, EmbedAppointment[]>,
  timeLabel: Intl.DateTimeFormat, settings: EmbedSettings) {
  const navigation = (period: CalendarPeriod, date: string) => embedNavigation({ ...settings, viewname: "calView", period, date });
  const headings = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  const label = new Intl.DateTimeFormat("en", { dateStyle: "full", timeZone: "UTC" });
  const month = new Intl.DateTimeFormat("en", { month: "long", year: "numeric", timeZone: "UTC" });
  const title = window.period === "month" ? month.format(window.start) : window.period === "week"
    ? label.formatRange(window.start, window.end) : label.format(window.start);
  const cells: string[] = [];
  if (window.period === "month") {
    const leading = (window.start.getUTCDay() + 6) % 7;
    for (let i = 0; i < leading; i++) cells.push('<div class="calendar-date calendar-spacer" aria-hidden="true"></div>');
  }
  for (let date = window.start; date <= window.end; date = addDays(date, 1)) {
    const key = dayKey(date);
    const items = days.get(key) ?? [];
    cells.push(`<section class="calendar-date"><h3><time datetime="${key}" aria-label="${escapeHtml(label.format(date))}"${key === window.today ? ' aria-current="date"' : ""}>${date.getUTCDate()}</time></h3>
      ${items.length ? `<ul>${items.map((item) => `<li>${item.allDay ? "All day" : escapeHtml(timeLabel.format(new Date(item.startsAt + "Z")))} <strong>${escapeHtml(item.title)}</strong>
        ${item.calendarName ? `<small>${escapeHtml(item.calendarName)}</small>` : ""}${item.subtitle ? `<small>${escapeHtml(item.subtitle)}</small>` : ""}${item.place ? `<small>${escapeHtml(item.place)}</small>` : ""}</li>`).join("")}</ul>` : ""}</section>`);
  }
  return `${window.first ? `<nav class="calendar-nav" aria-label="Calendar view">${(["day", "week", "month"] as const).map((period) =>
    `<a href="${navigation(period, window.anchor)}"${period === window.period ? ' aria-current="page"' : ""}>${period[0].toUpperCase() + period.slice(1)}</a>`).join("")}
    ${window.previous ? `<a href="${navigation(window.period, window.previous)}">Previous</a>` : ""}
    <a href="${navigation(window.period, window.first)}">${window.first === window.today ? "Today" : "Start of range"}</a>
    ${window.next ? `<a href="${navigation(window.period, window.next)}">Next</a>` : ""}</nav>` : ""}
    <h2>${escapeHtml(title)}</h2>
    ${days.size ? "" : "<p>No upcoming appointments in this view.</p>"}
    <div class="calendar-grid ${window.period === "day" ? "calendar-day" : ""}">${window.period === "day" ? "" : headings.map((name) =>
      `<div class="calendar-weekday" aria-hidden="true">${name.slice(0, 3)}</div>`).join("")}${cells.join("")}</div>`;
}

function searchText(value: string) {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
}

export function renderCalendarEmbed(calendarName: string, appointments: EmbedAppointment[], timeZone: string, settings: EmbedSettings, grid?: NonNullable<ReturnType<typeof publicEmbedCalendarWindow>>, calendarSelection?: ReturnType<typeof publicEmbedCalendarSelection>) {
  const { entries = 20, searchEntry = "", darkmode = false } = settings;
  const title = settings.title?.trim() || calendarName;
  const terms = grid ? [] : searchEntry.split(",").map((value) => searchText(value.trim())).filter(Boolean);
  const matching = terms.length ? appointments.filter((appointment) => {
    const fields = [appointment.title, appointment.subtitle, appointment.place].map(searchText);
    return terms.some((term) => fields.some((field) => field.includes(term)));
  }) : appointments;
  const dayHeading = new Intl.DateTimeFormat("en", { dateStyle: "full", timeZone: "UTC" });
  const timeLabel = new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit", timeZone: "UTC" });
  const days = new Map<string, EmbedAppointment[]>();
  for (const appointment of matching.sort((left, right) => left.startsAt.localeCompare(right.startsAt)
    || (left.calendarOrder ?? 0) - (right.calendarOrder ?? 0) || left.title.localeCompare(right.title) || left.id.localeCompare(right.id) || left.originalStart.localeCompare(right.originalStart)).slice(0, grid ? undefined : entries)) {
    const day = appointment.startsAt.slice(0, 10);
    const items = days.get(day) ?? [];
    items.push(appointment);
    days.set(day, items);
  }
  const schedule = grid ? renderCalendarGrid(grid, days, timeLabel, settings) : [...days].map(([day, items]) => `
    <section><h2><time datetime="${escapeHtml(day)}">${escapeHtml(dayHeading.format(new Date(day + "T00:00:00Z")))}</time></h2>
    <ol>${items.map((item) => {
      const timing = item.allDay ? "All day" : `${timeLabel.format(new Date(item.startsAt + "Z"))}–${timeLabel.format(new Date(item.endsAt + "Z"))}`;
      return `<li><time datetime="${escapeHtml(item.startsAt)}">${escapeHtml(timing)}</time><div><strong>${escapeHtml(item.title)}</strong>
        ${item.calendarName ? `<div>${escapeHtml(item.calendarName)}</div>` : ""}${item.subtitle ? `<div>${escapeHtml(item.subtitle)}</div>` : ""}${item.place ? `<div>${escapeHtml(item.place)}</div>` : ""}</div></li>`;
    }).join("")}</ol></section>`).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title><style>
:root{font-family:system-ui,sans-serif;color-scheme:${darkmode ? "only dark;background:Canvas;color:CanvasText" : "light dark"}}
body{margin:0;padding:clamp(.75rem,3vw,1.5rem)}main{max-width:52rem;margin:auto}
h1{margin:0;font-size:1.5rem}h2{font-size:1rem;margin:1.3rem 0 .35rem}
p{margin:.25rem 0 .5rem}ol{list-style:none;padding:0;margin:0}
li{display:grid;grid-template-columns:minmax(5.25rem,9rem) minmax(0,1fr);gap:.85rem;padding:.6rem 0;border-top:1px solid GrayText}
li>div{overflow-wrap:anywhere}
.calendar-nav{display:flex;flex-wrap:wrap;gap:.8rem;margin-block:1rem}.calendar-nav [aria-current]{font-weight:bold}
.calendar-grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:1px;background:GrayText;border:1px solid GrayText}
.calendar-day{grid-template-columns:1fr}.calendar-weekday,.calendar-date{background:Canvas;color:CanvasText;padding:.35rem}.calendar-date{min-height:3.5rem;overflow-wrap:anywhere}.calendar-date h3{font-size:.9rem;margin:0}.calendar-date ul{list-style:none;padding:0;margin:0}.calendar-date li{display:block;font-size:.8rem;padding:.3rem 0}.calendar-date small{display:block}.calendar-date time[aria-current]{text-decoration:underline}
@media(max-width:32rem){.calendar-grid{grid-template-columns:1fr}.calendar-weekday,.calendar-spacer{display:none}.calendar-date{min-height:0}.calendar-date h3 time::after{content:" · " attr(aria-label)}}
</style></head><body><main><h1>${escapeHtml(title)}</h1><p>Times shown in ${escapeHtml(timeZone)}</p>
${calendarSelection ? renderCalendarSelector(calendarSelection, settings) : ""}
${schedule || (terms.length ? "<p>No upcoming appointments match the search terms.</p>" : "<p>No upcoming appointments.</p>")}</main></body></html>`;
}
