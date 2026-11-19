export type AmxMappedAction = { id: string; name: string; channel: number; port?: number };
export type AmxMappedControl = { id: string; name: string; actions?: AmxMappedAction[]; readonly?: string };
export type AmxMappedPage = { id: string; room: string; page: string; controls: AmxMappedControl[] };

const action = (id: string, name: string, channel: number): AmxMappedAction => ({ id, name, channel });
const control = (id: string, name: string, pairs: Array<[string, string, number]>): AmxMappedControl => ({
  id, name, actions: pairs.map(([suffix, label, channel]) => action(`${id}-${suffix}`, label, channel)),
});
const volume = (id: string, name: string, up: number, down: number, mute?: number) => control(id, name, [
  ["up", "+", up], ["down", "−", down], ...(mute ? [["mute", "Mute", mute] as [string, string, number]] : []),
]);
const mute = (id: string, name: string, channel: number) => control(id, name, [["mute", "Mute", channel]]);
const eqPage = (id: string, room: string, title: string, minusBase: number): AmxMappedPage => ({
  id, room, page: `EQ · ${title}`,
  controls: Array.from({ length: 8 }, (_, index) => ({
    id: `${id.toLowerCase()}-band-${index + 1}`,
    name: `Band ${index + 1}`,
    actions: [
      { id: `${id.toLowerCase()}-band-${index + 1}-down`, name: "−", channel: minusBase + index, port: 4 },
      { id: `${id.toLowerCase()}-band-${index + 1}-up`, name: "+", channel: minusBase - 300 + index, port: 4 },
    ],
  })),
});

