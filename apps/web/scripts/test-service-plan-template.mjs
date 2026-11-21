import assert from "node:assert/strict";
import { templateFromServiceAgenda } from "../src/service-plan-template.ts";

const source = {
  id: "event",
  title: "Evening service",
  positions: [{ name: "Keys", category: "Music", qualificationIds: ["keyboard"], contactId: "person", notes: "staff only", responseStatus: "accepted" }],
  timePlan: [{ section: "Opening", title: "Song", startTime: "18:00", durationMinutes: 3, notes: "Instrumental opening", songId: "song", arrangementId: "arrangement", position: "Keys", contactId: "person" }],
  assetIds: ["attachment"],
};
const template = templateFromServiceAgenda(source);
assert.deepEqual(template, {
  name: "Evening service",
  positions: [{ name: "Keys", category: "Music", qualificationIds: ["keyboard"] }],
  items: [{ section: "Opening", title: "Song", startTime: "18:00", durationMinutes: 3, notes: "Instrumental opening", songId: "song", arrangementId: "arrangement", position: "Keys" }],
  active: true,
});
template.positions[0].qualificationIds.push("another");
assert.deepEqual(source.positions[0].qualificationIds, ["keyboard"]);
assert.equal(Array.from(templateFromServiceAgenda({ title: "🎵".repeat(161) }).name).length, 160);

console.log("Run-sheet template drafts preserve reusable fields and exclude event-only staffing data.");
