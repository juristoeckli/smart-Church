import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const hook = registerHooks({
  resolve(specifier, context, next) {
    try { return next(specifier, context); }
    catch (error) {
      if (error.code === "ERR_MODULE_NOT_FOUND" && specifier.startsWith("./") && specifier.endsWith(".js")) return next(specifier.slice(0, -3) + ".ts", context);
      throw error;
    }
  },
});
const { normalizeChurchToolsAgenda, resolveChurchToolsAgendaSongs } = await import("../src/modules/churchtools-sync/event-agenda.ts");
hook.deregister();
const fixture = { data: { items: [
  { type: "header", title: "Welcome", calculatedDuration: 300, duration: 300, startTimes: { 1: "2026-10-25T08:00:00Z" } },
  { type: "song", title: "", song: { title: "Morning Song", songId: 17, arrangementId: 19 }, duration: 61,
    start: "2026-10-25T06:00:00Z", startTimes: { 1: "2026-10-25T08:05:00Z", 2: "2026-10-26T08:05:00Z" },
    note: "<p>Opening line</p>", responsible: { persons: [{ service: "[Leader]" }, { service: "[Leader]" }] },
    serviceGroupNotes: [{ note: "visible to one source group" }] },
  { type: "text", title: "Hidden source item", start: "2026-10-25T08:08:00Z", startTimes: { 1: null } },
  { type: "text", title: "Prayer", duration: 15,
    responsible: { persons: [{ service: "[Leader]" }, { service: "[Band]" }] } },
  { type: "text", title: "Remaining announcements", responsible: { persons: [{ service: "[Leader]?" }] } },
  { type: "unknown", title: "Unknown future type" },
] } };
const agenda = normalizeChurchToolsAgenda(fixture, "1", "Europe/Zurich", ["Leader", "Band"]);
assert.deepEqual(agenda.items.map((item) => item.plan), [
  { title: "Welcome", startTime: "09:00" },
  { title: "Morning Song", startTime: "09:05", durationMinutes: 2, notes: "Opening line", position: "Leader" },
  { title: "Prayer", durationMinutes: 1 },
  { title: "Remaining announcements" },
]);
assert.deepEqual([agenda.items[1].sourceSongId, agenda.items[1].sourceArrangementId], ["17", "19"]);
assert.equal(agenda.hidden, 1);
assert.equal(agenda.unsupported, 1);
assert.deepEqual(agenda.unmappedFields, ["agenda.headingAsPlanItem", "agenda.serviceGroupNotes", "agenda.responsible"]);
assert.doesNotMatch(JSON.stringify(agenda), /visible to one source group|Hidden source item/);
assert.throws(() => normalizeChurchToolsAgenda({ data: [] }, "1", "Europe/Zurich", []), /invalid event agenda/);
assert.deepEqual(normalizeChurchToolsAgenda({ data: { items: [] } }, "1", "Europe/Zurich", []).items, []);

const sectionSource = (items, eventStartPosition = 0) =>
  normalizeChurchToolsAgenda({ data: { items, eventStartPosition } }, "1", "Europe/Zurich", []);
const header = (title, fields = {}) => ({ type: "header", title, ...fields });
const speech = (title, fields = {}) => ({ type: "text", title, ...fields });
const start = "2026-10-25T08:00:00Z";
const heading = sectionSource([
  speech("Preparation"),
  header("Gathering", { startTimes: { 1: start }, duration: 0 }),
  { type: "song", song: { title: "Morning Song", songId: 17, arrangementId: 19 }, startTimes: { 1: start } },
  header("Hidden heading", { startTimes: { 1: null } }),
  speech("Welcome", { startTimes: { 1: "2026-10-25T08:05:00Z" } }),
  header("Blessing"),
  speech("Closing prayer"),
]);
assert.deepEqual(heading.items.map(({ plan }) => plan), [
  { title: "Preparation" },
  { title: "Morning Song", startTime: "09:00", section: "Gathering" },
  { title: "Welcome", startTime: "09:05", section: "Gathering" },
  { title: "Closing prayer", section: "Blessing" },
]);
assert.deepEqual([heading.items[1].sourceSongId, heading.items[1].sourceArrangementId], ["17", "19"]);
assert.equal(heading.hidden, 1);
assert.deepEqual(heading.unmappedFields, []);

const repeated = sectionSource([
  header("Empty"), header("Reading"), speech("First reading"), header("Reading"), speech("Second reading"),
  header("Standalone", { note: "<p>Keep heading notes</p>" }), speech("More"),
  header("L".repeat(81)), speech("Long heading item"), header("No following item"),
]);
assert.deepEqual(repeated.items.map(({ plan }) => plan), [
  { title: "Empty" },
  { title: "First reading", section: "Reading" },
  { title: "Reading" }, { title: "Second reading" },
  { title: "Standalone", notes: "Keep heading notes" }, { title: "More" },
  { title: "L".repeat(81) }, { title: "Long heading item" }, { title: "No following item" },
]);
assert.deepEqual(repeated.unmappedFields, ["agenda.headingAsPlanItem"]);
assert.deepEqual(sectionSource([
  header("Before start"), speech("Soundcheck"), speech("Opening"), header("Closing"), speech("Prayer"),
], 2).items.map(({ plan }) => plan), [
  { title: "Soundcheck", section: "Before start" }, { title: "Opening" }, { title: "Prayer", section: "Closing" },
]);
assert.deepEqual(sectionSource([
  header("Before start"), speech("Opening"), header("Empty"), { type: "new_item" }, speech("Other"),
], 1).items.map(({ plan }) => plan), [
  { title: "Before start" }, { title: "Opening" }, { title: "Empty" }, { title: "Other" },
]);

const location = "location";
const base = "https://catalog.church.tools";
const songKey = base + "#17";
const arrangementKey = songKey + "/19";
const database = (arrangementSongId) => ({ query: async (sql, args) => {
  assert.equal(args[0], location);
  if (sql.includes("area='song'")) {
    assert.deepEqual(args[1], [songKey]);
    return { rows: [{ source_id: songKey, id: "local-song" }] };
  }
  assert.deepEqual(args[1], [arrangementKey]);
  return { rows: [{ source_id: arrangementKey, id: "local-arrangement", song_id: arrangementSongId }] };
} });
const resolved = await resolveChurchToolsAgendaSongs(database("local-song"), location, base, agenda.items);
assert.equal(resolved[1].songId, "local-song");
assert.equal(resolved[1].arrangementId, "local-arrangement");
assert.ok(!("sourceSongId" in resolved[1]));
const foreign = await resolveChurchToolsAgendaSongs(database("unrelated-song"), location, base, agenda.items);
assert.equal(foreign[1].songId, "local-song");
assert.equal(foreign[1].arrangementId, undefined);
const unresolved = await resolveChurchToolsAgendaSongs({ query: async () => ({ rows: [] }) }, location, base, agenda.items);
assert.deepEqual(unresolved, agenda.items.map((item) => item.plan));
console.log("ChurchTools agenda timing, visibility, responsibility, and link tests passed.");
