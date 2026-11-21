import { printHtml } from "../../service-exports";

type PrintableAppointment = {
  date: string;
  time: string;
  title: string;
  subtitle: string;
  calendarName: string;
  place: string;
};
type PrintView = "day" | "week" | "month" | "year" | "list";
type PrintOptions = {
  view: PrintView;
  title: string;
  from: string;
  through: string;
  locale: string;
  calendarNames: string[];
  appointments: PrintableAppointment[];
};

export function calendarPrintDocument({ view, title, from, through, locale, calendarNames, appointments }: PrintOptions) {
  const grid = view === "week" || view === "month";
  const date = (day: string) => new Date(`${day}T12:00:00Z`);
  const formatted = (day: string, options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(locale, { ...options, timeZone: "UTC" }).format(date(day));
  const longDate = (day: string) => formatted(day, { dateStyle: "long" });
  const byDate = new Map<string, PrintableAppointment[]>();
  for (const appointment of appointments) {
    if (appointment.date < from || appointment.date > through) continue;
    const group = byDate.get(appointment.date) ?? [];
    group.push(appointment);
    byDate.set(appointment.date, group);
  }
  const appointmentItems = (items: PrintableAppointment[]) => items.map((item) => `<li>
    <span class="time">${printHtml(item.time)}</span> <strong>${printHtml(item.title)}</strong>
    ${item.subtitle ? `<div>${printHtml(item.subtitle)}</div>` : ""}
    <small>${printHtml([item.calendarName, item.place].filter(Boolean).join(" · "))}</small>
  </li>`).join("");
  const list = (appointments: PrintableAppointment[]) => `<ul>${appointmentItems(appointments)}</ul>`;
  let body = "";
  if (grid) {
    const pluralDays = view === "week" ? 7 : 42;
    const start = date(from);
    const days = Array.from({ length: pluralDays }, (_, index) => {
      const day = new Date(start);
      day.setUTCDate(day.getUTCDate() + index);
      return day.toISOString().slice(0, 10);
    });
    const row = (week: string[]) => `<tr>${week.map((day) => `<td><div class="date">${printHtml(formatted(day, { day: "numeric", month: "short" }))}</div>
      ${byDate.has(day) ? list(byDate.get(day)!) : ""}</td>`).join("")}</tr>`;
    const headings = days.slice(0, 7).map((day) => `<th scope="col">${printHtml(formatted(day, { weekday: "short" }))}</th>`).join("");
    const rows = Array.from({ length: pluralDays / 7 }, (_, index) => row(days.slice(index * 7, index * 7 + 7))).join("");
    body = `<table><thead><tr>${headings}</tr></thead><tbody>${rows}</tbody></table>`;
  } else {
    body = [...byDate].sort(([left], [right]) => left.localeCompare(right)).map(([day, items]) =>
      `<section><h2>${printHtml(formatted(day, { dateStyle: "full" }))}</h2>${list(items)}</section>`).join("");
  }
  return `<!doctype html><html lang="${printHtml(locale)}"><head><meta charset="utf-8"><title>${printHtml(title)}</title>
    <style>
      @page { size: ${grid ? "landscape" : "portrait"}; margin: 12mm; }
      body { color: #182328; font: 11pt/1.4 system-ui, sans-serif; overflow-wrap: anywhere; }
      h1 { margin: 0; font-size: 18pt; } p { margin: .35rem 0; } header { margin-bottom: 1rem; }
      h2 { font-size: 12pt; break-after: avoid; margin: .85rem 0 .3rem; }
      table { width: 100%; table-layout: fixed; border-collapse: collapse; font-size: 9pt; }
      thead { display: table-header-group; }
      th, td { text-align: start; border: 1px solid #a5aeb2; padding: .35rem; vertical-align: top; }
      td { min-height: 2rem; } .date { font-weight: 650; }
      ul { list-style: none; padding: 0; margin: .2rem 0; } li { break-inside: avoid; margin: .3rem 0; }
      small { display: block; color: #364348; } .time { font-variant-numeric: tabular-nums; white-space: nowrap; }
    </style></head><body>
      <header><h1>${printHtml(title)}</h1><p>${printHtml(longDate(from))} – ${printHtml(longDate(through))}</p>
      <p>${printHtml(calendarNames.length ? calendarNames.join(" · ") : "No calendars selected")}</p></header>
      ${body}${byDate.size ? "" : "<p>No appointments in this view.</p>"}
    </body></html>`;
}
