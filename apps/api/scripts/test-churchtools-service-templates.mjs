import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const hooks = registerHooks({ resolve(specifier, context, next) {
  try { return next(specifier, context); }
  catch (error) {
    if (error.code === "ERR_MODULE_NOT_FOUND" && specifier.startsWith(".") && specifier.endsWith(".js")) return next(specifier.slice(0, -3) + ".ts", context);
    throw error;
  }
} });
const { readChurchToolsServiceTemplates } = await import("../src/modules/churchtools-sync/service-templates.ts");
hooks.deregister();

const list = (data) => ({ data, meta: { count: data.length } });
const roles = list([{ id: 1, name: "Vocalist" }, { id: 2, name: "Sound" }]);
const sourceEvent = { id: 7, templateName: "Sunday worship", eventName: "Actual event title", calendarId: 3, hour: 9, minute: 30,
  durationInSeconds: 7200, description: "<b>Default event description</b>", adminIds: ["12345"], facts: { 3: "Confidential source value" },
  services: [{ serviceId: 1, count: 2 }, { serviceId: 2, count: 1 }, { serviceId: 3, count: 1 }] };
const [event] = readChurchToolsServiceTemplates("event", list([sourceEvent]), roles);
assert.equal(event.name,"Sunday worship");
assert.equal(event.description,"Default event description");
assert.deepEqual(event.positions.map(({ name }) => name), ["Vocalist", "Vocalist", "Sound"]);
assert.ok(event.omitted.includes("unavailable_role_names"));
assert.ok(event.omitted.includes("default_event_facts"));
assert.doesNotMatch(JSON.stringify(event), /12345|Confidential source value|Actual event title/);
const [oversized] = readChurchToolsServiceTemplates("event", list([{ ...sourceEvent, services: [{ serviceId: 1, count: 41 }] }]), roles);
assert.ok(oversized.blocked.includes("too_many_volunteer_slots"));

const sourceAgenda = { id: 7, name: "Reusable agenda", eventStartPosition: 1, calendarId: 4, items: [
  { type: "header", title: "Welcome", start: null, startTimes: {} },
  { type: "text", title: "Announcements", duration: 120, note: "<p>Read the notices.</p>", start: null, startTimes: {} },
  { type: "song", title: "Song", duration: 75, song: { songId: 4, arrangementId: 5 }, start: null, startTimes: {} },
] };
const [agenda] = readChurchToolsServiceTemplates("agenda", list([sourceAgenda]));
assert.deepEqual(agenda.sourceItems.map(({ plan }) => plan), [{ title: "Welcome" }, { title: "Announcements", durationMinutes: 2, notes: "Read the notices." }, { title: "Song" }]);
assert.equal(agenda.sourceItems[2].sourceArrangementId, "5");
assert.ok(agenda.omitted.includes("before_event_anchor"));
assert.ok(agenda.omitted.includes("unsupported_agenda_duration"));
assert.ok(agenda.omitted.includes("agenda.headingAsPlanItem"));
const [sectioned] = readChurchToolsServiceTemplates("agenda", list([{ ...sourceAgenda, eventStartPosition: 0 }]));
assert.deepEqual(sectioned.sourceItems.map(({ plan }) => plan), [
  { title: "Announcements", durationMinutes: 2, notes: "Read the notices.", section: "Welcome" },
  { title: "Song", section: "Welcome" },
]);
assert.equal(sectioned.sourceItems[1].sourceArrangementId, "5");
assert.ok(!sectioned.omitted.includes("agenda.headingAsPlanItem"));
const [occurrence] = readChurchToolsServiceTemplates("agenda", list([{ ...sourceAgenda, items: [{ ...sourceAgenda.items[0], startTimes: { 1: "10:00" } }] }]));
assert.ok(occurrence.blocked.includes("instance_agenda_has_occurrence_times"));
assert.throws(() => readChurchToolsServiceTemplates("agenda", { ...list([sourceAgenda]), meta: { count: 0 } }), /complete list/);
assert.throws(() => readChurchToolsServiceTemplates("agenda", list([sourceAgenda, sourceAgenda])), /duplicate ID/);
console.log("ChurchTools service template review verifies distinct source contracts and compatible native fields.");
