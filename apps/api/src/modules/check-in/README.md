# Check-in module

The optional Check-in module builds a location-scoped roster from selected active group memberships and records attendance against the existing event check-in records. Authorized event managers who also have `people_manage` can add walk-in visitors directly from the desk; the visitor is created at the current location and marked present as a first-time visitor. Existing matching people block creation, and already-recorded visitors can be checked in again without making another contact.

## Group hierarchy

When the Group Hierarchy schema is installed, the roster offers an explicit **Include members of child groups** option. It is off by default. With it enabled, selecting a parent group includes active memberships from all descendants, including nested age groups. Selecting both a parent and one of its children still shows each person once. The action buttons validate attendance against the same selected group tree.

When Group Hierarchy is not installed, the option is hidden and selection uses only the exact groups chosen. All expansion is scoped to the active location.

## Boundaries

- The member roster includes active memberships in the selected groups; event check-ins for visitor-status contacts are added to the same roster. New visitor contacts require both event-management and People-management permission.
- This is a staffed check-in desk, not an unattended kiosk. It does not verify guardian pickup identity or print to dedicated label hardware.
- Group selection aggregates membership records, not ChurchTools age/date rules; age subgroups must already be represented as child groups.
- Event/group managers can record attendee pickup contacts after attesting that a parent/guardian approved the list. The API restricts both the attendee and authorized contacts to active members of the selected groups in the same location. Manager and confirmation time are retained, and names appear on printable labels.
- Pickup authorization rows are part of core-site replication snapshots (snapshot version 7); standby restore remaps the confirming manager account ID while preserving the contact links.
- Guardian authorization is a manager attestation; no guardian is contacted and consent is not independently verified. The picker is limited to the visible roster, and authorizations apply across meetings rather than to one event. Short check-in codes, pickup identity verification, and unattended kiosk mode remain open.
