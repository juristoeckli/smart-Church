import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const hook = registerHooks({ resolve(specifier, context, next) {
  try { return next(specifier, context); }
  catch (error) {
    if (error.code === "ERR_MODULE_NOT_FOUND" && specifier.startsWith(".") && specifier.endsWith(".js")) return next(specifier.slice(0, -3) + ".ts", context);
    throw error;
  }
} });
const { publicEmbedCalendarWindow, publicEmbedDateRange, publicEmbedCalendarSelection, renderCalendarEmbed } = await import("../src/modules/church-calendar/calendar-embed.ts");
hook.deregister();

function appointment(id, day, title, subtitle = "", place = "") {
  const startsAt = `2026-11-${day}T10:00:00`;
  return {
    id, originalStart: startsAt, startsAt, endsAt: `2026-11-${day}T11:00:00`,
    allDay: false, title, subtitle, place,
  };
}

const appointments = [
  appointment("early", "21", "Earlier unrelated event"),
  appointment("subtitle", "22", "Collection", "Réunion des bénévoles"),
  appointment("location", "23", "Open workshop", "", "Café des amis"),
];
const render = settings => renderCalendarEmbed("Community Calendar", [...appointments], "Europe/Zurich", settings);
const filtered = render({ entries: 1, searchEntry: " benevoles, cafe,, " });
assert.match(filtered, /Collection/);
assert.doesNotMatch(filtered, /Earlier unrelated event|Open workshop/);
assert.match(render({ entries: 1, searchEntry: "cafe" }), /Open workshop/);
assert.match(render({ searchEntry: "unknown" }), /No upcoming appointments match/);
assert.match(render({ entries: 1 }), /Earlier unrelated event/);

const customized = render({ title: "Music & Friends", darkmode: true });
assert.match(customized, /<title>Music &amp; Friends<\/title>/);
assert.match(customized, /color-scheme:only dark/);
assert.match(render({ title: "   " }), /<title>Community Calendar<\/title>/);
assert.match(render({}), /color-scheme:light dark/);

const settings = { viewname: "calView", period: "week", searchEntry: "cafe" };
const range = publicEmbedCalendarWindow("2026-11-21", settings);
assert.deepEqual([range.from, range.to, range.previous, range.next], ["2026-11-21", "2026-11-22", null, "2026-11-23"]);
assert.equal(publicEmbedCalendarWindow("2026-11-21", { ...settings, date: "2026-11-20" }), null);
assert.equal(publicEmbedCalendarWindow("2026-11-21", { ...settings, date: "2028-01-01" }), null);
assert.equal(publicEmbedCalendarWindow("2026-11-21", {}), null);
const nextWeek = publicEmbedCalendarWindow("2026-11-21", { ...settings, date: range.next });
const grid = renderCalendarEmbed("Community Calendar", [...appointments], "Europe/Zurich", settings, nextWeek);
assert.match(grid, /Calendar view/);
assert.match(grid, /aria-current="page">Week/);
assert.match(grid, /Open workshop/);
assert.doesNotMatch(grid, /Earlier unrelated event|Collection/);
assert.match(grid, /searchEntry=cafe/);

const today = "2026-11-21";
const fixed = { viewname: "calView", period: "week", startdate: "2026-11-23", enddate: "2026-11-26" };
assert.deepEqual(publicEmbedDateRange(today, fixed), { from: "2026-11-23", to: "2026-11-26" });
assert.equal(publicEmbedCalendarWindow(today, { ...fixed, date: "2026-11-27" }), null);
const fixedWeek = publicEmbedCalendarWindow(today, fixed);
assert.deepEqual([fixedWeek.from, fixedWeek.to, fixedWeek.previous, fixedWeek.next], ["2026-11-23", "2026-11-26", null, null]);
const fixedGrid = renderCalendarEmbed("Community Calendar", [...appointments], "Europe/Zurich", fixed, fixedWeek);
assert.match(fixedGrid, /startdate=2026-11-23/);
assert.match(fixedGrid, /enddate=2026-11-26/);
const choices = [{ id: "a", name: "First" }, { id: "b", name: "Second" }];
assert.deepEqual(publicEmbedCalendarSelection(choices, { category_id: "a,revoked", category_select: "a,b" }), {
  choices: [choices[0]], selectedIds: ["a"],
});
assert.deepEqual(publicEmbedCalendarSelection(choices, { category_select: "" }).selectedIds, []);

console.log("Calendar embed regressions passed.");
