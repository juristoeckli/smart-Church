# ChurchTools demo second-pass list: links, functions and gaps

Audit date: 2026-11-20
Related inventory: [`CHURCHTOOLS_DEMO_FEATURE_INVENTORY.md`](CHURCHTOOLS_DEMO_FEATURE_INVENTORY.md)

This is the requested separate verification list. The first list records what links to what in the demo; the second reconciles those links with current Smart-Church code. The expanded live-test ledger below then records which controls were actually exercised and what demo test data remains. Links are based on visible UI relationships and stable record concepts, not guessed URL patterns or undocumented internal APIs.

## Second pass 1 — verified cross-module and record links

### People and groups

- A person record shows group memberships, roles, start/status and actions to edit membership or open its group.
- A group member row opens the linked person; group hierarchy opens parent/child groups.
- Person history records group membership create/update/delete, giving the person↔membership↔group relationship an audit trail.
- Group posts, meetings, follow-ups, notes and member lists are scoped to the group record.

### Calendar, event templates, registration and resources

- Calendar appointments can attach an event template per occurrence; recurring series expose occurrence-level editing and options for one occurrence, this-and-future or the whole series.
- A registration setting can create one separate group for each repeated appointment, linking a calendar occurrence to group-based participant management.
- Appointment resources link directly to bookable resource records and show request/booking status. Appointment setup/lead-in and cleanup/lag times are configurable; multiple resources may be attached to one appointment.
- The Resources module offers a linked schedule/utilization view; a booking can be created from the resource workflow and associated with a calendar appointment.

### Events, people, roles, plans and songs

- Event duty-roster assignments connect a person to an event occurrence through a role category, with empty/requested/confirmed states.
- Absence view organizes people/staff across dates and role categories.
- Run-sheet plan items link to responsible people and can carry role-category staff notes.
- Song plan items link to song catalog entries; the visible entry carries title, key, time signature and BPM.
- Event detail exposes attachments and email to selected staff; events also expose fact/attendance-related pages.

### Calendar and check-in

- Check-in meetings correspond to calendar appointments; groups are selected to compose the roster for a meeting.
- Selecting parent groups and age subgroups aggregates people from their group memberships; roster actions apply to those person records for the chosen meeting.

### Posts, Wiki, people, groups and songs

- Post editor exposes typed mention/link targets for Person, Group, Wiki page and Song. Group membership/visibility controls who can see group-targeted posts; post preferences manage subscriptions/notifications and hidden posts.
- Wiki page editor exposes the same typed targets (Person, Group, Wiki page, Song); observed pages linked to songs, groups/subgroups/sign-up groups, people/contacts and other pages.
- Wiki attachments are linked to page records and display uploaded-file metadata.

### Finance and donor records

- Transaction rows link to donor person records and can represent a single donor or joint donors.
- Transaction records also point to chart-of-account entries and cost centers; totals, receipts, budgets and reports roll up across those accounting records.

### Cross-link summary

The visible model is a connected church database: **Person ↔ Group membership ↔ Group**, **Calendar appointment ↔ Event occurrence/template ↔ Role assignment ↔ Person**, **Event plan item ↔ Song and responsible person**, **Calendar appointment ↔ Resource booking ↔ Resource**, **Appointment ↔ Registration group ↔ People**, **Appointment + selected Groups ↔ Check-in roster**, **Post/Wiki page ↔ Person/Group/Song/Wiki page**, and **Finance transaction ↔ Donor/Account/Cost center**. Cross-links are first-class workflow affordances in the UI rather than plain text descriptions alone.

## Second pass 2 — Smart-Church reconciliation and candidate functions

Status labels below mean: **Present** is supported by repository evidence; **Partial** means a related workflow exists but the reviewed ChurchTools workflow has additional behavior; **Gap** means the reviewed native capability is absent or not represented in the current parity documents. Confirm local church requirements before treating a candidate as a build commitment.

### Present or materially overlapping

