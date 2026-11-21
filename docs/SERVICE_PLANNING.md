# Service planning

Service-plan roles can have separate staff notes. These notes are stored independently from public run-sheet items and are never returned with the general event list. Event managers can read and edit notes for any role. A member assigned to a role can read only that role's note after linking their location membership to the assigned People record; assigned members cannot edit notes. Each change records the actor, timestamp, action, and note length in a location-scoped audit table. Deleting an event cascades its notes and audit history.

Imported ChurchTools and Elvanto event assignments remain read-only, so staff notes cannot be changed on those events. Notes are limited to 500 characters. This first version does not provide separate note visibility groups, attachments, or per-item note threads.

## Volunteer duty swaps

An assigned volunteer can ask another volunteer assigned to the same upcoming event to exchange their two positions. The recipient can accept or decline, and the requester can cancel while the request is pending. Acceptance swaps the assignments atomically and resets both volunteers' response statuses to pending. Requests are location-scoped, visible to the involved volunteers and event managers, and are included in core standby snapshots. Imported event assignments remain read-only. The workflow does not send email or push notifications yet; volunteers see requests in the Events schedule.

## Bulk assignment

An event manager can choose one location People record and assign that volunteer to multiple currently unfilled roles on a single event. The API checks event-management permission, locks the event, verifies each submitted role index and name still matches an unfilled role, checks that the volunteer belongs to the same location, and writes the position list and pending response rows in one transaction. If a role was filled or renamed after the page loaded, the entire request is rejected and the manager can refresh. Imported ChurchTools and Elvanto events remain read-only. There is no role qualification model yet, so the current compatibility check is limited to assigning only valid, unfilled roles.
