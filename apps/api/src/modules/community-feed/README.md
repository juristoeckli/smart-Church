# Community Feed

The module provides a location-scoped post feed with group visibility, group subscriptions, scheduled publication, post editing, comment controls, four reactions, filters, hide/unhide, shareable post links, user-submitted post reports, a site-admin review queue, and an in-app notification inbox.

Feed notifications cover published posts in groups the recipient follows (or member-only group posts), reactions, and comments. Users can set separate per-location preferences for these three notification kinds; all are enabled by default. Preferences affect newly created notifications only and do not hide posts or delete existing inbox history. The inbox shows unread state, supports mark-read actions, and checks the current post visibility before showing a notification. Community Feed snapshots are version 7 and include notification, report and preference records; restore remains compatible with versions 1 through 7.

Group subscription, post destination, filter, and linked-group selectors show active groups only. The API validates new subscriptions, destinations, and group links as active. Existing posts and group links remain stored and continue to follow their existing visibility rules when a group later becomes inactive; users can still unsubscribe from an older group subscription.

## Post reports

Members can report another author's visible post with a reason (spam, inappropriate, harmful, or other) and optional details up to 500 characters. The API checks the post's current audience and location. Each member can submit one report per post. Site admins can review open, dismissed, and actioned reports, and update open reports with a dismissal or actioned state. Report actions do not automatically remove or hide the post.

## Media and linked records

- Authors and site admins can attach up to five files per post. Each file is limited to 1 MiB. Accepted types are JPEG, PNG, GIF, WebP, PDF, and plain text. Uploads are stored in the module database with the location and post IDs; downloads require the current location and the same post visibility checks as the feed.
- Authors and site admins can link a post to an active location Person, Group, Wiki page, or Worship song. Search is allow-listed by entity type and location; link creation revalidates that the target exists in that location. The UI renders these as typed references, rather than accepting arbitrary external URLs.
- Wiki link search, creation and feed display respect the linked page's audience; inaccessible or archived Wiki pages are not suggested or shown.
- Feed snapshots are version 7 and include post attachments, links, notifications, reports, and per-user notification preferences. Restore accepts versions 1 through 7; older snapshots continue to restore with empty newer records.

## Known gaps

- Attachments are limited to five 1 MiB files per post and the accepted MIME list above; there is no image resizing, video, audio, or virus scanning.
- Linked references currently display their type and label. They are not deep links because the app's modules do not expose a single stable cross-module route contract.
- The moderation queue is site-admin-only; role-delegated moderators, automatic post removal, push notifications, email digests, and per-person mention delivery are not implemented.
- Song search is available when the Worship Planning table exists; Wiki search is available when the Wiki tables exist. The current module-only implementation catches missing optional Wiki/Song tables and returns no matches.
