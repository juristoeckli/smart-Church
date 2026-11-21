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
const { normalizeChurchToolsGroupMembership, readChurchToolsGroupMemberships, readChurchToolsGroupRoles } = await import("../src/modules/churchtools-sync/group-membership.ts");
hook.deregister();

const roles = readChurchToolsGroupRoles({ data: [{ id: 1, name: " Leader " }, { id: 2, nameTranslated: "Participant" }], meta: { count: 2 } });
assert.deepEqual([...roles], [["1", "Leader"], ["2", "Participant"]]);
assert.throws(() => readChurchToolsGroupRoles({ data: [], meta: { count: 1 } }), /incomplete/);
assert.throws(() => readChurchToolsGroupRoles({ data: [{ id: 1, name: "Leader" }, { id: 1, name: "Duplicate" }], meta: { count: 2 } }), /duplicate/);

const row = { id: 16, person: { domainIdentifier: "41", icon: "user" }, personId: "51", groupTypeRoleId: 1,
  groupMemberStatus: "requested", memberStartDate: "2026-02-28", memberEndDate: "2026-12-31",
  comment: " Private remark ", waitinglistPosition: 3, registeredBy: 8, roleChangedDate: "2026-02-26T11:00:00Z",
  statusChangedDate: "2026-02-27T11:00:00Z", fields: [{ id: 3, name: "Private field", value: "Private field value" }] };
assert.deepEqual(normalizeChurchToolsGroupMembership(row, roles), {
  sourceId: "16", sourcePersonId: "41", roleId: "1", role: "Leader", roleKnown: true, sourceStatus: "requested", status: "paused",
  joinedOn: "2026-02-28", plannedEndOn: "2026-12-31", comment: "Private remark", waitingListPosition: 3, registeredBySourceId: "8",
  roleChangedAt: "2026-02-26T11:00:00Z", statusChangedAt: "2026-02-27T11:00:00Z", customFieldCount: 1,
});
assert.equal(normalizeChurchToolsGroupMembership({ ...row, groupMemberStatus: "to_delete" }, roles).status, "paused");
assert.equal(normalizeChurchToolsGroupMembership({ ...row, groupMemberStatus: "waiting" }, roles).status, "waitlist");
assert.equal(normalizeChurchToolsGroupMembership({ ...row, groupMemberStatus: "active" }, roles).status, "active");
assert.equal(normalizeChurchToolsGroupMembership({ ...row, groupTypeRoleId: 5 }, roles).role, "Member");
assert.equal(normalizeChurchToolsGroupMembership({ ...row, memberStartDate: "2026-02-29" }, roles).joinedOn, null);
assert.equal(normalizeChurchToolsGroupMembership({ ...row, person: { ...row.person, icon: "user-shield" } }, roles), null);
assert.throws(() => normalizeChurchToolsGroupMembership({ ...row, groupMemberStatus: "unknown" }, roles), /invalid/);
assert.doesNotMatch(JSON.stringify(normalizeChurchToolsGroupMembership(row, roles)), /Private field/);

const page = (data, current, lastPage, total) => ({ data, meta: { count: data.length, pagination: { current, lastPage, total } } });
const members = await readChurchToolsGroupMemberships(async (current, limit) => {
  assert.equal(limit, 200);
  return page(current === 1 ? [row] : [{ id: 17, person: { icon: "user-shield" } }], current, 2, 2);
}, roles);
assert.equal(members.members.length, 1);
assert.equal(members.concealed, 1);
assert.deepEqual(await readChurchToolsGroupMemberships(async () => page([], 1, 0, 0), roles), { members: [], concealed: 0 });
await assert.rejects(readChurchToolsGroupMemberships(async (current) => page([row], current, 2, 2), roles), /repeated/);
await assert.rejects(readChurchToolsGroupMemberships(async () => page([row], 1, 1, 2), roles), /incomplete/);
await assert.rejects(readChurchToolsGroupMemberships(async () => page([row], 1, 101, 20_001), roles), /20,000 memberships/);
console.log("ChurchTools group membership status, role, visibility, and pagination tests passed.");
