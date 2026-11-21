# Community Feed

The module provides a location-scoped post feed with group visibility, group subscriptions, scheduled publication, post editing, comment controls, four reactions, filters, hide/unhide, shareable post links, user-submitted post reports, a site-admin review queue, and an in-app notification inbox. Members with private People access can search active location members, insert an `@Name` mention in a new post, and notify linked accounts who can see that post. Mention inbox alerts are in-app only; a Community Feed worker sends scheduled-post mentions when their publication time arrives, with retry and duplicate protection.

Feed notifications cover published posts in groups the recipient follows (or member-only group posts), reactions, and comments. Users can set separate per-location preferences for these three notification kinds; all are enabled by default. Preferences affect newly created notifications only and do not hide posts or delete existing inbox history. The inbox shows unread state, supports mark-read actions, and checks the current post visibility before showing a notification.

Community Feed email alerts have separate per-location settings for new posts, reactions, and comments. These event-kind settings are subordinate to the explicit location-level Email notifications opt-in in Notifications: both the relevant Community Feed email setting and the master opt-in must be enabled when the alert is created, and the shared delivery worker rechecks the master opt-in before sending. In-app Community Feed settings remain separate and continue to control the Community Feed inbox. The master opt-in also remains responsible for email address, administrator delivery configuration, and bounce/complaint suppression. Email messages use generic content and do not include post text, titles, or group names. The shared queue retains its retry behavior; delivery status appears in Notifications when the corresponding in-app alert is enabled. Community Feed snapshots are version 8 and include notification, report and preference records; restore accepts versions 1 through 8 and defaults pre-v8 email alert preferences to enabled to preserve the previous behavior.

Users can opt in to a weekly post digest for each location by selecting a weekday in Community Feed notification preferences. It queues at 08:00 local time when new visible posts are available and requires the location's master Email notifications opt-in. The email prompts users to sign in and view the posts they can access. The digest setting is separate from individual post alerts.

Group subscription, post destination, filter, and linked-group selectors show active groups only. The API validates new subscriptions, destinations, and group links as active. Existing posts and group links remain stored and continue to follow their existing visibility rules when a group later becomes inactive; users can still unsubscribe from an older group subscription.

## Post reports

Members can report another author's visible post with a reason (spam, inappropriate, harmful, or other) and optional details up to 500 characters. The API checks the post's current audience and location. Each member can submit one report per post. Site admins and assigned Community Feed moderators can review open, dismissed, and actioned reports, and update reports with a dismissal or actioned state. Report actions do not automatically remove or hide the post.

Location site admins can grant the Community Feed `Review post reports` module permission to individual location members in Location access. Moderators can list reports and dismiss or mark them actioned. The reports list and status updates apply the same post group-visibility predicate as the feed: a moderator only sees and can resolve reports for posts they can already access. The grant does not change post creation, editing, group membership, or access to Wiki, People, or other module data. Site admins retain access to all reports.

## Media and linked records

- Authors and site admins can attach up to five files per post. Each file is limited to 1 MiB. Accepted types are JPEG, PNG, GIF, WebP, PDF, and plain text. Uploads are stored in the module database with the location and post IDs; downloads require the current location and the same post visibility checks as the feed.
- Authors and site admins can link a post to an active location Person, Group, Wiki page, or Worship song. Search is allow-listed by entity type and location; link creation revalidates that the target exists in that location. The UI renders these as typed references, rather than accepting arbitrary external URLs. Person, Group, Wiki, and Worship song references navigate to their location-scoped destination. Wiki navigation opens the page through the Wiki module's permission-checked page API; unavailable or newly restricted targets show the module's safe error state.
- Wiki link search, creation and feed display respect the linked page's audience; inaccessible or archived Wiki pages are not suggested or shown.
- Feed snapshots are version 8 and include post attachments, links, notifications, reports, and per-user in-app and email notification preferences. Restore accepts versions 1 through 8; older snapshots continue to restore with empty newer records and enabled email alert defaults.

## Known gaps

- Attachments are limited to five 1 MiB files per post and the accepted MIME list above; there is no image resizing, video, audio, or virus scanning.
- Moderators can resolve reports only for posts visible to them; there is no automatic post removal. Push notifications are not implemented.
- Song search is available when the Worship Planning table exists; Wiki search is available when the Wiki tables exist. The current module-only implementation catches missing optional Wiki/Song tables and returns no matches.
