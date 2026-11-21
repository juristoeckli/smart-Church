# Check-in module

The optional Check-in module builds a location-scoped roster from selected active group memberships and records attendance against the existing event check-in records. Authorized event managers who also have `people_manage` can add walk-in visitors directly from the desk; the visitor is created at the current location and marked present as a first-time visitor. Existing matching people block creation, and already-recorded visitors can be checked in again without making another contact.

## Group hierarchy

When the Group Hierarchy schema is installed, the roster offers an explicit **Include members of child groups** option. It is off by default. With it enabled, selecting a parent group includes active memberships from all descendants, including nested age groups. Selecting both a parent and one of its children still shows each person once. The action buttons validate attendance against the same selected group tree.

When Group Hierarchy is not installed, the option is hidden and selection uses only the exact groups chosen. All expansion is scoped to the active location.

## Boundaries

- The member roster includes active memberships in the selected groups; event check-ins for visitor-status contacts are added to the same roster. New visitor contacts require both event-management and People-management permission.
- Check-in uses a staffed desk and standard browser printing. Pickup pairs require current event authorization and contain matching desk references. Guardian names and contact details stay inside the authorized roster and release dialog.
- Group selection aggregates membership records, not ChurchTools age/date rules; age subgroups must already be represented as child groups.
- Event and group managers can record pickup contacts after confirming the parent or guardian's approval for the selected meeting. The attendee and pickup contacts must be active members of the selected group roster from the same location. Previous location-wide contacts appear as suggestions and require fresh confirmation for a meeting.
- Staff can find a checked-in child by name or the printed desk reference, select an authorized contact, verify a photo ID or attest that they personally know the contact, and record the handoff. The app records the authorizing and releasing staff, timestamps and verification method without collecting the ID itself. Each child can be released once per event. The Check-in module locks the pickup list and attendance controls after release, while attendance history retains the arrival.
- Core replication snapshot version 18 includes event pickup state and maps the staff account links to the standby site.
- Completing a meeting closes arrival edits in both Check-in and Services & events. Reopen the meeting to add or reset attendance. Staff can still verify and record authorized pickups, and the existing visitor follow-up workflow remains available. Retrying completion keeps the original closure time and actor. Core snapshots preserve the closed state and remap the completing account.
