export type AmxControl = { id: string; name: string };
export type AmxAudioPage = { id: string; room: string; page: string; controls: AmxControl[] };

export const audioPages: AmxAudioPage[] = [
  { id: "Que_Volume", room: "Gemeindesaal quer", page: "Volume", controls: [
    ["que-volume-kanzel", "Kanzel"], ["que-volume-ambient", "Ambient"],
    ...[1, 2, 3, 4].map((n) => [`que-volume-stativ-${n}`, `Stativ Mik ${n}`] as [string, string]),
    ...[1, 2, 3, 4].map((n) => [`que-volume-drahtlos-${n}`, `Drahtlos ${n}`] as [string, string]),
    ["que-volume-mixer-in", "Mixer In"], ["que-volume-line-in-2", "Line In 2"],
  ].map(([id, name]) => ({ id, name })) },
  { id: "Que_Mik", room: "Gemeindesaal quer", page: "Mikrofone", controls: [] },
  { id: "Que_Lautsprecher", room: "Gemeindesaal quer", page: "Lautsprecher", controls: [] },
  { id: "Kon_Volume", room: "Konferenzsaal", page: "Volume", controls: [
    ["kon-volume-kanzel-oben", "Kanzel oben"], ["kon-volume-kanzel-unten", "Kanzel unten"], ["kon-volume-klavier", "Klavier"],
    ...[1, 2, 3, 4, 5, 6].map((n) => [`kon-volume-stativ-${n}`, `Stativ Mik ${n}`] as [string, string]),
    ["kon-volume-chor-summe", "Chor Summe"],
    ...[1, 2, 3, 4].map((n) => [`kon-volume-drahtlos-${n}`, `Drahtlos ${n}`] as [string, string]),
    ["kon-volume-mixer-in", "Mixer In"], ["kon-volume-line-in-1", "Line In 1"], ["kon-volume-line-in-2", "Line In 2"],
  ].map(([id, name]) => ({ id, name })) },
  { id: "Kon_Mik", room: "Konferenzsaal", page: "Mikrofone", controls: [
    ...[1, 2, 3, 4, 5, 6].map((n) => [`kon-mic-chor-${n}`, `Chor ${n}`] as [string, string]),
    ...[1, 2, 3, 4, 5, 6].map((n) => [`kon-mic-stativ-${n}`, `Stativ ${n}`] as [string, string]),
    ["kon-mic-kanzel-oben", "Kanzel oben"], ["kon-mic-kanzel-unten", "Kanzel unten"], ["kon-mic-klavier", "Klavier"],
    ...[1, 2, 3, 4].map((n) => [`kon-mic-drahtlos-${n}`, `Drahtlos ${n}`] as [string, string]),
  ].map(([id, name]) => ({ id, name })) },
  { id: "Kon_Lautsprecher", room: "Konferenzsaal", page: "Lautsprecher", controls: [
    ["kon-speaker-chor-vorne", "Chor vorne"], ["kon-speaker-chor-seitlich", "Chor seitlich"],
    ["kon-speaker-hauptbeschallung", "Hauptbeschallung"], ["kon-speaker-backfill", "Backfill"],
    ["kon-speaker-frontfill", "Frontfill"], ["kon-speaker-galerie-vorne", "Galerie vorne"], ["kon-speaker-galerie-hinten", "Galerie hinten"],
  ].map(([id, name]) => ({ id, name })) },
  { id: "Lan_Volume", room: "Gemeindesaal längs", page: "Volume", controls: [] },
  { id: "Lan_Mik", room: "Gemeindesaal längs", page: "Mikrofone", controls: [] },
  { id: "Lan_Lautsprecher", room: "Gemeindesaal längs", page: "Lautsprecher", controls: [] },
];

export const optionalAudioActions = audioPages.flatMap((page) => page.controls.map((control) => ({
  ...control,
  command: "",
})));