export const amxAudioPages: AmxMappedPage[] = [
  { id: "Que_Volume", room: "Gemeindesaal quer", page: "Volume", controls: [
    volume("que-volume-kanzel", "Kanzel", 1, 2, 3),
    ...[1, 2, 3, 4].map((n) => control(`que-volume-stativ-${n}`, `Stativ Mik ${n}`, [["up", "+", n * 3 + 1], ["down", "−", n * 3 + 2], ["transfer", "Übertr.", n * 3 + 3]])),
    control("que-volume-chor-mik", "Chor Mikrofone", [["up", "+", 34], ["down", "−", 35], ["transfer", "Übertr.", 36], ["saal", "Saal", 309]]),
    volume("que-volume-chor-summe", "Chor Summe", 37, 38, 39),
    control("que-volume-line-in-1", "Line In 1", [["up", "+", 40], ["down", "−", 41], ["transfer", "Übertr.", 42]]),
    volume("que-volume-line-in-2", "Line In 2", 43, 44, 45),
    control("que-volume-sael-chor", "Chor Summe Saal", [["saal", "Saal", 310]]),
    ...[1, 2, 3, 4].map((n) => volume(`que-volume-drahtlos-${n}`, `Drahtlos ${n}`, 223 + (n - 1) * 3, 224 + (n - 1) * 3, 299 + n)),
    ...[1, 2, 3, 4].map((n) => control(`que-volume-room-${n}`, `Saal ${n}`, [["select", "Saal", 320 + n]])),
  ] },
  { id: "Que_Mik", room: "Gemeindesaal quer", page: "Mikrofone", controls: [
    mute("que-mik-kanzel", "Kanzel", 3),
    ...[1, 2, 3, 4].map((n) => control(`que-mik-stativ-${n}`, `Stativ Mik ${n}`, [["transfer", "Übertr.", n * 3 + 3], ["saal", "Saal", 320 + n]])),
    ...[1, 2, 3, 4].map((n) => mute(`que-mik-chor-${n}`, `Chor ${n}`, 21 + n * 3)),
    ...[1, 2, 3, 4].map((n) => mute(`que-mik-drahtlos-${n}`, `Drahtlos ${n}`, 299 + n)),
    control("que-mik-chor-mik", "Chor Mikrofone", [["up", "+", 34], ["down", "−", 35], ["transfer", "Übertr.", 36]]),
    volume("que-mik-chor-summe", "Chor Summe", 37, 38, 39),
    control("que-mik-sael", "Saal", [["saal", "Saal", 309]]),
    { id: "que-mik-warning", name: "Status", readonly: "Informational only · channel 180" },
  ] },
  { id: "Que_Lautsprecher", room: "Gemeindesaal quer", page: "Lautsprecher", controls: [
    ...[["links", "Links", 54], ["rechts", "Rechts", 57], ["haupt", "Hauptbeschallung", 138], ["frontfill", "Frontfill", 132], ["backfill", "Backfill", 135], ["chor-vorne", "Chor vorne", 141], ["chor-seitlich", "Chor seitlich", 144], ["galerie-vorne", "Galerie vorne", 153], ["galerie-hinten", "Galerie hinten", 156], ["vorne-1", "Vorne", 198], ["vorne-2", "Vorne 2", 177], ["nebenraeume", "Nebenräume", 216], ["hinten", "Hinten", 159], ["vorne-3", "Vorne 3", 162], ["sub", "Sub", 48]].map(([id, name, ch]) => control(`que-speaker-${id}`, name as string, [["toggle", "Umschalten", ch as number]])),
    ...[["kon1", "Konferenz 1", 231], ["kon2", "Konferenz 2", 237], ["gemeinde", "Gemeindesaal", 225], ["gebet", "Gebetsaal", 234], ["bibliothek", "Bibliothek", 228]].map(([id, name, ch]) => control(`que-speaker-select-${id}`, name as string, [["select", "Wählen", ch as number]])),
  ] },
  { id: "Lan_Volume", room: "Gemeindesaal längs", page: "Volume", controls: [
    volume("lan-volume-kanzel", "Kanzel", 1, 2, 3),
    ...[1, 2, 3, 4].map((n) => control(`lan-volume-stativ-${n}`, `Stativ Mik ${n}`, [["up", "+", n * 3 + 1], ["down", "−", n * 3 + 2], ["transfer", "Übertr.", n * 3 + 3]])),
    control("lan-volume-mixer-in", "Mixer In", [["up", "+", 34], ["down", "−", 35], ["transfer", "Übertr.", 36], ["saal", "Saal", 309]]),
    volume("lan-volume-chor-summe", "Chor Summe", 37, 38, 39),
    control("lan-volume-line-in-1", "Line In 1", [["up", "+", 40], ["down", "−", 41], ["transfer", "Übertr.", 42]]),
    volume("lan-volume-line-in-2", "Line In 2", 43, 44, 45),
    ...[1, 2, 3, 4].map((n) => volume(`lan-volume-drahtlos-${n}`, `Drahtlos ${n}`, 223 + (n - 1) * 3, 224 + (n - 1) * 3, 299 + n)),
    control("lan-volume-sael-chor", "Chor Summe Saal", [["saal", "Saal", 310]]),
  ] },
  { id: "Lan_Mik", room: "Gemeindesaal längs", page: "Mikrofone", controls: [
    mute("lan-mik-kanzel", "Kanzel", 3),
    ...[1, 2, 3, 4].map((n) => control(`lan-mik-stativ-${n}`, `Stativ Mik ${n}`, [["transfer", "Übertr.", n * 3 + 3], ["saal", "Saal", 320 + n]])),
    ...[1, 2, 3, 4].map((n) => mute(`lan-mik-drahtlos-${n}`, `Drahtlos ${n}`, 299 + n)),
    volume("lan-mik-chor-summe", "Chor Summe", 37, 38, 39),
    ...[1, 2, 3, 4].map((n) => control(`lan-mik-room-${n}`, `Saal ${n}`, [["select", "Saal", 320 + n]])),
  ] },
  { id: "Lan_Lautsprecher", room: "Gemeindesaal längs", page: "Lautsprecher", controls: [
    ...[["links", "Links", 54], ["rechts", "Rechts", 57], ["haupt", "Hauptbeschallung", 138], ["frontfill", "Frontfill", 132], ["backfill", "Backfill", 135], ["chor-vorne", "Chor vorne", 141], ["chor-seitlich", "Chor seitlich", 144], ["galerie-vorne", "Galerie vorne", 153], ["galerie-hinten", "Galerie hinten", 156], ["vorne-1", "Vorne", 198], ["vorne-2", "Vorne 2", 177], ["nebenraeume", "Nebenräume", 216], ["hinten", "Hinten", 159], ["vorne-3", "Vorne 3", 162], ["sub", "Sub", 48]].map(([id, name, ch]) => control(`lan-speaker-${id}`, name as string, [["toggle", "Umschalten", ch as number]])),
    ...[["kon1", "Konferenz 1", 231], ["kon2", "Konferenz 2", 237], ["gemeinde", "Gemeindesaal", 225], ["gebet", "Gebetsaal", 234], ["bibliothek", "Bibliothek", 228]].map(([id, name, ch]) => control(`lan-speaker-select-${id}`, name as string, [["select", "Wählen", ch as number]])),
  ] },
  { id: "Kon_Volume", room: "Konferenzsaal", page: "Volume", controls: [
    volume("kon-volume-kanzel-oben", "Kanzel oben", 58, 59, 60), volume("kon-volume-kanzel-unten", "Kanzel unten", 61, 62, 63),
    volume("kon-volume-klavier", "Klavier", 238, 239), volume("kon-volume-line-in-1", "Line In 1", 118, 119, 120), volume("kon-volume-line-in-2", "Line In 2", 121, 122, 123),
    ...[1, 2, 3, 4, 5, 6].map((n) => volume(`kon-volume-stativ-${n}`, `Stativ Mik ${n}`, 67 + n * 3, 68 + n * 3, 69 + n * 3)),
    ...[1, 2, 3, 4].map((n) => volume(`kon-volume-drahtlos-${n}`, `Drahtlos ${n}`, 223 + (n - 1) * 3, 224 + (n - 1) * 3, 299 + n)),
    volume("kon-volume-chor-summe", "Chor Summe", 115, 116, 117), volume("kon-volume-mixer-in", "Mixer In", 235, 236),
    control("kon-volume-chor-routing", "Chor Routing", [["transfer", "Übertr.", 325], ["saal", "Saal", 326]]),
  ] },
  { id: "Kon_Mik", room: "Konferenzsaal", page: "Mikrofone", controls: [
    ...[99, 102, 105, 108, 111, 114].map((ch, index) => mute(`kon-mik-chor-${index + 1}`, `Chor ${index + 1}`, ch)),
    ...[1, 2, 3, 4, 5, 6].map((n, index) => mute(`kon-mik-stativ-${n}`, `Stativ ${n}`, [72, 75, 78, 81, 84, 87][index])),
    mute("kon-mik-kanzel-oben", "Kanzel oben", 60), mute("kon-mik-kanzel-unten", "Kanzel unten", 63),
    ...[1, 2, 3, 4].map((n) => mute(`kon-mik-drahtlos-${n}`, `Drahtlos ${n}`, 299 + n)),
    volume("kon-mik-chor-summe", "Chor Summe", 115, 116, 117),
    control("kon-mik-sael", "Saal / Übertragung", [["saal", "Saal", 327], ["transfer", "Übertr.", 328]]),
  ] },
  { id: "Kon_Lautsprecher", room: "Konferenzsaal", page: "Lautsprecher", controls: [
    ...[["haupt", "Hauptbeschallung", 138], ["frontfill", "Frontfill", 132], ["backfill", "Backfill", 135], ["chor-vorne", "Chor vorne", 141], ["chor-seitlich", "Chor seitlich", 144], ["galerie-vorne", "Galerie vorne", 153], ["galerie-hinten", "Galerie hinten", 156], ["links", "Links", 57], ["rechts", "Rechts", 54], ["vorne-1", "Vorne", 198], ["vorne-2", "Vorne", 177], ["nebenraeume", "Nebenräume", 216], ["hinten", "Hinten", 159], ["vorne-3", "Vorne", 162]].map(([id, name, ch]) => control(`kon-speaker-${id}`, name as string, [["toggle", "Umschalten", ch as number]])),
    ...[["haupt", "Hauptbeschallung", 138], ["frontfill", "Frontfill", 132], ["backfill", "Backfill", 135], ["chor-vorne", "Chor vorne", 141], ["chor-seitlich", "Chor seitlich", 144], ["galerie-vorne", "Galerie vorne", 153], ["galerie-hinten", "Galerie hinten", 156]].map(([id, name, ch]) => control(`kon-speaker-mute-${id}`, `${name} Mute`, [["mute", "Mute", ch as number]])),
    ...[["kon1", "Konferenz 1", 261], ["kon2", "Konferenz 2", 267], ["gemeinde", "Gemeindesaal", 255], ["gebet", "Gebetsaal", 264], ["bibliothek", "Bibliothek", 258]].map(([id, name, ch]) => control(`kon-speaker-select-${id}`, name as string, [["select", "Wählen", ch as number]])),
  ] },
  { id: "Bib_Volume", room: "Bibliothek", page: "Volume", controls: [
    volume("bib-volume-stativ-1", "Stativ Mik 1", 181, 182, 183),
    volume("bib-volume-stativ-2", "Stativ Mik 2", 193, 194, 195),
    volume("bib-volume-stativ-3", "Stativ Mik 3", 184, 185, 186),
    ...[1, 2, 3, 4].map((n) => volume(`bib-volume-drahtlos-${n}`, `Drahtlos ${n}`, 223 + (n - 1) * 3, 224 + (n - 1) * 3, 299 + n)),
    ...[1, 2, 3, 4].map((n) => volume(`bib-volume-drahtlos-${n}`, `Drahtlos ${n}`, 223 + (n - 1) * 3, 224 + (n - 1) * 3, 299 + n)),
  ] },
  { id: "Bib_Mik", room: "Bibliothek", page: "Mikrofone", controls: [
    mute("bib-mik-stativ-1", "Stativ 1", 183), mute("bib-mik-stativ-2", "Stativ 2", 186),
    ...[1, 2, 3, 4].map((n) => mute(`bib-mik-drahtlos-${n}`, `Drahtlos ${n}`, 299 + n)),
  ] },
  { id: "Bib_Lautsprecher", room: "Bibliothek", page: "Lautsprecher", controls: [
    ...[["front", "Front", 57], ["rear", "Rear", 54], ["main", "Hauptbeschallung", 138], ["frontfill", "Frontfill", 132], ["backfill", "Backfill", 135], ["choir-front", "Chor vorne", 141], ["choir-side", "Chor seitlich", 144], ["gallery-front", "Galerie vorne", 153], ["gallery-rear", "Galerie hinten", 156], ["library", "Bibliothek", 198], ["room-2", "Vorne 2", 177], ["side-rooms", "Nebenräume", 216], ["rear-2", "Hinten", 159], ["front-2", "Vorne 3", 162]].map(([id, name, ch]) => control(`bib-speaker-${id}`, name as string, [["toggle", "Umschalten", ch as number]])),
    ...[["kon1", "Konferenz 1", 246], ["kon2", "Konferenz 2", 252], ["gemeinde", "Gemeindesaal", 240], ["gebet", "Gebetsaal", 249], ["bibliothek", "Bibliothek", 243]].map(([id, name, ch]) => control(`bib-speaker-select-${id}`, name as string, [["select", "Wählen", ch as number]])),
    mute("bib-speaker-mute-library", "Mute Bibliothek", 198),
  ] },
  { id: "Detail_Gem_Volume", room: "Gemeindesaal quer", page: "Detail · Volume", controls: [
    volume("detail-gem-kanzel", "Kanzel", 1, 2, 3),
    volume("detail-gem-stativ-1", "Stativ Mik 1", 4, 5, 6), volume("detail-gem-stativ-2", "Stativ Mik 2", 7, 8, 9), volume("detail-gem-stativ-3", "Stativ Mik 3", 10, 11, 12), volume("detail-gem-stativ-4", "Stativ Mik 4", 13, 14, 15),
    control("detail-gem-chor-mik", "Chor Mikrofone", [["up", "+", 34], ["down", "−", 35], ["transfer", "Übertr.", 36]]),
    control("detail-gem-line-in-1", "Line In 1", [["up", "+", 40], ["down", "−", 41], ["transfer", "Übertr.", 42]]), volume("detail-gem-line-in-2", "Line In 2", 43, 44, 45),
  ] },
  { id: "Detail_Gem_Mik", room: "Gemeindesaal quer", page: "Detail · Mikrofone", controls: [
    ...[["Chor 1", 24], ["Chor 2", 27], ["Chor 3", 30], ["Chor 4", 33], ["Stativ 1", 15], ["Stativ 2", 12], ["Stativ 3", 6], ["Stativ 4", 9], ["Kanzel", 3]].map(([name, ch]) => mute(`detail-gem-mik-${String(name).toLowerCase().replaceAll(" ", "-")}`, String(name), ch as number)),
    mute("detail-gem-mik-drahtlos-3", "Drahtlos 3", 302),
  ] },
  { id: "Detail_Gem_Lautsprecher", room: "Gemeindesaal quer", page: "Detail · Lautsprecher", controls: [
    mute("detail-gem-speaker-links", "Links", 54), mute("detail-gem-speaker-rechts", "Rechts", 57), mute("detail-gem-speaker-sub", "Sub", 48),
    volume("detail-gem-speaker-output", "Lautsprecher Ausgang", 241, 242),
    control("detail-gem-speaker-orientation", "Ausrichtung", [["toggle", "Umschalten", 329]]),
    control("detail-gem-speaker-select", "Ausgang wählen", [["select", "Wählen", 960]]),
    control("detail-gem-speaker-send-regie", "Zur Regie senden", [["send", "Senden", 500]]),
  ] },
  { id: "Detail_Auton_Gem_Lautsprecher", room: "Gemeindesaal quer", page: "Detail · Lautsprecher (Autonom)", controls: [
    mute("detail-auton-gem-speaker-links", "Links", 54), mute("detail-auton-gem-speaker-rechts", "Rechts", 57), volume("detail-auton-gem-speaker-output", "Lautsprecher Ausgang", 55, 56),
    control("detail-auton-gem-speaker-orientation", "Ausrichtung", [["toggle", "Umschalten", 329]]), control("detail-auton-gem-speaker-select", "Ausgang wählen", [["select", "Wählen", 960]]),
    control("detail-auton-gem-speaker-send-regie", "Zur Regie senden", [["send", "Senden", 500]]),
  ] },
  { id: "Detail_Kon1_Volume", room: "Konferenzsaal 1", page: "Detail · Volume", controls: [
    volume("detail-kon1-kanzel-oben", "Kanzel oben", 58, 59, 60), volume("detail-kon1-kanzel-unten", "Kanzel unten", 61, 62, 63),
    ...[1, 2, 3, 4, 5, 6].map((n) => volume(`detail-kon1-stativ-${n}`, `Stativ Mik ${n}`, 67 + n * 3, 68 + n * 3, 69 + n * 3)),
    volume("detail-kon1-line-in-1", "Line In 1", 118, 119, 120), volume("detail-kon1-line-in-2", "Line In 2", 121, 122, 123),
  ] },
  { id: "Detail_Auton_Kon1_Volume", room: "Konferenzsaal 1", page: "Detail · Volume (Autonom)", controls: [volume("detail-auton-kon1-wireless-4", "Drahtlos 4", 232, 233, 303)] },
  { id: "Detail_Kon1_Mik", room: "Konferenzsaal 1", page: "Detail · Mikrofone", controls: [
    ...[99, 102, 105, 111, 114, 108, 84, 81, 78, 72, 75, 66, 60, 63, 69, 87].map((ch, n) => mute(`detail-kon1-mik-${ch}`, `Mikrofon ${n + 1}`, ch)),
    mute("detail-kon1-mik-drahtlos-4", "Drahtlos 4", 303),
  ] },
  { id: "Detail_Kon1_Lautsprecher", room: "Konferenzsaal 1", page: "Detail · Lautsprecher", controls: [
    ...[["Hauptbeschallung", 138], ["Frontfill", 132], ["Backfill", 135], ["Galerie hinten", 156], ["Chor vorne", 141], ["Chor seitlich", 144], ["Galerie vorne", 153]].map(([name, ch]) => mute(`detail-kon1-speaker-${String(name).toLowerCase().replaceAll(" ", "-")}`, String(name), ch as number)),
    control("detail-kon1-speaker-send-regie", "Zur Regie senden", [["send", "Senden", 501]]),
  ] },
  { id: "Detail_Kon2_Volume", room: "Konferenzsaal 2", page: "Detail · Volume", controls: [volume("detail-kon2-wireless-1", "Drahtlos 1", 223, 224, 300), volume("detail-kon2-wireless-2", "Drahtlos 2", 226, 227, 301)] },
  { id: "Detail_Kon2_Mik", room: "Konferenzsaal 2", page: "Detail · Mikrofone", controls: [mute("detail-kon2-wireless-1", "Drahtlos 1", 300), mute("detail-kon2-wireless-2", "Drahtlos 2", 301)] },
  { id: "Detail_Kon2_Lautsprecher", room: "Konferenzsaal 2", page: "Detail · Lautsprecher", controls: [mute("detail-kon2-speaker-hinten", "Hinten", 159), mute("detail-kon2-speaker-vorne", "Vorne", 162), volume("detail-kon2-speaker-output", "Lautsprecher Ausgang", 157, 158), control("detail-kon2-speaker-send-regie", "Zur Regie senden", [["send", "Senden", 504]])] },
  { id: "Detail_Geb_Volume", room: "Gebetsaal", page: "Detail · Volume", controls: [volume("detail-geb-stativ-1", "Stativ 1", 163, 164, 165), volume("detail-geb-stativ-2", "Stativ 2", 172, 173, 174)] },
  { id: "Detail_Geb_Mik", room: "Gebetsaal", page: "Detail · Mikrofone", controls: [mute("detail-geb-stativ-1", "Stativ 1", 165)] },
  { id: "Detail_Geb_Lautsprecher", room: "Gebetsaal", page: "Detail · Lautsprecher", controls: [mute("detail-geb-speaker", "Lautsprecher", 177), control("detail-geb-speaker-send-regie", "Zur Regie senden", [["send", "Senden", 502]])] },
  { id: "Detail_Bib_Volume", room: "Bibliothek", page: "Detail · Volume", controls: [volume("detail-bib-stativ-1", "Stativ 1", 181, 182, 183), volume("detail-bib-stativ-2", "Stativ 2", 193, 194, 195), volume("detail-bib-stativ-3", "Stativ 3", 184, 185, 186), ...[1, 2, 3, 4].map((n) => volume(`detail-bib-drahtlos-${n}`, `Drahtlos ${n}`, 223 + (n - 1) * 3, 224 + (n - 1) * 3, 299 + n))] },
  { id: "Detail_Bib_Mik", room: "Bibliothek", page: "Detail · Mikrofone", controls: [mute("detail-bib-mik-1", "Mikrofon 1", 183), mute("detail-bib-mik-2", "Mikrofon 2", 186)] },
  { id: "Detail_Bib_Lautsprecher", room: "Bibliothek", page: "Detail · Lautsprecher", controls: [mute("detail-bib-speaker", "Lautsprecher", 198), control("detail-bib-speaker-send-regie", "Zur Regie senden", [["send", "Senden", 503]])] },
  { id: "Setup_Gem_Chor", room: "Gemeindesaal", page: "Setup · Chor", controls: [
    ...[1, 2, 3, 4].map((n) => volume(`setup-gem-chor-${n}`, `Chor ${n}`, 21 + n, 22 + n, 23 + n)),
  ] },
  { id: "Setup_Kon1_Chor", room: "Konferenzsaal 1", page: "Setup · Chor", controls: [
    ...[1, 2, 3, 4, 5, 6].map((n) => volume(`setup-kon1-chor-${n}`, `Chor ${n}`, 94 + n * 3, 95 + n * 3, 96 + n * 3)),
  ] },
  { id: "Regie", room: "Regie", page: "Volume", controls: [
    volume("regie-volume-1", "Kanal 1", 202, 203, 204), volume("regie-volume-2", "Kanal 2", 205, 206, 207), volume("regie-volume-3", "Kanal 3", 217, 218, 219),
    ...[510, 511, 512, 513].map((ch, n) => control(`regie-room-${n + 1}`, `Raum Kanal ${ch}`, [["select", "Wählen", ch]])),
  ] },
];

