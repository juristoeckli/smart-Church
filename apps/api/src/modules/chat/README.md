# Chat module

## Church group chats

Chat can associate one existing group conversation with a locally managed church group. Active members whose group contact is linked to a Smart-Church account can open the conversation. A member with a recognized leader, co-leader, owner, or manager role, or a department-level group manager, can create it the first time. Members are derived from the current active group membership; the chat API does not provide manual add, remove, role, rename, or delete operations for a linked group conversation. Existing direct messages and manually managed group conversations keep their existing behavior.

The API checks active group membership on every conversation access and message action. Removing a person from the group blocks their access immediately, even before participant rows are synchronized. Opening the group chat or loading the conversation list synchronizes participants: newly active members with linked accounts are added, and people no longer active are removed. Thus membership is dynamic, while stored membership rows are a cache reconciled on those requests. Other participants and contact details are only returned by the regular conversation APIs to authorized conversation members; the group picker lists only the current user's own active groups.

Deleting a linked church group deletes its associated chat conversation, messages, and related records through a Chat-owned database trigger. Group records managed by an external sync source are not offered for linking.

## Replication and limits

Chat snapshot schema version 10 includes group-to-conversation links along with conversations, participants, messages, and receipts. The group records and their IDs are owned by the core group data; linked Chat snapshots assume those same group IDs exist on the standby server. Schema versions 9 and earlier are not accepted as current Chat snapshots and require both servers to initialize the new schema before replication is ready.

A department group manager who is not an active member cannot open or create the group's chat. This keeps the manager role from implicitly granting access to message history or participant lists; a manager must also be an active group member to use the linked conversation. Only local groups are supported. Chat participant synchronization occurs when someone loads the conversation list or opens that group chat, rather than in a background job. Access checks still use live membership, so a removed member is denied immediately, but participant display data can remain stale until the next synchronization request.
