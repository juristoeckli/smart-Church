import assert from "node:assert/strict";
import { openSongSet } from "../src/open-song-set.ts";

const agenda = [
  { title: "Welcome <everyone>\u0000", notes: "Private operator note", position: "Audio", contactId: "contact-secret" },
  { title: "Different display title", songId: "valid", arrangementId: "arrangement-secret" },
  { title: 'Fallback "title"', songId: "unsafe" },
  { title: "Missing song 🎵", songId: "missing" },
];
const songs = [
  { id: "valid", title: "Cantique d'aujourd’hui & demain", notes: "Unpublished song note", lyrics: "Copyrighted lyric fixture" },
  { id: "unsafe", title: "../outside" },
];

const xml = openSongSet(agenda, songs);
const expectedGroups = [
  '<slide_group name="Welcome &lt;everyone&gt;" type="custom" seconds="" loop="false">',
  '<slide_group name="Cantique d&apos;aujourd’hui &amp; demain" type="song"/>',
  '<slide_group name="Fallback &quot;title&quot;" type="custom" seconds="" loop="false">',
  '<slide_group name="Missing song 🎵" type="custom" seconds="" loop="false">',
];
assert.deepEqual(xml.match(/<slide_group [^>]+>/g), expectedGroups);
assert.match(xml, /^<\?xml version="1.0" encoding="UTF-8"\?>\n<set>\n  <slide_groups>/);
assert.match(xml, /<\/slide_groups>\n<\/set>\n$/);
assert.match(xml, /<title>Welcome &lt;everyone&gt;<\/title><subtitle\/><notes\/><slides><slide><body\/><\/slide><\/slides>/);
for (const hidden of ["\u0000", "Private operator note", "Audio", "contact-secret", "arrangement-secret",
  "Unpublished song note", "Copyrighted lyric fixture", "../outside"]) {
  assert.ok(!xml.includes(hidden), "The exported set exposed a non-projection value.");
}
console.log("OpenSong sets retain agenda order and safe song references while excluding private and unsafe fields.");
