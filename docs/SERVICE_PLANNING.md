# Service planning

Service-plan roles can have separate staff notes. These notes are stored independently from public run-sheet items and are never returned with the general event list. Event managers can read and edit notes for any role. A member assigned to a role can read only that role's note after linking their location membership to the assigned People record; assigned members cannot edit notes. Each change records the actor, timestamp, action, and note length in a location-scoped audit table. Deleting an event cascades its notes and audit history.

Imported ChurchTools and Elvanto event assignments remain read-only, so staff notes cannot be changed on those events. Notes are limited to 500 characters. This first version does not provide separate note visibility groups, attachments, or per-item note threads.

## Volunteer duty swaps

An assigned volunteer can ask another volunteer assigned to the same upcoming event to exchange their two positions. The recipient can accept or decline, and the requester can cancel while the request is pending. Acceptance swaps the assignments atomically and resets both volunteers' response statuses to pending. Requests are location-scoped, visible to the involved volunteers and event managers, and are included in core standby snapshots. Imported event assignments remain read-only. The workflow does not send email or push notifications yet; volunteers see requests in the Events schedule.

## Bulk assignment

An event manager can choose one location People record and assign that volunteer to multiple currently unfilled roles on a single event. The API checks event-management permission, locks the event, verifies each submitted role index and name still matches an unfilled role, checks that the volunteer belongs to the same location, and writes the position list and pending response rows in one transaction. If a role was filled or renamed after the page loaded, the entire request is rejected and the manager can refresh. Imported ChurchTools and Elvanto events remain read-only. Qualification matching for event positions is described in the next section.

## Volunteer qualifications

Event managers can define location-scoped qualifications and free-text categories, then maintain which member records hold each qualification. A service-event role or reusable service-plan template role can require one or more active qualifications. Applying a template copies its requirements to the event while preserving matching volunteer assignments; generating service events from a calendar series copies requirements to every generated event. Direct assignment and bulk assignment filter candidates to volunteers who hold every selected requirement; the API independently checks qualifications on create, edit, bulk assignment, duty-swap acceptance, template save, and calendar-series generation. Removing a qualification from a volunteer or deactivating a qualification is blocked while a future service role or active template still requires it, so requirements cannot silently become invalid. Qualification definitions and volunteer mappings are included in core site replication snapshots.

This first slice has no expiry dates, credential attachments, approval workflow, or verification reminders. It uses manually maintained member-to-qualification mappings; it does not verify certificates externally.

## Role categories

Managers can give each event or reusable service-plan role an optional category, such as Audio or Welcome. Categories are limited to 80 characters and can be left blank; existing event and template data continues to work. In the Events list, managers can filter the duty roster to one category or uncategorized roles. The staffing CSV follows the selected category and includes the category label as its own column. Applying a service-plan template carries category labels and qualification requirements forward while keeping matching volunteer assignments.
