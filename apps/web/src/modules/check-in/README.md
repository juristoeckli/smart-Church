# Check-in module

Provides a meeting picker backed by `service_events`, multi-group roster selection backed by `church_groups` and `group_members`, search/sorting/present-only views, and arrival/reset actions persisted in `event_attendance_checkins`. Contact and event queries are scoped to the active location. Writes require CSRF and event or group management permission (or Check-in manage grant).

Choose A4 or Letter sheets, 62 × 38 mm labels, or 89 × 36 mm labels in Print settings, then select the matching media in the browser print dialog. Show or hide the meeting and group, and select a full surname or initial for name labels. Settings are saved in this browser for the current location.

In the staffed station, print one checked-in attendee’s badge or pickup pair, or select **Check in & print** to print after attendance is saved. If current pickup authorization cannot be confirmed, this action prints a name label. A pickup pair prints a child label and a guardian slip with the same desk reference. Both use the child’s surname initial. The guardian slip contains no guardian names or contact details. Managers can confirm pickup contacts with a parent or guardian for the selected meeting. The authorized contacts must belong to the active roster for the selected groups in the same location.

At the staffed station or full roster, staff can find the child by name or the printed desk reference. Choose **Verify pickup**, select the authorized contact, record how you verified their identity, and submit the release. The roster displays who collected the child and when. A desk reference only finds the roster entry. Staff still need to verify the contact in person.
