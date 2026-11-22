import tp4Layout from "./tp4-layout.json" with { type: "json" };

export type AmxMappedAction = { id: string; name: string; channel: number; port: number };
export type AmxMappedControl = { id: string; name: string; actions?: AmxMappedAction[] };
export type AmxMappedPage = { id: string; room: string; page: string; controls: AmxMappedControl[] };

type Tp4Object = { id: number; type: string; name?: string; label?: string; channel?: number; channelPort?: number; hitStyle?: string; level?: number; levelPort?: number; rangeLow?: number; rangeHigh?: number; states?: Array<{ style?: string }>; uncertainty?: string[] };
type Tp4Page = { id: number; name: string; kind: string; objects: Tp4Object[] };

const pages = tp4Layout.pages as Tp4Page[];

function roomForPage(name: string) {
  if (name === "Home" || name === "Modus" || name.startsWith("PWR_")) return "All rooms";
  if (name.startsWith("Que_") || name.startsWith("Detail_Gem_") || name.startsWith("Detail_Auton_Gem_")) return "Gemeindesaal quer";
  if (name.startsWith("Lan_")) return "Gemeindesaal längs";
  if (name.startsWith("Detail_Kon1_") || name.startsWith("Detail_Auton_Kon1_") || name === "Setup_Kon1_Chor") return "Konferenzsaal 1";
  if (name.startsWith("Detail_Kon2_") || name.startsWith("Detail_Auton_Kon2_")) return "Konferenzsaal 2";
  if (name.startsWith("Kon_")) return "Konferenzsaal";
  if (name.startsWith("Bib_") || name.startsWith("Detail_Bib_") || name.startsWith("Detail_Auton_Bib_")) return "Bibliothek";
  if (name.startsWith("Detail_Geb_") || name.startsWith("Detail_Auton_Geb_")) return "Gebetsaal";
  if (name.startsWith("Setup_Gem_Chor")) return "Gemeindesaal";
  if (name === "Regie") return "Regie";
  if (name.startsWith("PP_EQ_Gemeinde")) return "Gemeindesaal quer";
  if (name.startsWith("PP_EQ_Konferenz")) return "Konferenzsaal";
  if (name.startsWith("PP_EQ_Bibliothek")) return "Bibliothek";
  if (name.startsWith("PP_EQ_Gebet")) return "Gebetsaal";
  if (name.startsWith("PP_EQ_Wireless")) return "Allgemein";
  if (name.startsWith("All_")) return "All rooms";
  return "AMX";
}

function pageLabel(name: string) {
  if (name === "Home") return "Home";
  if (name === "Modus") return "Mode";
  if (name.startsWith("PWR_")) return name.replaceAll("_", " ");
  if (name.startsWith("PP_EQ_")) return `EQ · ${name.slice("PP_EQ_".length).replaceAll("_", " ")}`;
  const suffix = name.replace(/^(Detail_Auton_|Detail_|Setup_|Que_|Lan_|Kon_|Bib_|All_)/, "");
  const [first = name, ...rest] = suffix.split("_");
  const title = [first, ...rest].join(" ").replace("Mik", "Mikrofone").replace("Lautsprecher", "Lautsprecher");
  return name.startsWith("Detail_") || name.startsWith("Detail_Auton_") ? `Detail · ${title}` : title;
}

function makeAction(page: Tp4Page, object: Tp4Object): AmxMappedAction | null {
  // TP4 stores status LEDs as general objects with a channel too. Only objects
  // that have a button style should send input-channel pulses.
  if (object.type !== "general" || object.hitStyle === "passThru" || !object.states?.some((state) => Boolean(state.style?.trim()))
    || !Number.isInteger(object.channel) || !object.channel || object.channel < 1 || object.channel > 65535) return null;
  // The TP4 labels 50 narrow level-display segments as "Button 7" and marks
  // their channel role unclear. Keep them as status-only indicators; never
  // send an input pulse to these unknown channels.
  if (/^Button\s+\d+$/.test(object.label?.trim() || object.name?.trim() || "")
    || object.uncertainty?.some((item) => /channel role is unclear/i.test(item))) return null;
  // Mirror the TP4 channel port. The master combines the dedicated virtual
  // control device on both ports with the panel, so audio controls stay on 2.
  const port = object.channelPort ?? 1;
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  return {
    id: `tp4-${page.id}-${object.id}`,
    name: object.label?.trim() || object.name?.trim() || `Button ${object.id}`,
    channel: object.channel,
    port,
  };
}

// Build the browser's button list and the API's allowlist from the exact same
// project objects. This prevents an editable or stale hand-copied channel map.
export const amxAudioPages: AmxMappedPage[] = pages.map((page) => ({
  id: page.name,
  room: roomForPage(page.name),
  page: pageLabel(page.name),
  controls: page.objects.flatMap((object) => {
    const mapped = makeAction(page, object);
    if (!mapped) return [];
    return [{ id: mapped.id, name: mapped.name, actions: [mapped] }];
  }),
}));

export const amxAudioActions: AmxMappedAction[] = amxAudioPages.flatMap((page) => page.controls.flatMap((control) => control.actions ?? []));

export type AmxMappedLevel = { id: string; page: string; level: number; port: number; rangeLow: number; rangeHigh: number };
export const amxAudioLevels: AmxMappedLevel[] = pages.flatMap((page) => page.objects.flatMap((object) => {
  if (object.type !== "bargraph" || !Number.isInteger(object.level) || !object.level || !Number.isInteger(object.levelPort) || !object.levelPort) return [];
  return [{
    id: `tp4-level-${page.id}-${object.id}`,
    page: page.name,
    level: object.level,
    port: object.levelPort,
    rangeLow: object.rangeLow ?? 0,
    rangeHigh: object.rangeHigh ?? 100,
  }];
}));

const systemActionDefs = [
  ["power-confirm-on", "Activate selected room", "PWR_ASK", 4],
  ["power-cancel", "Cancel room activation", "PWR_ASK", 3],
  ["power-confirm-off", "Confirm system off", "PWR_OFF_ASK", 4],
  ["mode-volume", "Open volume", "Modus", 24],
  ["mode-microphone", "Open microphones", "Modus", 1],
  ["mode-speakers", "Open speakers", "Modus", 2],
  ["mode-regie", "Open control room", "Modus", 28],
] as const;

export const amxSystemActions: AmxMappedAction[] = systemActionDefs.map(([id, name, pageName, objectId]) => {
  const page = pages.find((item) => item.name === pageName);
  const object = page?.objects.find((item) => item.id === objectId);
  const mapped = page && object ? makeAction(page, object) : null;
  if (!mapped) throw new Error(`The TP4 system action mapping is missing: ${pageName} object ${objectId}.`);
  return { ...mapped, id, name };
});
