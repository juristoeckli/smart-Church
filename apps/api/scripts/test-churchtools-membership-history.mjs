import assert from "node:assert/strict";
import {
  isVisibleChurchToolsHistoryPerson,
  membershipHistoryCursor,
  readChurchToolsMembershipHistoryPage,
  readMembershipHistoryCursor,
} from "../src/modules/churchtools-sync/membership-history.ts";

const baseline = { memberRoleId: null, membershipStatus: null, startDate: null, endDate: null };
const row = (id, props = {}) => ({
  id,
  memberId: 9,
  groupId: 7,
  meta: { createdDate: "2026-11-20T11:30:00.3Z", createdPerson: { id: 99 } },
  previous: { ...baseline, comment: "private" },
  current: { ...baseline, memberRoleId: 10, membershipStatus: "active", fields: [{ value: "private" }] },
  ...props,
});
const batch = (...data) => ({ data, meta: { count: data.length } });
const payload = batch(
  row(24),
  row(23, { current: { ...baseline, comment: "protected-only change" } }),
  row(22, { meta: { createdDate: "2026-02-30T11:30:00Z" } }),
  row(21, { current: { ...baseline, endDate: "2026-02-30" } }),
);
const expectedState = { roleId: null, status: null, startsOn: null, endsOn: null };
assert.deepEqual(readChurchToolsMembershipHistoryPage(payload, "7"), {
  rows: [{
    sourceId: "24", personId: "9", changedAt: "2026-11-20T11:30:00.300Z",
    previous: expectedState, current: { ...expectedState, roleId: "10", status: "active" },
  }],
  nextOffset: null,
});
const fullPage = batch(...Array.from({ length: 19 }, (_, i) => row(30 - i)), row(11, { current: baseline }));
assert.equal(readChurchToolsMembershipHistoryPage(fullPage, "7").nextOffset, "11");
assert.equal(readChurchToolsMembershipHistoryPage(fullPage, "7").rows.length, 19);
assert.throws(() => readChurchToolsMembershipHistoryPage(payload, "8"));
assert.throws(() => readChurchToolsMembershipHistoryPage(payload, "7", "24"));
assert.throws(() => readChurchToolsMembershipHistoryPage(batch(row(2), row(3)), "7"));
assert.throws(() => readChurchToolsMembershipHistoryPage({ ...payload, meta: { count: 1 } }, "7"));

assert.equal(isVisibleChurchToolsHistoryPerson({ data: { id: 9, visibility: "visible" } }, "9"), true);
for (const data of [{ id: 9 }, { id: 9, visibility: "hidden" }, { id: 10, visibility: "visible" }]) {
  assert.equal(isVisibleChurchToolsHistoryPerson({ data }, "9"), false);
}

const scope = { departmentId: "site", instanceUrl: "https://test.invalid", ownerSourceId: "9", actor: "user", groupId: "7" };
const cursor = membershipHistoryCursor(scope, "11", 1_000);
assert.equal(readMembershipHistoryCursor(cursor, scope, 1_001), "11");
assert.equal(readMembershipHistoryCursor(cursor, scope, cursor.expiresAt), null);
for (const key of Object.keys(scope)) {
  assert.equal(readMembershipHistoryCursor(cursor, { ...scope, [key]: "other" }, 1_001), null);
}
assert.equal(readMembershipHistoryCursor({ ...cursor, offsetId: "9999999999999999" }, scope, 1_001), null);

console.log("ChurchTools membership history projection, visibility, and cursor checks passed.");
