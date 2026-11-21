# Group administration

Group administration manages group trees, membership roles, custom membership values, invitations, and change history for the active location.

Group leaders and managers can review the latest 200 invitations for a group, including recipient, creation/expiry dates and pending, accepted, revoked or expired status. They can revoke pending invitations. Invitation tokens are never included in the history response; a newly created token is returned once so the creator can share the link. Invitation emails are not sent automatically.

## Group leadership roster

Users with `groups_manage` or the Group Administration `manage` grant can load a roster of active group members whose roles identify them as leader, co-leader, group owner, or group manager. The roster shows each person's group, parent group, role, membership start date, and group description, and can be exported as CSV. Email is shown only to site admins and users with private People access. The API caps the roster at 5,000 rows and scopes all group and contact records to the active location.

Role matching normalizes punctuation and case, so common values such as `Co-Leader` and `Group Manager` match. Custom role labels and titles outside those recognized role names are not included automatically.

## Group notes

Active group leaders and location group managers can view and add private notes scoped to a local or imported group. Notes include a title, body, author, and timestamps; note bodies are limited to 10,000 characters and the list returns the latest 200 active notes. Authors can archive their own notes, and group managers can archive any note. Archiving retains the note row for audit retention, but archived notes are not displayed in the module. Other users receive an empty notes list and cannot read note content.
