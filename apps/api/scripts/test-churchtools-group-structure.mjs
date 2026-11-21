import assert from "node:assert/strict";
import { confirmsPublicStructureEdge, readStructureDefinition, readStructureGroup, singleVisibleParent } from "../src/modules/churchtools-sync/group-structure.ts";

const guid = "681F54E3-2EB7-40A4-84F0-EFF8E8F05727";
const settings = { visibility: "public" };
const info = { groupTypeId: 49, groupCategoryId: 11, note: "Private source notes" };
const source = (properties = {}) => ({ data: { id: 7, guid, name: "Group 7", settings, information: info, ...properties } });
assert.deepEqual(readStructureGroup(source(), "7"), { guid: guid.toLowerCase(), title: "Group 7", public: true, typeId: "49", categoryId: "11" });
assert.equal(readStructureGroup(source(), "8"), null);
assert.equal(readStructureGroup(source({ guid: "invalid" }), "7"), null);
assert.equal(readStructureGroup(source({ settings: { visibility: "intern" } }), "7").public, false);
assert.equal(readStructureGroup(source({ information: {} }), "7").categoryId, undefined);
assert.equal(readStructureGroup(source({ information: { groupCategoryId: null } }), "7").categoryId, null);
assert.deepEqual(readStructureDefinition({ data: { groupTypes: [{ id: 49, name: "Ministry", permissionDepth: 1 }] } }, "groupTypes", "49"), { id: "49", name: "Ministry" });
assert.equal(readStructureDefinition({ data: { groupCategories: [{ id: 11, name: "a" }, { id: 11, name: "b" }] } }, "groupCategories", "11"), null);

const domain = (id, visibility = "public") => ({ domainType: "group", domainIdentifier: String(id), domainAttributes: { visibility } });
const response = (data, count = data.length) => ({ data, meta: { count } });
assert.equal(singleVisibleParent(response([domain(8)])), "8");
assert.equal(singleVisibleParent(response([])), null);
assert.equal(singleVisibleParent(response([domain(8), domain(9)])), null);
assert.equal(singleVisibleParent(response([domain(8)], 2)), null);
assert.equal(singleVisibleParent(response([{ ...domain(8), domainType: "person" }])), null);
const child = { groupId: 7, group: domain(7), parents: [8], children: [] };
const parent = { groupId: 8, group: domain(8), parents: [], children: [7] };
assert.equal(confirmsPublicStructureEdge(response([child, parent]), "7", "8"), true);
assert.equal(confirmsPublicStructureEdge(response([child, parent], 3), "7", "8"), false);
assert.equal(confirmsPublicStructureEdge(response([child, {...parent, group: 8}]), "7", "8"), false);
assert.equal(confirmsPublicStructureEdge(response([child, {...parent, group: domain(8, "intern")}]), "7", "8"), false);
assert.equal(confirmsPublicStructureEdge(response([{...child, parents:[8, 72]}, parent]), "7", "8"), false);
assert.equal(confirmsPublicStructureEdge(response([child, {...parent, children:[]}]), "7", "8"), false);
assert.equal(confirmsPublicStructureEdge(response([child, parent]), "7", "7"), false);

console.log("ChurchTools group identity, classifications, and exact public hierarchy tests passed.");
