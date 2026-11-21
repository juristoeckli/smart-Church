import assert from "node:assert/strict";
import { readChurchToolsMembershipFieldDefinitions, normalizeVisibleChurchToolsMembershipFields } from "../src/modules/churchtools-sync/group-membership-custom-fields.ts";

const definition = (id, name, referenceName, fieldTypeCode, extra = {}) => ({
  type: "group", field: { id, groupId: 8, name, referenceName, fieldTypeCode, securityLevel: 3, ...extra },
});
const payload = (...data) => ({ data, meta: { count: data.length } });
const catalog = readChurchToolsMembershipFieldDefinitions(payload(
  definition(11, "Shirt", "shirt", "select", { options: [{ id: "03", name: "Medium" }, { id: "5", name: "Unselected private option" }] }),
  definition(12, "Slots", "slots", "multiselect", { options: [{ id: "4", name: "Morning" }] }),
  definition(13, "Attendance", "attendance", "checkbox"),
  definition(14, "Description", "description", "textarea"),
  definition(15, "Unavailable definition", "unavailable", "text", { defaultValue: "Unseen default" }),
  definition(16, "API Key", "api-key", "text"),
  definition(17, "External data", "external", "api"),
  definition(18, "Other group", "other-group", "text", { groupId: 9 }),
  { type: "person", field: { id: 19, groupId: 8 } },
), "8");

assert.equal(catalog.size, 5);
const values = normalizeVisibleChurchToolsMembershipFields([
  { id: 11, value: "03" }, { id: 12, value: ["4", "8"] }, { id: 13, value: "0" }, { id: 14, value: "  Original\ntext  " },
  { id: 16, value: "excluded credential data" }, { id: 17, value: "excluded app data" }, { id: 18, value: "wrong group data" },
  { id: 19, value: "person data" }, { id: 20, value: "no definition" },
], catalog);
assert.equal(values.length, 4);
assert.deepEqual(values[0], { sourceId: "11", name: "Shirt", referenceName: "shirt", fieldType: "select", securityLevel: 3, value: "03", selectedOptions: [{ sourceId: "03", name: "Medium" }] });
assert.deepEqual(values[1].selectedOptions, [{ sourceId: "4", name: "Morning" }, { sourceId: "8", name: "8" }]);
assert.equal(values[2].value, "0");
assert.equal(values[3].value, "  Original\ntext  ");
assert.doesNotMatch(JSON.stringify(values), /Unselected private option|Unseen default|Unavailable definition|excluded|wrong group|person data|no definition/);
assert.deepEqual(normalizeVisibleChurchToolsMembershipFields(null, catalog), []);
assert.equal(normalizeVisibleChurchToolsMembershipFields([{ id: 15, value: null }], catalog)[0].value, null);
assert.deepEqual(normalizeVisibleChurchToolsMembershipFields([{ id: 13, value: "true" }, { id: 12, value: "4" }, { id: 14, value: {} }], catalog), []);
assert.throws(() => normalizeVisibleChurchToolsMembershipFields([{ id: 11, value: "03" }, { id: 11, value: "5" }], catalog), /repeated/);
assert.throws(() => readChurchToolsMembershipFieldDefinitions({ data: [], meta: { count: 1 } }, "8"), /incomplete/);
console.log("ChurchTools custom membership fields preserve visible values and selected labels.");