- **People:** directory, contact records, relationships import and group memberships. ChurchTools migration preserves returned non-credential fields privately and links known relationships by stable source IDs. This is not evidence of a complete editable People-parity profile.
- **Groups:** groups, local memberships, role/status values, meetings, attendance, signups and approval.
- **Services/events/check-in:** schedules, recurring series, plans, volunteer positions, individual check-in, attendance counts, visitor flags/follow-up, public event registration and waitlists.
- **Songs:** song/arrangement catalog and reusable service-plan templates with licensed HTTPS links.
- **Resources:** location-scoped resources and booking request/approval workflows.
- **Communications:** Community posts, comments and likes; in-app notifications/announcements.
- **Integration:** one-time ChurchTools migration and limited scheduled sync exist. They are distinct from full bidirectional parity.

### Partial functions with concrete verification/build candidates

- **People profile and directory:** compare custom fields, privacy source/consent, permissions, duplicates/merge, archive, relationships, history, attachments, workload, tags, bulk changes and views. ChurchTools import is permission-scoped and retains source-only fields privately; no sensitive fields should be assumed visible or editable.
- **Group administration:** subgroup hierarchy; group history; invite workflows; leadership rights; automatic membership; routines; certificates; posts/chat/follow-up settings; group-specific visibility and signup controls; custom membership fields and waiting-list semantics.
- **General calendar:** separate community/group/personal calendars, multiple view modes, category/tag filters, appointment fields, manual recurrence, extra dates, exceptions, edit-scope choices and event-template attachment per occurrence.
- **Event staffing:** explicit requested/confirmed state, role-category grids, staff-by-date absence view, responsibility/unfilled filters, bulk fill role, cancellations, selected-staff email, and printable/exportable roster.
- **Plans and worship:** per-role staff notes, agenda section timing and duration, event attachments, native song entry links and preserving source song/arrangement IDs, authors, keys, time signatures/BPM and per-item responsible roles in migration.
- **Check-in:** dedicated meeting workflow, combining roster members across chosen groups, present/reset/complete actions, already-present filtering and operational/kiosk support; Smart-Church already has check-in so compare actual flow before adding another implementation.
- **Resource scheduling:** weekly matrix, room/equipment/vehicle categories, utilization, recurrence, quantities, additions/exceptions, linked appointment, multi-resource booking, lead/lag buffers, approval status and full booking history migration. Current migration docs explicitly say resource bookings are not imported yet.
- **Community feed:** destination group, group-inherited/member-only visibility, scheduled publishing, images, share/subscription/hidden-post controls, broader reactions and typed Person/Group/Wiki/Song links. The present feed has posts/comments/likes; do not call the entire feed absent.
- **Wiki:** page/category tree, rich page editor, attachments, related-page links and typed entity links. Repository search found no native Wiki module/API.
- **Finance:** transaction ledger and splitting/tax/receipt uploads, donors and collective receipts, budgets, statements, account/cost-center reports and accounting master data. No native finance ledger is documented in Smart-Church's parity matrix.
- **Reports:** establish whether built-in reports/ad-hoc reports are in the intended scope; current reviewed repository docs do not establish parity.

## Completeness check

- Initial inventory categories all have a corresponding entry in the primary inventory document.
- Follow-up verification explicitly revisited all observed relationships between People, Groups, Calendar, Events, Check-in, Resources, Posts, Wiki, Songs and Finance.
- Gap reconciliation checked the existing Smart-Church parity and migration documents and avoided labeling event management, check-in, groups, songs, resources or the community feed as wholly missing where current code has related workflows.
- The initial representative pass canceled its forms; the expanded follow-up then used selected temporary test records, recorded in the ledger below.

## Expanded live-test ledger

Legend: **Interacted** = UI control/form used or validation checked; **Round-trip** = temporary record saved and then opened/searched; **Archived** = recoverable inactive record left in the demo; **Not run** = control or screen inspected without executing the mutating action.

