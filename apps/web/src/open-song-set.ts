import type { ServiceEvent, ServicePlanItem, WorshipSong } from "@smart-church/contracts";

function xml(value: string) {
  return value.replace(/[^\u0009\u000a\u000d\u0020-\ud7ff\ue000-\ufffd\u{10000}-\u{10ffff}]/gu, "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

function songReference(title?: string) {
  const filename = title?.trim();
  if (!filename || filename === "." || filename === ".." || /[<>:"/\\|?*\u0000-\u001f\u007f]/.test(filename)) return null;
  return filename;
}

export function openSongSet(plan: Pick<ServicePlanItem, "title" | "songId">[], songs: Pick<WorshipSong, "id" | "title">[]) {
  const songTitles = new Map(songs.map(({ id, title }) => [id, title]));
  const groups = plan.map(({ title, songId }) => {
    const reference = songId ? songReference(songTitles.get(songId)) : null;
    if (reference) return `    <slide_group name="${xml(reference)}" type="song"/>`;
    const display = xml(title);
    return `    <slide_group name="${display}" type="custom" seconds="" loop="false">
      <title>${display}</title><subtitle/><notes/><slides><slide><body/></slide></slides>
    </slide_group>`;
  });
  return ['<?xml version="1.0" encoding="UTF-8"?>', "<set>", "  <slide_groups>", ...groups, "  </slide_groups>", "</set>", ""].join("\n");
}

export function downloadOpenSongSet(event: Pick<ServiceEvent, "title" | "eventDate" | "timePlan">, songs: WorshipSong[]) {
  const plan = event.timePlan ?? [];
  if (!plan.length) return;
  const label = event.title.replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, "-").trim().slice(0, 100);
  const url = URL.createObjectURL(new Blob([openSongSet(plan, songs)], { type: "application/octet-stream" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = [event.eventDate, label, "OpenSong"].filter(Boolean).join(" - ");
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
