# General Calendar module

The optional `church-calendar` module adds community, group and personal calendars alongside the existing service/event schedule. Its API and UI are discovered from this folder's `manifest.json` and the web module's `module.tsx` registration.

## Included workflows

- Create personal calendars and permission-controlled community/group calendars.
- Create, edit, archive and restore appointments with title, subtitle, description, place, web link, image, all-day and internal flags, tags, service-event links, approved resource-booking links, and public group signup links.
- Appointments can be assigned to a location People record using the “On behalf of” field. Searching and setting a person requires private People access; names and IDs are omitted from calendar responses for other viewers and are not included in public ICS feeds. Per-occurrence assignments are supported.
- Day, week, month, year and list views, calendar selection, date navigation and a compact month picker.
- Daily, weekly, monthly by date, monthly by weekday (first through fourth or last, every N months), yearly and manual-date recurrence with interval/end/count options, extra dates that can be reviewed and removed independently, per-occurrence exceptions, split-future edits and series-wide edits.
- Site-scoped records and location permission checks. Personal calendars are private to their owner; group calendars are visible to group members and calendar managers.
- Community calendars can issue a revocable tokenized iCalendar feed. The read-only feed includes only non-internal appointments on that community calendar, expands occurrences for the next year, and never includes personal or group calendars. Rotating the link invalidates the prior token.
- Series occurrences can override their linked service-event record using the existing occurrence exception mechanism.
- Linked service events open directly from Calendar. Community occurrences with native public event registration show the link, capacity and waitlist totals. Organizers use the linked event's existing registration and attendance controls.
- Group managers can explicitly generate one local registration group for every recurring appointment occurrence through a chosen date (up to five years and 500 generated/extra dates). The groups are created unpublished to the public signup workflow, and public signup stays disabled until a group manager enables it. Per-occurrence group links live in the existing exception overrides, so other occurrence edits and cancellations are retained; rerunning skips linked or cancelled dates.
- Event managers can explicitly choose an active, location-scoped service-plan template and preview creation of one service event for each eligible recurring appointment occurrence through a chosen date (up to five years and 500 generated/extra dates). Managers with private People access can map template roles to People contacts before previewing; the API rechecks each location-scoped contact and role against the current template, then copies the validated assignments into generated event positions. Managers without private People access can generate the same events with unassigned positions. Confirmation creates events transactionally, copies the template's positions and service-plan items, and links each event through the existing per-occurrence exception override. Existing event links and cancelled occurrences are skipped; an audit row records the template, actor, appointment, date and created event.
- Appointments and individual series occurrences can link to a group with public signup enabled. The calendar shows a direct signup link to the existing group signup page; it does not create a separate registration roster or capacity for calendar events.
- Appointment images accept JPEG, PNG, GIF, or WebP up to 1 MiB; uploads validate file signatures, are location-scoped, and downloads follow the calendar's visibility rules.

Organizers can select a named time zone or follow the location time zone. Existing appointments follow the location zone. If the location zone is unrecognized, Calendar uses UTC. Recurring appointments keep their authored clock time and calendar date. Timed occurrences expose UTC instants and public iCalendar exports use those instants. The calendar labels times authored in another zone. All-day appointments use calendar dates.

The editor rejects timed values in a spring-forward gap. If a recurring date later lands in a gap, its start shifts forward by the gap and keeps its duration. A repeated fall-back time uses the later instant. Generated service events use the location clock and reject timed occurrences that cross midnight there.

## Follow-up parity work

The feed currently expands one year ahead and does not emit resource bookings, participant registration groups, or event staffing.

Generated service events leave public registration disabled by default. Managers can opt in for community appointments without internal occurrences and set an optional capacity per event. Each generated event gets its own link and uses the existing Services & events registration and waitlist. Existing linked events remain unchanged.

Remaining parity work includes setup/lead-in and cleanup/lag buffers on resource bookings, calendar sharing controls beyond location roles, and a per-viewer calendar display time zone. Generated service events include the appointment title, time, place and description. Images still need malware scanning and version history.
