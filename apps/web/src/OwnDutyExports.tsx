import { Download, Printer } from "lucide-react";
import type { ServiceEvent, ServicePosition } from "@smart-church/contracts";
import { csvCell, printHtml } from "./service-exports";

type OwnDuty = {
  date: string;
  event: string;
  time: string;
  location: string;
  role: string;
  status: string;
  cancelled: boolean;
};

export function buildOwnDutyRows(events: readonly ServiceEvent[], matchesPosition: (position: ServicePosition) => boolean, pendingOnly: boolean, formatTime: (event: ServiceEvent) => string): OwnDuty[] {
  return events.flatMap((event) => {
    if (pendingOnly && event.cancelledAt) return [];
    return (event.positions ?? []).flatMap((position) => {
      if (!position.canRespond || !position.contactId || !matchesPosition(position)) return [];
      const status = position.responseStatus ?? "pending";
      if (pendingOnly && status !== "pending") return [];
      return [{
        date: event.eventDate,
        event: event.title,
        time: formatTime(event),
        location: [event.location, event.room].filter(Boolean).join(" · "),
        role: position.name,
        status: status === "accepted" ? "Confirmed" : status === "declined" ? "Declined" : "Requested",
        cancelled: Boolean(event.cancelledAt),
      }];
    });
  });
}

const headings = ["Date", "Event", "Time", "Location", "My role", "Response", "Event status"];
const values = (duty: OwnDuty) => [duty.date, duty.event, duty.time, duty.location, duty.role, duty.status, duty.cancelled ? "Cancelled" : ""];

export function ownDutyCsv(rows: readonly OwnDuty[]) {
  return `\uFEFF${[headings, ...rows.map(values)].map((row) => row.map(csvCell).join(",")).join("\r\n")}`;
}

export function ownDutyPrintHtml(rows: readonly OwnDuty[], departmentLocation: string, pendingOnly: boolean) {
  const title = pendingOnly ? "My pending duties" : "My service schedule";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title>
    <style>@page{margin:12mm}body{font:12px/1.4 Arial,sans-serif;color:#17211a}h1{font-size:22px}table{width:100%;border-collapse:collapse}
    caption{text-align:left;padding:6px 0}thead{display:table-header-group}tr{break-inside:avoid}
    th,td{text-align:left;overflow-wrap:anywhere;vertical-align:top;border:1px solid #cfd6d0;padding:6px}th{background:#f1f5f1}
    @media print{button{display:none}}</style></head><body><button id="print-own-duty" type="button">Print schedule</button>
    <h1>${title}</h1><p>${printHtml(departmentLocation)}</p><table><caption>Your selected assignments</caption><thead><tr>${headings.map((heading) => `<th scope="col">${heading}</th>`).join("")}</tr></thead>
    <tbody>${rows.map((duty) => `<tr>${values(duty).map((value) => `<td>${printHtml(value)}</td>`).join("")}</tr>`).join("")}</tbody></table></body></html>`;
}

export function OwnDutyExports({ rows, departmentLocation, pendingOnly, onNotice }: {
  rows: OwnDuty[];
  departmentLocation: string;
  pendingOnly: boolean;
  onNotice: (message: string) => void;
}) {
  function download() {
    const url = URL.createObjectURL(new Blob([ownDutyCsv(rows)], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = pendingOnly ? "my-pending-duties.csv" : "my-service-schedule.csv";
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  function print() {
    const popup = window.open("", "_blank", "width=960,height=750");
    if (!popup) {
      onNotice("Allow pop-ups to print your service schedule.");
      return;
    }
    popup.opener = null;
    popup.document.open();
    popup.document.write(ownDutyPrintHtml(rows, departmentLocation, pendingOnly));
    popup.document.close();
    popup.document.getElementById("print-own-duty")?.addEventListener("click", () => popup.print());
  }

  return <>
    <button className="button button-secondary" type="button" disabled={!rows.length} onClick={download}><Download size={15} />Export my duties</button>
    <button className="button button-secondary" type="button" disabled={!rows.length} onClick={print}><Printer size={15} />Print my duties</button>
  </>;
}