amxAudioPages.push(
  eqPage("PP_EQ_GemeindeKanzel", "Gemeindesaal quer", "Kanzel", 741),
  ...[1, 2, 3, 4].map((n) => eqPage(`PP_EQ_GemeindeStativ${n}`, "Gemeindesaal quer", `Stativ ${n}`, 751 + (n - 1) * 10)),
  ...[1, 2, 3, 4].map((n) => eqPage(`PP_EQ_Wireless${n}`, "Allgemein", `Wireless ${n}`, 791 + (n - 1) * 10)),
  eqPage("PP_EQ_GebetStativ1", "Gebetsaal", "Stativ 1", 831),
  eqPage("PP_EQ_BibliothekStativ1", "Bibliothek", "Stativ 1", 841), eqPage("PP_EQ_BibliothekStativ2", "Bibliothek", "Stativ 2", 851),
  eqPage("PP_EQ_KonferenzKanzelOben", "Konferenzsaal", "Kanzel oben", 861), eqPage("PP_EQ_KonferenzKanzelUnten", "Konferenzsaal", "Kanzel unten", 871),
  eqPage("PP_EQ_KonferenzLeiter", "Konferenzsaal", "Leiter", 881), eqPage("PP_EQ_KonferenzKlavier", "Konferenzsaal", "Klavier", 891),
  ...[1, 2, 3, 4, 5, 6].map((n) => eqPage(`PP_EQ_KonferenzStativ${n}`, "Konferenzsaal", `Stativ ${n}`, 901 + (n - 1) * 10)),
);

export const amxAudioActions = amxAudioPages.flatMap((page) => page.controls.flatMap((item) => item.actions ?? []));
