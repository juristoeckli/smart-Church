# Check-in module

Provides a meeting picker backed by `service_events`, multi-group roster selection backed by `church_groups` and `group_members`, search/sorting/present-only views, and arrival/reset actions persisted in `event_attendance_checkins`. Contact and event queries are scoped to the active location. Writes require CSRF and event or group management permission (or Check-in manage grant).

The print action formats visible attendees as printable labels with a pickup line. It does not print from the server. Completion/reopen state is stored per event and records the latest actor/time; it does not lock the event. Event or group managers can record pickup contacts for roster attendees after confirming authorization with a parent/guardian; the interface records the confirming manager/time and shows the names on check-in labels. The API only accepts authorized contacts who are active members of the selected roster groups in the same location.

Pickup confirmation is a manager attestation; Smart-Church does not contact guardians or independently verify their consent. The current picker can select only from the visible roster, and pickup authorizations are shared for that attendee across meetings rather than being event-specific. Dedicated unattended kiosk mode, short check-in codes, pickup codes/guardian identity verification, and printer hardware integration remain open.
