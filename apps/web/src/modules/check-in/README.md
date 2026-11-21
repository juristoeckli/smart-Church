# Check-in module

Provides a meeting picker backed by `service_events`, multi-group roster selection backed by `church_groups` and `group_members`, search/sorting/present-only views, and arrival/reset actions persisted in `event_attendance_checkins`. Contact and event queries are scoped to the active location. Writes require CSRF and event or group management permission (or Check-in manage grant).

The print actions format visible attendees as name labels or pickup slips in the browser. Managers can confirm pickup contacts with a parent or guardian for the selected meeting. The authorized contacts must belong to the active roster for the selected groups in the same location.

At the staffed station or full roster, staff can find the child by name or the printed desk reference. Choose **Verify pickup**, select the authorized contact, record how you verified their identity, and submit the release. The roster displays who collected the child and when. A desk reference only finds the roster entry. Staff still need to verify the contact in person.
