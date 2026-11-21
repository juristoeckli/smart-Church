# Community module

The Community module owns group directory and signup routes used by the core Groups page, alongside community posts and resource bookings.

## Group lifecycle and directory views

Local groups have a lifecycle status (`active`, `draft`, `ended`, or `archived`) and optional inclusive start/end dates. Dates are metadata; the system does not automatically change a group's status when a date passes. The API defaults older/create requests without a status to `active` and without dates to `null`, and rejects end dates earlier than start dates. Existing groups are migrated as active with no dates.

Managers can filter the directory by lifecycle status and name, edit dates/status, and save named per-user, per-location combinations of those filters. Saving another view with the same name updates it. Views do not contain group IDs and are not included in standby snapshots. The migration retains the earlier `source_filter` column for installations upgraded from the first saved-view release; the current API uses `status_filter`.

Draft and archived groups are hidden from Check-in choices and are rejected by Check-in roster/pickup mutations. Church Calendar group choices and public-signup selectors only offer active groups. Public group signup endpoints also require active status, and moving a group out of active disables and revokes its public signup token. Calendar-generated registration groups are draft and date-bounded until a manager activates them. Historical group links and administrative group-operation screens may still show ended or archived groups.

ChurchTools and Elvanto imported groups stay source-managed and read-only in the Groups UI. Existing imports receive the database default `active`; source sync does not currently map lifecycle status or dates from either provider, so those values are not authoritative external data. The application does not currently synchronize lifecycle edits back to those providers.

Core standby snapshots include `church_groups` through the core snapshot's `SELECT *`. Snapshot schema version 8 carries lifecycle columns. Restore accepts earlier core snapshots (versions 1–7) and supplies `active`/null date defaults for older group rows. Per-user directory views are local preference records and are not replicated.
