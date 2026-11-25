import assert from "node:assert/strict";
import { renderCalendarEmbed } from "../src/modules/church-calendar/calendar-embed.ts";

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

console.log("Calendar embed regressions passed.");
