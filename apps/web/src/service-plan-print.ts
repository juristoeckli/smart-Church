import type { ServicePlanItem, WorshipSong } from "@smart-church/contracts";
import { printHtml } from "./service-exports";

interface ServicePlanPrintOptions {
  title: string;
  plan: ServicePlanItem[];
  songs: WorshipSong[];
  context?: string;
  cancelled?: boolean;
  responsible?: string;
  assigneesForRole?: (role: string) => string[];
}

export function servicePlanSectionHeading(plan: ServicePlanItem[], index: number): string | undefined {
  const section = plan[index].section?.trim() || undefined;
  const previous = plan[index - 1]?.section?.trim() || undefined;
  return section !== previous ? section ?? "Unsectioned items" : undefined;
}

export function servicePlanPrintHtml({ title, plan, songs, context, cancelled, responsible, assigneesForRole }: ServicePlanPrintOptions): string {
  const rows = plan.map((item, index) => {
    const section = servicePlanSectionHeading(plan, index);
    const group = section ? `${index === 0 ? "" : "</tbody><tbody>"}<tr><th scope="rowgroup" colspan="6">${printHtml(section)}</th></tr>` : "";
    const song = songs.find((candidate) => candidate.id === item.songId);
    const arrangement = song?.arrangements.find((candidate) => candidate.id === item.arrangementId);
    const key = arrangement?.key || song?.defaultKey;
    const songDetails = [song?.title, arrangement?.name, key && `Key: ${key}`, song?.bpm && `${song.bpm} BPM`, song?.timeSignature, song?.authors].filter(Boolean).join(" · ");
    const assignedNames = item.position ? assigneesForRole?.(item.position) ?? [] : [];
    return `${group}<tr><td>${index + 1}</td><td>${printHtml(item.startTime ?? "")}</td>
      <td>${printHtml(item.durationMinutes ?? "")}</td><td><strong>${printHtml(item.title)}</strong>${item.notes ? `<div class="notes">${printHtml(item.notes)}</div>` : ""}</td>
      <td>${printHtml(item.position ?? "")}${assignedNames.length ? `<div>${printHtml([...new Set(assignedNames)].join(", "))}</div>` : ""}</td>
      <td>${printHtml(songDetails)}</td></tr>`;
  });
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Service run sheet</title>
      <style>
        @page { margin: 14mm; }
        body { font: 12px/1.4 Arial, sans-serif; color: #17211a; }
        h1 { margin-bottom: 0; }
        table { width: 100%; border-collapse: collapse; }
        thead { display: table-header-group; }
        tr { break-inside: avoid; }
        th, td { border: 1px solid #aaa; padding: 6px; text-align: left; vertical-align: top; overflow-wrap: anywhere; }
        th { background: #eee; }
        .notes { white-space: pre-wrap; margin-top: 4px; }
        @media print { button { display: none; } }
      </style></head><body>
      <button type="button" id="print-run-sheet">Print run sheet</button>
      <h1>${printHtml(title)}</h1>${context ? `<p>${printHtml(context)}</p>` : ""}
      ${cancelled ? "<p><strong>Cancelled</strong></p>" : ""}
      ${responsible ? `<p>Responsible person: ${printHtml(responsible)}</p>` : ""}
      <table><caption>Service run sheet</caption><thead><tr><th scope="col">#</th><th scope="col">Start</th><th scope="col">Minutes</th><th scope="col">Item</th><th scope="col">Responsibility</th><th scope="col">Song</th></tr></thead>
      <tbody>${rows.join("")}</tbody></table></body></html>`;
}

export function openServicePlanPrint(options: ServicePlanPrintOptions): boolean {
  const popup = window.open("", "_blank", "popup");
  if (!popup) return false;
  popup.opener = null;
  popup.document.open();
  popup.document.write(servicePlanPrintHtml(options));
  popup.document.close();
  popup.document.getElementById("print-run-sheet")?.addEventListener("click", () => popup.print());
  popup.focus();
  return true;
}
