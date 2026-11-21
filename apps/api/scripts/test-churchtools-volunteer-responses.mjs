import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const hooks = registerHooks({ resolve(specifier, context, next) {
  try { return next(specifier, context); }
  catch (error) {
    if (error.code === "ERR_MODULE_NOT_FOUND" && specifier.startsWith(".") && specifier.endsWith(".js")) return next(specifier.slice(0, -3) + ".ts", context);
    throw error;
  }
} });
const { readChurchToolsVolunteerResponses } = await import("../src/modules/churchtools-sync/volunteer-responses.ts");
hooks.deregister();

const row = (id, patch = {}) => ({ id, serviceId: 3, personId: 4, person: { domainType: "person", domainIdentifier: "4", title: "Private person name" },
  serviceName: "Sound", isAccepted: true, isValid: true, comment: "Sensitive reason", ...patch });
const event = (rows, patch = {}) => ({ data: {
  id: 8, isCanceled: false, startDate: "2026-03-29T07:00:00Z", eventServices: rows, ...patch,
} });
const result = readChurchToolsVolunteerResponses(event([
  row(1), row(2, { isAccepted: false }), row(3, { isValid: false }), row(4, { person: null }),
  row(5, { person: { domainType: "group", domainIdentifier: "4" } }), row(6, { personId: 5 }),
  row(7, { serviceId: null }), row(8, { isAccepted: "true" }),
]), "8");
assert.deepEqual(result.visible, [{ sourceId: "1", serviceId: "3", personId: "4", name: "Sound", accepted: true },
  { sourceId: "2", serviceId: "3", personId: "4", name: "Sound", accepted: false }]);
assert.deepEqual(result.counts, { hiddenOrUnassigned: 3, inactive: 1, pending: 1, unsupported: 2 });
assert.doesNotMatch(JSON.stringify(result), /Private person name|Sensitive reason/);
assert.throws(() => readChurchToolsVolunteerResponses(event([row(1), row(1)]), "8"), /repeated assignment ID/);
assert.throws(() => readChurchToolsVolunteerResponses(event([], { isCanceled: true }), "8"), /selected active event/);
assert.throws(() => readChurchToolsVolunteerResponses(event([], { id: 9 }), "8"), /selected active event/);
console.log("ChurchTools volunteer response import accepts only active, visible records with exact person identity.");
