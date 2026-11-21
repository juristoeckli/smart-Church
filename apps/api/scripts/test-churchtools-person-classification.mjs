import assert from "node:assert/strict";
import { churchToolsPersonStatus, churchToolsPersonTags } from "../src/modules/churchtools-sync/person-classification.ts";

const person = (props = {}) => ({ data: { statusId: 118, isArchived: false, isDead: false, ...props } });
const definition = { id: 118, name: "Community", isMember: true, isSearchable: true, securityLevelId: 3 };
const catalogs = (statuses = [definition]) => ({ data: { statuses } });
assert.deepEqual(churchToolsPersonStatus(person(), catalogs()), {
  sourceId: "118", name: "Community", isMember: true, proposed: "member",
});
assert.equal(churchToolsPersonStatus(person(), catalogs([{ ...definition, isMember: false }])).proposed, "visitor");
assert.equal(churchToolsPersonStatus(person({ isArchived: true }), catalogs()).proposed, null);
assert.equal(churchToolsPersonStatus(person({ isDead: true }), catalogs()).proposed, null);
assert.equal(churchToolsPersonStatus(person({ isDead: undefined }), catalogs()).proposed, null);
assert.equal(churchToolsPersonStatus(person({ statusId: undefined }), catalogs()), null);
assert.equal(churchToolsPersonStatus(person(), catalogs([{ ...definition, id: 1, name: "Member" }])), null);
assert.equal(churchToolsPersonStatus(person(), catalogs([definition, definition])), null);
assert.equal(churchToolsPersonStatus(person(), catalogs([{ ...definition, isMember: 1 }])), null);

const tag = { id: 52, name: "Music", description: "Protected notes", count: 1 };
const list = (data, count = data.length) => ({ data, meta: { count } });
assert.deepEqual(churchToolsPersonTags(list([tag])), [{ sourceId: "52", name: "Music" }]);
assert.deepEqual(churchToolsPersonTags(list([])), []);
assert.equal(churchToolsPersonTags(list([tag], 2)), null);
assert.equal(churchToolsPersonTags(list([tag, tag])), null);
assert.equal(churchToolsPersonTags(list([{ ...tag, name: "\u202e" }])), null);
assert.equal(churchToolsPersonTags(null), null);

console.log("ChurchTools People status and tag contract checks passed.");
