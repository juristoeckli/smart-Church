export type AmxControlAction = { id: string; name: string; channel: number };
export type AmxControl = { id: string; name: string; actions?: AmxControlAction[]; readonly?: string; unavailable?: boolean };
export type AmxAudioPage = { id: string; room: string; page: string; controls: AmxControl[] };

const queuedVolume = [
  { id: "que-volume-kanzel", name: "Kanzel", channels: [1, 2, 3] },
  ...[1, 2, 3, 4].map((n) => ({ id: `que-volume-stativ-${n}`, name: `Stativ Mik ${n}`, channels: [n * 3 + 1, n * 3 + 2, n * 3 + 3] })),
  { id: "que-volume-ambient", name: "Ambient", channels: [37, 38, 39] },
  { id: "que-volume-mixer-in", name: "Mixer In", channels: [40, 41] },
  { id: "que-volume-line-in-2", name: "Line In 2", channels: [43, 44, 45] },
  ...[1, 2, 3, 4].map((n) => ({ id: `que-volume-drahtlos-${n}`, name: `Drahtlos ${n}`, channels: [223 + (n - 1) * 3, 224 + (n - 1) * 3, 299 + n] })),
].map(({ id, name, channels }) => ({
  id,
  name,
  actions: [
    { id: `${id}-up`, name: "+", channel: channels[0] },
    { id: `${id}-down`, name: "−", channel: channels[1] },
    ...(channels[2] ? [{ id: `${id}-mute`, name: "Mute", channel: channels[2] }] : []),
  ],
}));

export const audioPages: AmxAudioPage[] = [
  { id: "Que_Volume", room: "Gemeindesaal quer", page: "Volume", controls: [
    ...queuedVolume.slice(0, 7),
    { id: "que-volume-mixer-in-mute-obertr", name: "Oberton / cinch_2_kl", actions: [{ id: "que-volume-mixer-in-mute-obertr", name: "Mute", channel: 42 }] },
    { id: "que-volume-mixer-in-mute-saal", name: "Saal", actions: [{ id: "que-volume-mixer-in-mute-saal", name: "Mute", channel: 310 }] },
    ...queuedVolume.slice(7),
  ] },
  { id: "Que_Mik", room: "Gemeindesaal quer", page: "Mikrofone", controls: [
    { id: "que-mik-kanzel", name: "Kanzel", actions: [{ id: "que-mik-kanzel-mute", name: "Mute", channel: 3 }] },
    ...[1, 2, 3, 4].map((n) => ({ id: `que-mik-stativ-${n}`, name: `Stativ ${n}`, actions: [
      { id: `que-mik-stativ-${n}-mute-obertr`, name: "Obertr", channel: [6, 9, 12, 15][n - 1] },
      { id: `que-mik-stativ-${n}-mute-saal`, name: "Saal", channel: 320 + n },
    ] })),
    ...[1, 2, 3, 4].map((n) => ({ id: `que-mik-chor-${n}`, name: `Chor ${n}`, actions: [{ id: `que-mik-chor-${n}-mute`, name: "Mute", channel: 21 + n * 3 }] })),
    ...[1, 2, 3, 4].map((n) => ({ id: `que-mik-drahtlos-${n}`, name: `Drahtlos ${n}`, actions: [{ id: `que-mik-drahtlos-${n}-mute`, name: "Mute", channel: 299 + n }] })),
    { id: "que-mik-ambient", name: "Ambient", actions: [
      { id: "que-mik-ambient-up", name: "+", channel: 37 },
      { id: "que-mik-ambient-down", name: "−", channel: 38 },
      { id: "que-mik-ambient-mute", name: "Mute", channel: 39 },
    ] },
    { id: "que-mik-ambient-level", name: "Ambient level", readonly: "Read-only display · input channel 13 on port 2" },
    { id: "que-mik-chor-summe", name: "Chor Summe", unavailable: true },
    { id: "que-mik-warning", name: "Warning", readonly: "Informational only · channel 180" },
  ] },
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
