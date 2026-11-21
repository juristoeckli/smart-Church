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
- Group managers can explicitly generate one local registration group for every recurring appointment occurrence through a chosen date (up to five years and 500 generated/extra dates). The groups are created unpublished to the public signup workflow, and public signup stays disabled until a group manager enables it. Per-occurrence group links live in the existing exception overrides, so other occurrence edits and cancellations are retained; rerunning skips linked or cancelled dates.
- Event managers can explicitly choose an active, location-scoped service-plan template and preview creation of one service event for each eligible recurring appointment occurrence through a chosen date (up to five years and 500 generated/extra dates). Managers with private People access can map template roles to People contacts before previewing; the API rechecks each location-scoped contact and role against the current template, then copies the validated assignments into generated event positions. Managers without private People access can generate the same events with unassigned positions. Confirmation creates events transactionally, copies the template's positions and service-plan items, and links each event through the existing per-occurrence exception override. Existing event links and cancelled occurrences are skipped; an audit row records the template, actor, appointment, date and created event.
- Appointments and individual series occurrences can link to a group with public signup enabled. The calendar shows a direct signup link to the existing group signup page; it does not create a separate registration roster or capacity for calendar events.
- Appointment images accept JPEG, PNG, GIF, or WebP up to 1 MiB; uploads validate file signatures, are location-scoped, and downloads follow the calendar's visibility rules.

Appointment wall-clock values are stored as local timestamps so recurring entries preserve the same displayed clock time across series. This first pass does not yet convert display values between different user/location time zones. The calendar treats these values as floating local time and does not resolve daylight-saving transitions against a named timezone: a wall time skipped by a spring-forward transition or repeated during a fall-back transition can be interpreted differently by external clients. Public community feeds convert timed occurrences to UTC using the location time zone. At a daylight-saving gap or overlap, PostgreSQL applies the standard-time interpretation. If a gap would collapse a positive event duration, the feed keeps its wall-clock duration after the adjusted start. All-day events remain date-only with an exclusive end date.

## Follow-up parity work

The feed currently expands one year ahead and does not emit resource bookings, participant registration groups, or event staffing.

Generated service events leave public registration disabled by default. Managers can opt in for community appointments without internal occurrences and set an optional capacity per event. Each generated event gets its own link and uses the existing Services & events registration and waitlist. Existing linked events remain unchanged.

Remaining parity work includes setup/lead-in and cleanup/lag buffers on resource bookings, calendar sharing controls beyond location roles, and timezone conversion across users and locations. Generation currently uses the appointment title, time, place and description, rejects occurrences crossing midnight; it does not copy event assets. Images do not yet have malware scanning or version history.
