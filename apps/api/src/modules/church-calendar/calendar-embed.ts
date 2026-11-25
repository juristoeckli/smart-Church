export const calendarEmbedContentPolicy = "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors *; sandbox; base-uri 'none'; form-action 'none'";

export type EmbedSettings = { days?: number; entries?: number; searchEntry?: string };
export type EmbedAppointment = {
  id: string; originalStart: string; startsAt: string; endsAt: string; allDay: boolean; title: string; subtitle: string; place: string;
  calendarName?: string; calendarOrder?: number;
};

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}

function searchText(value: string) {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
}

export function renderCalendarEmbed(title: string, appointments: EmbedAppointment[], timeZone: string, entries: number, searchEntry = "") {
  const terms = searchEntry.split(",").map((value) => searchText(value.trim())).filter(Boolean);
  const matching = terms.length ? appointments.filter((appointment) => {
    const fields = [appointment.title, appointment.subtitle, appointment.place].map(searchText);
    return terms.some((term) => fields.some((field) => field.includes(term)));
  }) : appointments;
  const dayHeading = new Intl.DateTimeFormat("en", { dateStyle: "full", timeZone: "UTC" });
  const timeLabel = new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit", timeZone: "UTC" });
  const days = new Map<string, EmbedAppointment[]>();
  for (const appointment of matching.sort((left, right) => left.startsAt.localeCompare(right.startsAt)
    || (left.calendarOrder ?? 0) - (right.calendarOrder ?? 0) || left.title.localeCompare(right.title) || left.id.localeCompare(right.id) || left.originalStart.localeCompare(right.originalStart)).slice(0, entries)) {
    const day = appointment.startsAt.slice(0, 10);
    const items = days.get(day) ?? [];
    items.push(appointment);
    days.set(day, items);
  }
  const schedule = [...days].map(([day, items]) => `
    <section><h2><time datetime="${escapeHtml(day)}">${escapeHtml(dayHeading.format(new Date(day + "T00:00:00Z")))}</time></h2>
    <ol>${items.map((item) => {
      const timing = item.allDay ? "All day" : `${timeLabel.format(new Date(item.startsAt + "Z"))}–${timeLabel.format(new Date(item.endsAt + "Z"))}`;
      return `<li><time datetime="${escapeHtml(item.startsAt)}">${escapeHtml(timing)}</time><div><strong>${escapeHtml(item.title)}</strong>
        ${item.calendarName ? `<div>${escapeHtml(item.calendarName)}</div>` : ""}${item.subtitle ? `<div>${escapeHtml(item.subtitle)}</div>` : ""}${item.place ? `<div>${escapeHtml(item.place)}</div>` : ""}</div></li>`;
    }).join("")}</ol></section>`).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title><style>
:root{font-family:system-ui,sans-serif;color-scheme:light dark}
body{margin:0;padding:clamp(.75rem,3vw,1.5rem)}main{max-width:52rem;margin:auto}
h1{margin:0;font-size:1.5rem}h2{font-size:1rem;margin:1.3rem 0 .35rem}
p{margin:.25rem 0 .5rem}ol{list-style:none;padding:0;margin:0}
li{display:grid;grid-template-columns:minmax(5.25rem,9rem) minmax(0,1fr);gap:.85rem;padding:.6rem 0;border-top:1px solid GrayText}
li>div{overflow-wrap:anywhere}
</style></head><body><main><h1>${escapeHtml(title)}</h1><p>Times shown in ${escapeHtml(timeZone)}</p>
${schedule || (terms.length ? "<p>No upcoming appointments match the search terms.</p>" : "<p>No upcoming appointments.</p>")}</main></body></html>`;
}