| Area | Tested through UI | Data-changing test | Not run / limitation | Current demo test-data state |
| --- | --- | --- | --- | --- |
| Home/admin/settings | Opened dashboard, widgets, system settings, permission matrix, integrations, license, privacy/security, email, sent-message log, Chat entry point and module settings. | None. | No settings, roles, access, modules, license, scheduled tasks, integrations or outgoing messages changed. | No test data. System email suppressed; Report/Finance-Sync/Sync inactive; no license key. |
| People | Navigated directory, list/cards/map/stats/archive; searched, filtered, paged, sorted, opened profile and reciprocal group links/history; inspected filter tabs, view/master data, email template and serial-letter editors, duplicate review and import forms. | Created fake people `Codex AuditTemp20261120` (#2845) and `Codex Audit Applicant20261120` (#2848); used reserved `.invalid` email only. Verified group links/history; both were recoverably archived. | No email, import, export, contact, merge or change to sample-person fields. An invite control was accidentally triggered for #2845; demo email is disabled, UI says already invited, and no revoke action exists. | Both fake people are in People > Archive. Fake leader's invite state remains; no mail was delivered. |
| Groups | Navigated overview/all/mine; searched, sorted, filtered, paged; tested table/list/map, map cluster, columns/view, opened overview/info/posts/comments/members/follow-ups/meetings/notes/history/hierarchy and settings. | Created `CODEX AUDIT TEMP 20261120` (#799); assigned fake person as Participant then Leader, verified both-direction links/history; group recoverably archived. Saved and completed a follow-up (#7), saved a security-level-1 test note, created meeting #1024, checked in only fake leader (0→1), reset attendance (1→0), then completed meeting. | Group signup was set to request mode, but no public group page/link was configured and manager controls exposed direct member add only; no applicant request or approval could be run. A self-join test for the signed-in admin was withdrawn; one Armin membership remains in `Zu löschen` in the archived test group. No real group/person fields were changed. | Test group #799 remains archived; meeting/follow-up/note and withdrawn self-request are confined to the archived test group until reset. |
| Calendar | Switched day/week/month/year/list, calendar scopes, tag filters and date navigation; inspected recurring appointment editor and Calendar/Registration/Events/Resources tabs. | Saved `CODEX AUDIT TEMP Appointment Series 20261120` on Planungskalender with weekly recurrence through Dec 15 and Dec 1 exception. Verified one-occurrence, this-and-following and whole-series edits; restored all subtitles and left notifications off. Attached event template #2080 to Dec 8, which links to registration group #802; enabled per-occurrence registration groups. Added pending Saal booking shown on Dec 8 and Dec 15. | No real appointment, resource or event changed; no notification sent and generated group is unpublished with signup disabled. Whole-series deletion was not tested because UI warns deletion has no undo. | A labeled standalone Nov 24 occurrence plus Dec 8/15 weekly series remains until demo reset; event #2080, group #802 and pending Saal booking are linked to the series. No group #803 was verified. |
| Events and songs | Inspected event roster/absence/facts/run-sheet pages, filters, assignment dialogs, template and email/attachment forms, song library and master data. | Created `CODEX AUDIT TEMP Song 20261120` (#46), searched/opened/edited, then hard-deleted; success toast confirmed. | No real event/duty/absence/attendance changed; no email, attachment, CCLI export or report export. The delete was permanent (the app provided no restore evidence). | Test song no longer appears. |
| Check-in | Switched meeting/group/person layouts, meeting calendar, group selection, roster sorting/search and present-only filter; opened meeting creation form then canceled. | No check-in-module attendance was saved. A separate temporary group meeting was tested under Groups: fake leader marked present, reset to 0, meeting completed. | Dedicated Check-in meeting picker showed calendar meetings from Nov 8 and five existing child groups but did not list test group #799 or its meeting #1024 (20 Nov 19:00); therefore no module-level attendance action was available. | Meeting #1024 is completed with 0 present under the archived test group. No Check-in module attendance was changed. |
| Resources | Used mini calendar/week grid, date navigation, resource/site/status filters, search, marked-only control and workload view; inspected master data and recurrence/resource request form. | Created `CODEX AUDIT TEMP Resource Request 20261120` for Bus at Winterhude, **2030-01-01 12:00–13:00**, then opened the schedule edit link, changed Pending → Rejected, and confirmed it moved between status filters. | The quick booking-detail view itself offered only Cancel/Save, title blank and a self-conflict warning; the separate edit link exposed the manager status selector. No sample/real booking was approved or changed. | The test request remains labeled and Rejected; its status selector still offers Pending/Confirmed, so it is reversible. |
| Posts | Inspected feed modes, filters, subscriptions/notifications/hidden posts, reports/moderation settings and composer, mentions, visibility, comments, scheduling and image control. Inspected existing-post menus and subscription pages. | No post published. Share copied a link to the local clipboard; nothing was sent. | Composer exposed immediate or scheduled creation, no draft-save action. No post/comment/reaction/upload/schedule execution. The private test group had no active members/feed create control and the global composer could not find it. Email delivery suppressed. | No post test data; test group was re-archived with restricted visibility unchanged. |
| Wiki | Inspected category/page list, table/gallery, search, sort, columns, page action menu, editor, links, version/file panes; global search indexed the labeled page. | Created `Codex Audit Temporary Page 20261120` in Technik, edited/verified, then deleted; success confirmed. Later created a second page `CODEX AUDIT TEMP WIKI UPLOAD 20261120` and verified its page view/global-search entry. Opened a PDF export of the existing welcome page. Uploaded non-sensitive `churchtools-audit-upload.txt` to the second page using the internal browser; success toast and file metadata appeared. | First page delete was potentially permanent; no recycle/restore path was visible. No temp-page PDF, HTML conversion, redirect, homepage toggle or external link change. | First test page absent; second labeled page and its test attachment remain until reset. |
| Finance | Opened all sections, transaction and budget forms, CSV import/export choices, statement statuses/actions, bank-statement suggestions; checked empty transaction validation; opened six report previews where available. | No financial transaction or budget saved. | No transaction, import, bank reconciliation, download/export or donor receipt generated. | No test data. |

Additional interaction checks: global search was opened, switched among result categories, and queried for `CODEX AUDIT TEMP`; the temporary Wiki page appeared in Wiki results and the dialog exposed People/Groups/Wiki/Songs search actions and Person/Group/Wiki quick-create actions. Existing-post share copied a link locally; no content was published or sent. The empty Finance “Book and Close” validation highlighted the required account, contra-account, amount and booking text; the form was canceled without creating a transaction. People filters and role/category master data were opened without saving; group map cluster interaction and a post-comments view were inspected without reacting or commenting. Report previews were verified in the browser, while output file downloads were not tested.

### Test scope and remaining boundary

This is deeper than a feature-label inventory: module navigation, filters, views, record links, settings, form validation and selected create/search/archive/status round-trips were actually exercised. “Every feature completely” still cannot be claimed for hidden permission combinations, all record data shapes, file-upload contents, integration credentials, outgoing delivery, scheduled execution, every report export format or internal REST API endpoint. The demo explicitly suppresses email, disables several modules and self-deletes; some UI actions have no safe reversible path. The next pass should use a dedicated ChurchTools test tenant with working delivery plus an approved plan for irreversible cleanup if true end-to-end coverage of those remaining workflows is required.

## Evidence references

- [ChurchTools official module overview](https://churchtools.academy/en/help/churchtools-modules/)
- [ChurchTools API documentation](https://churchtools.academy/en/help/system-settings/api-en/api-documentation/)
- [`CHURCHTOOLS_PARITY_MATRIX.md`](CHURCHTOOLS_PARITY_MATRIX.md)
- [`CHURCHTOOLS_MIGRATION.md`](CHURCHTOOLS_MIGRATION.md)
- Smart-Church Community feed routes: `apps/api/src/modules/community-feed/routes.ts`
- Smart-Church Community feed UI: `apps/web/src/modules/community-feed/CommunityFeedModule.tsx`
