import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const hooks = registerHooks({ resolve(specifier, context, next) {
  try { return next(specifier, context); }
  catch (error) {
    if (error.code === "ERR_MODULE_NOT_FOUND" && specifier.startsWith(".") && specifier.endsWith(".js")) return next(specifier.slice(0, -3) + ".ts", context);
    throw error;
  }
} });
const { reviewChurchToolsAbsenceImport, applyChurchToolsAbsenceImport } = await import("../src/modules/churchtools-sync/absence-import.ts");
hooks.deregister();

const scope = { departmentId:"location", instanceUrl:"https://churchtools.invalid", personId:"9", from:"2026-01-01", through:"2026-01-31" };
const row = (sourceId, start, end = start, timed = false) => ({ sourceId, sourceStartDate:start, sourceEndDate:end, timed });
const source = { unsupported:0, dates:[
  row("1","2026-01-01"), row("2","2026-01-03","2026-01-04"), row("3","2026-01-04","2026-01-05",true),
  row("4","2026-01-06"), row("5","2026-01-08"), row("6","2026-01-12"), row("7","2026-01-13"),
] };
let consent = { startsOn:"2026-01-03", endsOn:"2026-01-20", confirmedAt:"2026-01-01 09:00:00+00" };
const local = [{ startsOn:"2026-01-06", endsOn:"2026-01-07" }];
const receipts = [{ source_absence_id:"5",absence_id:null,originalStart:"2026-01-08",originalEnd:"2026-01-08",localStart:null,localEnd:null }];
let writes = 0;
const db = { query:async(sql) => {
  if (/SELECT grant_row/.test(sql)) return {rows:consent?[consent]:[]};
  if (/FROM event_volunteer_absences/.test(sql)) return {rows:local};
  if (/FROM churchtools_migration_absence_receipts/.test(sql)) return {rows:receipts};
  assert.match(sql,/INSERT INTO (event_volunteer_absences|churchtools_migration_absence_receipts)/);
  writes++; return {rowCount:1};
} };
const review = await reviewChurchToolsAbsenceImport(db,scope,"local",source);
assert.deepEqual(review.dates.map(row => row.status),["outside_consent","ready","timed_consent_required","local_overlap","local_removed","ready","ready"]);
await assert.rejects(applyChurchToolsAbsenceImport(db,scope,"local",review,review.reviewHash,["2","3"]), /no longer eligible/);
assert.equal(writes,0);
assert.deepEqual(await applyChurchToolsAbsenceImport(db,scope,"local",review,review.reviewHash,["2"]),{imported:1,replayed:false});
assert.equal(writes,2);
consent=null;
const revoked = await reviewChurchToolsAbsenceImport(db,scope,"local",source);
assert.equal(revoked.dates[1].status,"consent_required");
await assert.rejects(applyChurchToolsAbsenceImport(db,scope,"local",revoked,review.reviewHash,["2"]), /no longer eligible/);
assert.equal(writes,2);
console.log("ChurchTools all-day absence import preserves local data and requires an active date-scoped grant.");

const timedScope = { ...scope, from: "2026-10-25", through: "2026-10-25" };
const sourceTimed = { unsupported: 0, dates: [{
  sourceId: "8", sourceStartDate: "2026-10-25", sourceEndDate: "2026-10-25", timed: true,
  startUtc: "2026-10-25T00:30:00.000Z", endUtc: "2026-10-25T01:30:00.000Z",
}] };
const zone = "Europe/Zurich";
const legacyConsent = { startsOn:"2026-10-25", endsOn:"2026-10-25", allowTimed:false, confirmedAt:"2026-10-23 09:00:00+00" };
let activeTimed = legacyConsent;
const timedDb = { query: async(sql) => {
  if (/SELECT grant_row/.test(sql)) return {rows:[activeTimed]};
  if (/SELECT time_zone/.test(sql)) return {rows:[{time_zone:zone}]};
  if (/SELECT first_day|SELECT receipt/.test(sql)) return {rows:[]};
  throw new Error("Unexpected query");
} };
const legacyReview = await reviewChurchToolsAbsenceImport(timedDb,timedScope,"local",sourceTimed,false,"Europe/Berlin");
assert.equal(legacyReview.dates[0].status,"timed_consent_required");
assert.doesNotMatch(JSON.stringify(legacyReview.dates),/00:30/);
const differentPrivateClocks = { ...sourceTimed, dates: [{ ...sourceTimed.dates[0], startUtc: "2026-10-25T00:35:00.000Z" }] };
assert.equal((await reviewChurchToolsAbsenceImport(timedDb,timedScope,"local",differentPrivateClocks,false,"Europe/Berlin")).reviewHash, legacyReview.reviewHash);
activeTimed={...legacyConsent,allowTimed:true,timedZone:zone};
const timedReview = await reviewChurchToolsAbsenceImport(timedDb,timedScope,"local",sourceTimed,false,"Europe/Berlin");
assert.equal(timedReview.dates[0].status,"ready");
assert.equal(timedReview.dates[0].startUtc,"2026-10-25T00:30:00.000Z");
assert.equal(timedReview.dates[0].localStart,timedReview.dates[0].localEnd);
assert.equal((await reviewChurchToolsAbsenceImport(timedDb,timedScope,"local",sourceTimed)).dates[0].status,"unverified_source_time");
assert.equal((await reviewChurchToolsAbsenceImport(timedDb,timedScope,"local",sourceTimed,false,"Pacific/Honolulu")).dates[0].status,"unverified_source_time");
console.log("Timed import requires explicit consent and preserves both instants in a repeated local clock hour.");
