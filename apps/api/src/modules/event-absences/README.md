# Volunteer absences

This optional location-scoped module lets members record unavailable date ranges and lets event managers identify assigned volunteers who have an active absence on an event date.

## Included

- A member can create a holiday, illness, family, work, or other absence and add a private note.
- Any authenticated member of the active location can create, read, or cancel only their linked person's records, mapped through `department_memberships.contact_id`. Managers can also cancel records from the manager workflow.
- Overlapping active date ranges for one person are rejected. Cancelled records remain available as history.
- Event managers (`events_manage`), site admins, and module managers can view assigned-role conflicts for a selected date range. The matrix shows event, role, person, response state, absence dates, and reason; it does not include private notes. Private notes are returned only on the owner's own absence history.
- Conflicts are informational. They do not cancel, reassign, or otherwise edit volunteer positions.
- Mutations require CSRF validation and location-scoped database access. Creation and cancellation are recorded in an audit table.

## Boundaries

- A person must already be linked to a People record. If no `department_memberships.contact_id` link exists, the module asks the user to link the account first.
- Reasons are a fixed set; custom reason catalogs, approval workflows, recurring absences, reminders, email notifications, and calendar feeds are not implemented.
- Managers see assigned positions that overlap absences, not a full staffing-by-absence heatmap for every volunteer.
