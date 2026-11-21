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
assert.deepEqual(review.dates.map(row => row.status),["outside_consent","ready","timed_source","local_overlap","local_removed","ready","ready"]);
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
