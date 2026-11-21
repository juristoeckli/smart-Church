import { Download, Printer } from "lucide-react";
import type { Contact, ServiceEvent, ServicePosition } from "@smart-church/contracts";
import { csvCell, printHtml } from "./service-exports";

type Category = { key: string; name: string };
type Role = { index: number; name: string; assignee: string; status: string };
type MatrixRow = { event: ServiceEvent; date: string; time: string; location: string; responsible: string; roles: Map<string, Role[]> };
type Matrix = { categories: Category[]; rows: MatrixRow[] };

export function buildStaffingMatrix(
  events: readonly ServiceEvent[],
  contacts: readonly Contact[],
  matchesPosition: (position: ServicePosition) => boolean,
  formatDate: (date: string) => string,
  formatTime: (event: ServiceEvent) => string,
): Matrix {
  const names = new Map(contacts.map((person) => [person.id, `${person.firstName} ${person.lastName}`]));
  const categories = new Map<string, string>();
  const rows = events.flatMap((event) => {
    const roles = new Map<string, Role[]>();
    event.positions?.forEach((position, index) => {
      if (!matchesPosition(position)) return;
      const category = position.category?.trim() ?? "";
      const key = category.toLowerCase();
      if (!categories.has(key)) categories.set(key, category || "No role category");
      const assignee = position.contactId ? names.get(position.contactId) ?? "Assigned person unavailable" : "";
      const status = !position.contactId ? "Unfilled" : position.responseStatus === "accepted" ? "Confirmed"
        : position.responseStatus === "declined" ? "Declined" : "Requested";
      const role = { index, name: position.name, assignee, status };
      const current = roles.get(key);
      if (current) current.push(role);
      else roles.set(key, [role]);
    });
    if (roles.size === 0) return [];
    return [{ event, date: formatDate(event.eventDate), time: formatTime(event), location: [event.location, event.room].filter(Boolean).join(" · "),
      responsible: names.get(event.responsibleContactId ?? "") ?? "", roles }];
  });
  return { categories: [...categories].map(([key, name]) => ({ key, name })).sort((a, b) => a.name.localeCompare(b.name)), rows };
}

const roleSummary = (role: Role) => [role.assignee, role.status].filter(Boolean).join(" · ");

export function staffingMatrixCsv(matrix: Matrix) {
  const rows = [
    ["Date", "Event", "Time", "Location", "Responsible person", "Event status", ...matrix.categories.map(({ name }) => `Role category · ${name}`) ],
    ...matrix.rows.map(({ event, time, location, responsible, roles }) => [
      event.eventDate, event.title, time, location, responsible, event.cancelledAt ? "Cancelled" : "",
      ...matrix.categories.map(({ key }) => (roles.get(key) ?? []).map((role) => `${role.name}: ${roleSummary(role)}`).join("\n")),
    ]),
  ];
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}`;
}

export function staffingMatrixPrintHtml(matrix: Matrix, location: string) {
  const maximumColumns = 5;
  const tables: string[] = [];
  for (let offset = 0; offset < matrix.categories.length; offset += maximumColumns) {
    const categories = matrix.categories.slice(offset, offset + maximumColumns);
    const headings = categories.map(({ name }) => `<th scope="col">${printHtml(name)}</th>`).join("");
    const rows = matrix.rows.map((row) => {
      const context = [row.date, row.time, row.location, row.responsible && `Responsible: ${row.responsible}`, row.event.cancelledAt && "Cancelled"].filter(Boolean).join(" · ");
      const cells = categories.map(({ key }) => `<td>${(row.roles.get(key) ?? []).map((role) => `<p><strong>${printHtml(role.name)}</strong><br>${printHtml(roleSummary(role))}</p>`).join("") || "—"}</td>`).join("");
      return `<tr><th scope="row">${printHtml(row.event.title)}<p>${printHtml(context)}</p></th>${cells}</tr>`;
    }).join("");
    tables.push(`<section><table><caption>Event staffing roster</caption><thead><tr><th scope="col">Event</th>${headings}</tr></thead><tbody>${rows}</tbody></table></section>`);
  }
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Staffing roster matrix</title>
    <style>@page{size:landscape;margin:12mm}body{font:12px/1.4 Arial,sans-serif;color:#17211a}h1{font-size:22px}
    table{width:100%;border-collapse:collapse;table-layout:fixed}caption{text-align:left;padding:6px 0}
    thead{display:table-header-group}tr{break-inside:avoid}th,td{text-align:left;overflow-wrap:anywhere;vertical-align:top;border:1px solid #cfd6d0;padding:6px}
    th{background:#f1f5f1}p{margin:0 0 4px}section{margin-top:14px}
    @media print{button{display:none}section+section{break-before:page}}</style></head>
    <body><button type="button" id="print-roster">Print matrix</button><h1>Staffing roster matrix</h1><p>${printHtml(location)}</p>${tables.join("")}</body></html>`;
}

export function StaffingRosterMatrix({ matrix, location, onOpenEvent, onNotice }: {
  matrix: Matrix;
  location: string;
  onOpenEvent: (event: ServiceEvent) => void;
  onNotice: (message: string) => void;
}) {
  function download() {
    const url = URL.createObjectURL(new Blob([staffingMatrixCsv(matrix)], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "event-staffing-matrix.csv";
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  function print() {
    const popup = window.open("", "_blank", "width=1100,height=760");
    if (!popup) {
      onNotice("Allow pop-ups to print the staffing roster matrix.");
      return;
    }
    popup.opener = null;
    popup.document.open();
    popup.document.write(staffingMatrixPrintHtml(matrix, location));
    popup.document.close();
    popup.document.getElementById("print-roster")?.addEventListener("click", () => popup.print());
  }

  if (!matrix.rows.length) return <p className="empty-state">No staffed roles match these filters.</p>;
  return <section className="staffing-roster-matrix">
    <div className="staffing-roster-tools">
      <button className="button button-secondary" type="button" onClick={download}><Download size={15} />Export matrix</button>
      <button className="button button-secondary" type="button" onClick={print}><Printer size={15} />Print matrix</button>
    </div>
    <div className="table-scroll"><table className="people-table staffing-roster-table">
      <caption>Staffing roster by role category</caption>
      <thead><tr><th scope="col">Event</th>{matrix.categories.map(({ key, name }) => <th scope="col" key={key}>{name}</th>)}</tr></thead>
      <tbody>{matrix.rows.map((row) => <tr key={row.event.id}>
        <th scope="row">
          <button className="event-name-trigger" type="button" onClick={() => onOpenEvent(row.event)}>{row.event.title}</button>
          <small>{[row.date, row.time, row.location].filter(Boolean).join(" · ")}</small>
          {row.responsible && <small>Responsible: {row.responsible}</small>}
          {row.event.cancelledAt && <small>Cancelled</small>}
        </th>
        {matrix.categories.map(({ key }) => <td key={key}>{row.roles.has(key) ? <ul>
          {row.roles.get(key)?.map((role) => <li key={role.index}><strong>{role.name}</strong><small>{roleSummary(role)}</small></li>)}
        </ul> : "—"}</td>)}
      </tr>)}</tbody>
    </table></div>
  </section>;
}
