# ChurchTools demo feature inventory

Audit date: 2026-11-20 (deep follow-up revision)
Instance: [Zefanja demo](https://zefanja-2a1a501a.church.tools/wiki/8)
Purpose: record the functions visible in the logged-in demo and compare them with the current Smart-Church repository. This is a demo workflow inventory, not a claim that every ChurchTools tenant or license has the same modules or permissions.

## Audit method and confidence

The first version was a representative-screen inventory. After review, it was expanded into a page-by-page pass with actual reversible data round-trips where the demo made safe cleanup possible. The expanded audit used these passes:

1. **Pass 1 — full visible navigation:** traversed every top-level module exposed in the demo, representative list/detail screens, module tabs, filters, settings and forms.
2. **Pass 2 — interaction tests:** exercised view/date/filter/search controls, opened forms and settings, checked validation where safe, and followed record links.
3. **Pass 3 — cross-module and master-data sweep:** checked relationships, module settings, master-data areas, roles, categories, report types, integrations and admin pages.
4. **Pass 4 — temporary-record round-trips:** created labeled test person/group/song/wiki page/resource request records where permitted; verified visibility or linkage, then archived or deleted only as recorded in the separate [test ledger](CHURCHTOOLS_DEMO_SECOND_PASS_LINKS_AND_GAPS.md).
5. **Pass 5 — completeness and gap reconciliation:** compared screen coverage and the visible system/module settings with the ChurchTools help catalog and Smart-Church parity/migration documents.

**Observed** means visible in the demo screens. **Interacted** means a control or form was actually used without necessarily saving. **Round-trip tested** means a labeled test record was saved, opened/searched, and archived/deleted as documented in the ledger. **Documented** means ChurchTools official help describes the capability, but the workflow was not exercised in this instance. Empty or sample data is not evidence that a capability is absent. The demo is permission- and configuration-dependent; modules, fields and actions may differ by instance. The audit covers accessible UI workflows, not every edge case, every permission combination, every integration, or the 800+ REST API endpoints.

## 1. People

### Directory and finding people

- Directory of 623 sample records with search, sorting and pagination; page sizes include 200 and all records.
- Filter by status, location, group type, custom filters and the current user's groups; save/configure views and columns.
- List, map, statistics and archive views; CSV export and import; duplicate review and merge/align workflow.
- Contact and serial-letter related tabs; bulk email/contact actions.
- Bulk updates for status, location, nationality, marital status and gender; add/remove tags; invite people to ChurchTools; grant permissions; require two-factor authentication; add/remove group memberships; change membership role/status/custom fields; archive records.

### Person record

- Contact and identity fields: name, address and map pin, email, phone, username, legacy ID, demographics, first-contact date, status and location.
- Privacy and access-related details: consent date/source/actor, confidentiality agreement date, last online, direct permissions and tags.
- Comments and follow-up information, attachments, workload, vCard, archive action and record ID.
- Group memberships by group type and role, including membership start/status and actions to edit, remove or open the group; history/audit trail for profile and membership changes.
- Relationships editor connects people to related people; profile history records changes, group join/update/delete, privacy, comments/follow-ups, photos and recurring-event memberships.

## 2. Groups

### Directory and group configuration

- Overview, all groups and my groups; search, sorting, saved views, list/table/map, pagination and active/draft/ended/archived/all status filters.
- Group cards show parent/child hierarchy, type, status, visibility, signup state, membership/role counts and date range.
- Create groups and configure group type/category, location, visibility, target/age, date range, description and tags.
- Hierarchical groups and subgroups; group page includes Overview, Info, Posts, Members, Follow-ups, Meetings, Notes, History, Hierarchy and Settings.
- Settings areas include General, Members, Signup, Posts, Meetings, Routines, Follow-ups, Automatic membership, Certificates, Group chat and Permissions.

### Membership and group activity

- Assign members to role buckets including leader, co-leader, organizer, staff and participant; add members by role, email members, manage seats and open linked people.
- Membership status/role and custom fields; role and membership change history.
- Group signup/public join workflow; meetings/attendance, follow-ups, posts, notes, history and subgroup navigation are group-scoped.
- Automatic membership, routines and certificates have dedicated settings areas; their detailed rules were not changed or exhaustively exercised.

## 3. Calendar and appointments

- Distinct community, group and personal calendars; toggle individual calendars and filter by tags.
- Day, week, month, year and list views; appointment creation and recurring series.
- Appointment fields observed: calendar, title/subtitle, internal-only visibility, all-day, start/end, description, URL, “on behalf of”, location/place, image and tags.
- Recurrence supports daily, weekly, monthly by date, monthly by weekday, yearly and manual patterns; end date/frequency, added dates and exceptions.
- Existing series can be edited as one occurrence, this-and-future or the whole series.
- Appointment editor includes separate Calendar, Registration, Events and Resources tabs. The Events tab associates event templates with occurrences; Registration can create a separate group for each repeated appointment; Resources attaches multiple resources and setup/lead-in and cleanup/lag buffers.

## 4. Events and service planning

- Duty roster view organized by service/event and role-category columns; status values include empty, requested and confirmed.
- Filters for own assigned/requested duties, responsible person and unfilled duties; bulk fill a role, cancel events, print/export and workload actions.
- Event editing includes templates, responsibility, staff assignments, calendar association, attachments and emailing selected staff; event pages expose Duty roster, Absences, Facts, Run sheets and Songs.
- Absence view compares staff by date and role category.
- Run-sheet/service plan has ordered sections and timed items with title/text, start time, duration, responsible person, additional role-category columns and staff notes.
- Song items link to the song catalog and expose song title, key, time signature and BPM.
- Events connect to attendance/facts and can be attached to calendar occurrences; the audited appointment series showed an event-template choice per occurrence.

## 5. Check-in

- Select a meeting/calendar appointment and one or more relevant groups; displayed sample meetings included services and other church activities.
- Group selection can include parent groups and age subgroups; people are brought together from the selected groups.
- Search the combined list, show/hide already-present people, mark present, reset and complete the meeting.
- Meeting selection, selected groups and roster share the event/calendar and group/person records. No check-in record was changed during this audit.

## 6. Resources and bookings

- Weekly booking grid for rooms, equipment and vehicles across locations; resource rows include rooms and other bookable items.
- Search, request status filters (pending/confirmed/rejected), new request, print, utilization view and master data.
- Booking form fields observed: resource, title/subtitle, all-day, start/end, recurrence, pending/confirmed status, description and “on behalf of”.
- Booking records can be linked to a calendar appointment. Appointment resource rows show booking status and setup/lead-in and cleanup/lag buffers; one appointment can attach several resources.
- Calendar links expose the resource schedule; resource permissions/status determine which bookings appear.

## 7. Posts and group communications

- Feed filters for all/campus, my groups and my posts; group/channel feeds, search, create post, share, comments and reactions.
- Subscription/notification and hidden-post preferences; comments can be enabled/disabled; posts can be scheduled.
- Post creation requires a destination group, title and content; visibility can be limited to group members or inherited from the group.
- Rich text editor supports bold, italic, strikethrough, code, links, tables and dividers; image upload was visible.
- Typed mention/link tools target Person, Group, Wiki page and Song; existing posts also showed links to groups, sign-up groups, contacts and external maps.
- Existing-post actions include share/copy-link, author edit, visibility, disable comments, archive/delete, and for other-author posts, hide/report controls. Subscription search includes ChurchTools News and other subscriptions. Share copied a link locally; hide/report/comment/reaction controls were inspected but not triggered on sample posts.

## 8. Wiki

- Wiki page tree/category navigation, global search, create/edit and page navigation; pages can be grouped into categories.
- Page content editor supports formatted text, headings/anchors/table of contents, links, tables, images, dividers, undo/redo and typed mentions to Person, Group, Wiki page and Song.
- Page content can include related-page cards/links and links to songs, groups/subgroups/sign-up pages and people/contacts.
- File/link area lists attached files and metadata such as upload date/uploader; upload can use drag-and-drop or file selection.
- Creating/editing a page requires title and category; the demo warns those values cannot be changed later. The inspected draft was canceled.

## 9. Finance

- Main sections: Overview, Transactions, Budgets, Statements, Reports, Donors and Master data.
- Transactions list supports date ranges, search/filter, pagination, selection/bulk selection and row links to donor/person records. Columns include date, receipt number, account, contra-account, cost center, donor, booking text, attachment and amount.
- Transaction entry requires booking date, receipt number, account, contra-account, amount and booking text; optional cost center, tax toggle, split-booking toggle and receipt upload. Actions include Book and New, Book and Close and Cancel.
- Donor rows support individual or joint donors; visible summaries include donor totals, latest donations and donation receipt drafting for individual or collective/batch donations.
- Budgets are organized by cost center/account; statements and reports include balance sheet, profit and loss, trial balance, account statement, cost-center statement and turnover.
- Master data includes accounting years, accounts/chart of accounts, cost centers, account classes/groups, tax types, purposes, taxes and receipt templates.

## 10. Other documented ChurchTools areas

The audit focused on demo screens that were navigable and cross-linked in the session. ChurchTools also documents additional modules such as reports/ad-hoc reports and module-specific settings. Their full workflows were not independently inventoried in this pass; see the official [module overview](https://churchtools.academy/en/help/churchtools-modules/), [reports](https://churchtools.academy/en/help/churchtools-modules/report-en/reports/) and [ad-hoc reports](https://churchtools.academy/en/help/churchtools-modules/adhoc-reports-en/what-are-ad-hoc-reports/) pages. Treat those as documented coverage, not demo-observed detail.

## 11. Smart-Church comparison snapshot

This section is a repository-based gap snapshot, not a product roadmap or a claim that every ChurchTools organization needs every feature. Current Smart-Church evidence is summarized in [`CHURCHTOOLS_PARITY_MATRIX.md`](CHURCHTOOLS_PARITY_MATRIX.md) and [`CHURCHTOOLS_MIGRATION.md`](CHURCHTOOLS_MIGRATION.md).

### Native or substantial overlaps

- People directory, groups/memberships, services and events, check-in/attendance, first-time visitor follow-up, public event registration, song catalog and service-plan templates, resource requests/approvals, community feed, notifications, file storage, location-scoped permissions, ChurchTools migration and limited scheduled sync.

### Partial overlaps needing workflow-by-workflow review

- **People:** profiles, custom fields, consent, typed reciprocal relationships, duplicate merge, imports, saved views, relative date filters and selectable columns exist. Verify ChurchTools privacy/permission behavior, all profile sections and full history.
- **Groups:** memberships, roles, lifecycle, signups, invitations with history/revocation, attendance, hierarchy, custom membership fields, routines, automatic membership, follow-ups, certificates, group chat, private notes and leader feedback exist. Verify full membership history, permissions/settings and household semantics.
- **Calendar/events:** Smart-Church has service/event schedules, recurrence, positions, plans and attendance. Verify calendar separation (community/group/personal), appointment series exceptions/extra dates, event-template-per-occurrence links, roster request/confirmation/absence workflow, bulk role assignment, per-role plan notes, cancellation and print/export.
- **Check-in:** attendance and individual check-ins exist. Verify the dedicated meeting selection, multi-group roster aggregation, kiosk/device flow, roster controls and attendance reconciliation.
- **Resources:** recurring requests support previewed series edits, per-date extra-date add/remove, skipped dates, buffers, linked appointments, conflicts and utilization. Verify resource calendar matrix, quantities, multi-resource appointment behavior, permissions and booking history migration.
- **Posts:** Community supports group visibility, scheduled posts, attachments, four reactions, group subscriptions, hidden posts, typed Person/Group/Wiki/Song references and notifications. Post reporting and a site-admin moderation queue are now implemented; user notification preferences, mention delivery, email digests, and rich-text parity remain open.
- **Worship planning:** song catalog and reusable event plans exist, but ChurchTools imports do not create separate song/arrangement records or preserve song source IDs, authors, keys, licensed links, per-item responsible-role links or full agenda semantics.
- **Communications:** in-app announcements and notifications exist; verify feed subscriptions, channel/group posting permissions, delivery preferences, full activity history and targeting parity.

### Broad native coverage now present, with parity gaps remaining

- **Wiki, Finance/Giving, general-purpose Calendar, and Reports** each have native Smart-Church modules in this workspace. The demo audit does not prove complete parity: verify detailed workflow, permissions, exports, integrations, and migration per module.
- **Resources:** recurring requests, series edits, setup/cleanup buffers, linked bookings, conflicts and utilization have implementation coverage. Resource matrix, quantities, import history and some exception-management paths still need an end-to-end comparison.
- **Groups:** hierarchy, leader roster, invitations with manager/leader history and revocation, signup approval, custom membership fields, rules, routines, certificates, follow-up tasks, private notes, history, group-linked chat and leader meeting feedback are implemented in module slices. Feedback response CSV exports include meeting/form metadata and current prompt columns. Compare remaining ChurchTools membership-field, saved-view, attendee feedback submission and permissions settings.
- **Events and calendar:** service plans, notes, assignments, bulk assignment to selected unfilled roles, response states, swaps, absences, general calendars, linked registrations, recurrence exceptions/extra dates, ICS and generated occurrence events are implemented. Volunteer role-qualification matching, print/export, notification coverage, time zones, per-occurrence registration/capacity, and remaining edge cases are still open.
- **People:** custom fields, consent, relationships, profile history, duplicate merge, imports and several reports exist. Verify the complete People schema, directory saved views, advanced filters, household/relationship semantics, privacy tiers, bulk actions, emails/serial letters and all membership histories.
- **Reporting:** fixed and ad-hoc reports exist; remaining work includes report coverage, role-specific data access, additional datasets, saved views/sharing, and output formats.

## References

- [ChurchTools module overview](https://churchtools.academy/en/help/churchtools-modules/)
- [People overview](https://churchtools.academy/en/help/churchtools-modules/people/overview-people/)
- [Calendar overview](https://churchtools.academy/en/help/churchtools-modules/calendar/overview-calendar/)
- [Events overview](https://churchtools.academy/en/help/churchtools-modules/events-en/overview-events/)
- [Check-in overview](https://churchtools.academy/en/help/churchtools-modules/check-in-en/overview-check-in/)
- [Resources overview](https://churchtools.academy/en/help/churchtools-modules/resources/overview-of-resources/)
- [Finance overview](https://churchtools.academy/en/help/churchtools-modules/finance/overview-finance/)
- [Wiki overview](https://churchtools.academy/en/help/churchtools-modules/wiki-en/wiki-overview/)
- Smart-Church [`CHURCHTOOLS_PARITY_MATRIX.md`](CHURCHTOOLS_PARITY_MATRIX.md)
- Smart-Church [`CHURCHTOOLS_MIGRATION.md`](CHURCHTOOLS_MIGRATION.md)

## 12. Deep follow-up: home page, administration and integration surface

### Home page and quick access

- The home page has configurable content and widget layout, welcome heading/subtitle and a global search for people, groups, Wiki pages and songs.
- Demo widgets included current bookings with direct resource links; current posts; open duty requests with accept/decline/swap actions linking to event, role and requester; birthdays with location/all filter and member-list navigation; upcoming group-calendar appointments; ChurchTools News; open room-booking requests; and recent event facts with visitor/first-time visitor/collection totals and prior-year comparisons.
- Admin settings expose controls for the welcome message, RSS news, ChurchTools News, newcomer Q&A sessions, public church profile completeness and a permission-scoped links widget.

### Admin and settings pages

- Top-level visible navigation in the demo: Posts, People, Groups, Calendar, Events, Resources, Check-in, Wiki and Finance.
- Admin menu: System Settings, Public Relations, Permissions, Log, Translations, Support Access, Simulate User and Run Scheduled Tasks. The last two actions were identified but not invoked because they may change access or execute unrelated jobs.
- System settings categories include church information, locations, welcome, home page, registration, login and general settings; module settings; privacy/security; communication; Integrations; and License. A sortable menu-points control is exposed.
- Module settings are individually available for Posts, People, Groups, Calendar, Events, Resources, Check-in, Wiki, Finance, Report, Finance-Sync and Sync. Report, Finance-Sync and Sync showed an Activate action and were left inactive. Finance-Sync is described as the legacy Optigem transfer replaced by Sync.
- Posts settings include up to eight recommended groups, allowed group types, an author edit time window, default email summaries by weekday, and module rename/deactivation.
- People master data/settings include person fields/categories, statuses, departments/locations, relationships and reverse labels, growth paths, tags/colors, contact labels, security levels, comment visibility, birthday visibility, exports, archive history, email delimiter and module rename/deactivation. The five default access levels cover names, general info, contact details, leader details and administration; field security is configurable.
- Privacy/security settings cover confidentiality agreement acceptance, data-protection emails, OpenStreetMap maps, LDAP two-factor handling, app security prompt for person data, privacy notice, data privacy, imprint, right of information, authorized persons and time-limited support access. Support access was off; the page says it grants one week and is logged.
- Communication settings cover system email sending, email server and admin contact addresses. This instance explicitly disabled system email, had no admin contact address, and showed a banner that outbound mail is suppressed to prevent spam. No emails were sent.
- Permissions UI is a matrix with Person Status, Group Type, Group and User tabs; search, campus filter and “only entries with permissions” filter. It covers permissions spanning People, Groups, Calendar, Events/Songs, Resources, Wiki and Finance. No permissions were changed.
- Integrations catalog groups CCLI SongSelect, CM Telecom SMS, Evangelische Termine calendar/event sync, LimeSurvey, AI writing assistant, CleverReach, Mailchimp and Mailjet under integrations; REST API and CORS are listed separately. The settings overview describes the REST API as providing 800+ endpoints. No credentials were entered and no integration was activated.
- License settings show package selection, billing recipient and payment method pages, but the demo has no license key, so license changes could not be tested.
- User menu exposes My Profile, theme (Light/Dark/System), sent-message history, Chat, App and logout. Profile includes personal information, privacy consents, password, two-factor, login token and test-push controls. The audit did not reveal login tokens, change account settings, or trigger test push.
- Sent Messages has My Messages, Failed to Send, All Messages and search; rows include date, recipient, sender, subject and status. Message contents and private addresses were not opened.
- Chat page provides web-chat and mobile-app login guidance. The webchat runs on a separate service; no external login was attempted.

### Reporting and Finance detail

- Report module settings showed Report inactive. Finance exposes six report types: balance sheet (Bilanzbericht), profit/loss (Gewinn-Verlust-Bericht), trial balance (Summen und Salden), account statement (Kontoauszug), cost-center statement (Kostenstellenauszug) and turnover (Umsätze).
- Account/cost-center statements accept period and account/cost-center selection, offer PDF/Excel/CSV and include a cost-center transfer-without-cash option. Turnover offers monthly/quarterly intervals, account-type switches and show-no-booking-accounts. Report previews were opened where available; no files were downloaded.
- Transaction form requires date, receipt number, account, contra-account, amount and booking text; optional cost center, tax, split booking and receipt attachment. Empty-submit validation was checked without posting.
- Transaction list includes date presets, search/filter (including donor), sortable columns, paging, bulk selection and row edit/trash/more actions. CSV import template and CSV/Excel/SAGE/DATEV export choices were inspected; no import/export was run.
- Budget forms support account or cost-center budgets with selector, amount and note; forms were opened without saving. Statement records expose unbooked/booked/ignored/all states and bank-statement suggestion rules; no booking or rule changes were made.

### Test environment limitations

- The demo banner said it will be deleted automatically on **2026-11-23**.
- System email was disabled and outgoing email was suppressed; account contact setup was empty. This prevents true delivery tests for invites, posts, duty requests, resource notices and admin mail.
- Report, Finance-Sync and Sync modules were inactive and not activated; the license page had no key.
- The resource test request was first saved pending. Its booking detail opened a generic create form without management controls; opening the booking from the schedule's edit link exposed a manager status dropdown. The test request was moved to Rejected and verified under the Rejected filter; its status can be changed again, so it remains reversible and inactive.
- Some capabilities were inspected but not executed: post publication/scheduling, comments/reactions, attendance marking in the dedicated Check-in module, import/export execution, outbound messages, integration login, support-access grant, permission changes, module activation, run-scheduled-tasks and real finance postings. Wiki upload was subsequently completed through the internal browser.

## 13. Additional page-level controls verified in the expanded pass

### People workflow detail

- The People area has quick tabs for Persons, Emails, Serial Letters and Master Data. The directory filter builder includes postal code/radius, date fields and relative date ranges, group/member relationship, membership type/group/depth/role/status, relationships with negative conditions, and event duty/date/status.
- Directory filters include small groups, teams, events, distribution lists, keys, processes and tags. Person list views support selectable table columns, saved views, row selection, list/cards/map/statistics/archive and page sizes 10/25/50/200/all.
- Email area exposes sent mail log, template manager and a send workflow. Serial letters expose recipient selection, incomplete-address handling, household behavior, templates/title, rich-text, lists, links, images, emoji and placeholders. These compose flows were inspected/canceled; no recipients were contacted or document generated.
- Person data schema categories include Categories, Address, Information, Privacy and Permissions. Fields visible in the schema include name/alias, address/country, gender, phone/email/username/legacy ID, birthday, birth name/place, job, nationality, marital/wedding dates, first contact/member since/entry/exit, baptism/transfer/death fields, consent date/source/actor and confidentiality date.
- Relationship types have directional labels, minimum security level, export collapse and export labels; defaults include spouse, parent/child and duplicate/no-duplicate. Person status configuration includes whether status counts as membership, search visibility and assignment restrictions.

### Group workflow detail

- Group directory exposes all/mine/overview navigation, search/sort/status/page controls, list/table/map, group-type/category/target/age summaries, saved-view affordance, row selection and card actions; the table view can configure 15 columns.
- Group master data includes types, roles, categories, tags, templates (including meeting feedback and certificates), and module/general settings. Page/settings tabs include signup, members, posts, meetings, follow-ups, routines, dynamic/automatic membership, certificates, chat and permissions.
- A group may have linked posts and comments, member records/roles, notes, follow-ups, meetings/attendance, history, hierarchy and Wiki links. The audited groups showed empty states for some meeting, attendance, note or follow-up areas; an empty state means no sample workflow was available to validate there.

### Events, songs and Check-in detail

- Event creation form has event template and calendar, title/extra information, responsible people, date/time/recurrence, staffing counters by service roles and fact counters. Event templates include standard worship/service presets; run-sheet templates can be linked to calendar and sermon series.
- Duty request candidate view provides suggestion rationale, monthly workload and next duty plus request history. Events expose event email composition with recipient selection by role category, add/remove all, subject, plan link/copy, rich text and placeholders. These were viewed without sending.
- Absence management supports absence reasons, staff-by-date/role-category view, filters/search/paging and edit form. Event facts are configurable as select or number with units/options; service categories can set location, description, public visibility and hide-by-default in run sheets.
- Song catalog supports active/inactive, source, category, key/tonality, arrangement visibility, learning/practice and marked flags, tags, date-use and calendar filters; song details include arrangements, key/time/tempo/length/description, comments, files, links and tags. Song master data has name, active state, author, copyright, CCLI number, key, tempo and meter; CCLI report has usage periods and song/author/title/CCLI listing.
- Check-in has three layouts (meeting+groups+people, groups+people, people only), calendar selector, parent-group selector, combined roster, first-name sort, person search/add and a meeting-add form with date/time/group. Check-in system settings/help cover codes, label printing, pickup slips and printer setup, but those peripheral printing/code flows were not executed in this demo.

### Finance and Wiki detail

- Transaction table supports date presets, donor filtering, sorting, pagination, bulk selection and row edit/trash/more actions. Import offers a template; export formats include CSV, Excel, SAGE and DATEV. These were inspected only.
- Bank-statement cards expose status and suggestion actions; transaction locking/cancel/unlock, split entries, cash/bank transfer, and booking from bank statements/PayPal are documented by Finance help but were not demonstrated in this instance.
- Wiki page list supports category tree, page list/table/gallery, search, sort and column configuration. Page actions include version info, homepage toggle, edit, files, add link, create PDF, convert to HTML, redirect, show all pages and delete.
- Wiki file listing supports name/date/person sorts, uploader/date metadata and pagination. Link form requires URL and has optional title. A PDF export was opened for the existing welcome page. A non-sensitive text file was successfully uploaded to the temporary audit page through the internal browser; the UI confirmed success and listed the file, upload date/time and uploader. PDF generation for the test page, HTML conversion, redirects and homepage toggle were not executed.

### Global search and final test states

- Global search opens from the header and offers Recent searches, People, Groups, Wiki, Songs, Actions and More; it supports keyboard navigation and searching by `#` ID. Search suggestions can route to full People/Groups/Wiki/Songs results and quick-create Person, Group and Wiki page records. A query for the labeled test prefix returned the temporary Wiki page and full-module search actions.
- A second temporary Wiki page, `CODEX AUDIT TEMP WIKI UPLOAD 20261120`, was created under Technik and opened from the page list/global search. Through the internal browser, uploaded the non-sensitive `churchtools-audit-upload.txt`; the Wiki Files/Links table showed the filename, upload date/time and uploader, and a SUCCESS toast confirmed completion. The attachment and page remain until demo reset. A PDF export opened for the existing welcome page; a temp-page PDF, HTML conversion, redirect and homepage-action write path were not tested.
- End-to-end temporary actions are summarized in [`CHURCHTOOLS_DEMO_SECOND_PASS_LINKS_AND_GAPS.md`](CHURCHTOOLS_DEMO_SECOND_PASS_LINKS_AND_GAPS.md). Remaining test records: an archived person and group with a completed test meeting (zero present), completed follow-up and test note; a withdrawn self-join row shown as `Zu löschen` in that archived test group; the fake leader's “already invited” state (no email delivered, no revoke control); a rejected labeled resource request; labeled appointment occurrences/series; and the second temp Wiki page. The demo says it will auto-delete on 2026-11-23.

## Implementation updates after the demo audit

- **Check-in:** a location-scoped meeting/group roster supports search, sorting, present/reset, present-only filtering, persistent desk completion/reopen, printable labels/pickup layouts, optional recursive child/age-subgroup aggregation when Group Hierarchy is installed, and manager-recorded pickup authorizations with guardian-confirmation attribution. Authorization names appear on labels and replicate with core site snapshots. Guardian consent is not independently verified; the picker is limited to the visible roster and authorizations are shared across meetings.
- **Home:** the overview now shows up to six upcoming birthdays when the viewer has both Reports access and private People access; the endpoint permission check remains authoritative and hides the widget otherwise.
- **Home:** the overview now also shows up to six upcoming appointments from group calendars the current user can access, plus approved room/equipment bookings currently in progress. Both optional widgets use location/access-scoped module endpoints and disappear when the corresponding module is unavailable.
- **Home:** viewers with Reports and event-management access also see attendance/headcount and first-time-visitor facts for recent events; the widget reuses the location-scoped event-attendance report and stays hidden when access is unavailable.
- **Event staffing:** service managers can export the currently filtered event list's roles, assignments and volunteer response state to CSV; names are included only in the manager-only control.
- **Wiki:** managers can compare two saved page revisions side by side; the API checks both belong to the selected page and location, sanitizes content, and redacts linked pages the viewer cannot read.
- **Community Feed:** users can separately enable/disable future in-app notifications for posts, reactions and comments. Existing inbox history is retained; these controls do not change email or push delivery.
- **People:** personal directory views retain up to ten custom-field conditions combined with AND, plus up to ten relationship-type presence/absence conditions, alongside text and member/visitor status filters. Text supports exact/contains; dates support before/after/on and rolling last/next 7/30/90-day windows; yes/no and choice values are exact. Conditions are validated for active fields/types at the selected location and apply to CSV export.
- **People:** users can select core/custom directory columns, persist them in their saved views, and export the selected columns to CSV. The person name remains visible as each row's identity.
- **People relationships:** managers can configure per-location forward/reverse relationship labels. A typed relationship is stored once and displayed from both profiles with the appropriate label; legacy free-text relationships remain readable and removable. Saved views can include or exclude people by up to ten selected typed relationship kinds; legacy untyped rows do not match those filters.
- **Groups:** the directory supports name search and saved per-user/per-location views over search, source category, lifecycle state and date range. Groups have active/draft/ended/archived states, and new signup/feed/Wiki audience selectors offer active groups while preserving existing historical audience links. Group invitations include pending/accepted/revoked/expired history and pending-link revocation.
- **Finance:** managers can create, edit, close and reopen location-scoped accounting periods with custom date ranges. New postings, reversals, budgets, and donation receipts require an open configured period; seeded historical years remain open until a manager closes them.
- **Community Feed:** posts now support bounded image/file attachments, typed links to Person, Group, Wiki page, and Worship song records, plus an audience-filtered in-app notification inbox for group posts, reactions, and comments. Users can report visible posts with a reason and optional details; site admins can review, dismiss, or mark reports actioned in a location-scoped queue. Reports replicate with the module snapshot.
- **People Records:** managers can edit contact identity/status with audit history and bulk-change member/visitor status; supplemental tools add custom fields, consent history, reciprocal typed relationships, per-user saved views with up to ten type-validated custom-field conditions (including last/next 7/30/90-day date windows) and ten relationship-type presence/absence conditions, selectable/exported directory columns, CSV and vCard export, record history, duplicate review with a conflict-aware audited merge, confirmed CSV import for selected new records, birthdays and anniversaries. Merge preserves keeper values, migrates only references scoped to the active location, and blocks unresolved/unscoped conflicts.
- **Reports:** fixed reports now cover People consent and status-change history, event staffing, service plans and registration status/details, group meeting attendance and lifecycle history, check-in trends, worship song usage, resource booking summaries and monthly utilization hours, absence conflicts, Finance budget vs actual, and donor giving totals. The bounded ad-hoc designer provides allow-listed datasets, filters, grouping, aggregates and personal saved reports; active People custom fields and group membership custom values are available as dataset columns to users with private People access.
- **Groups:** Group Operations adds dated routine completions, certificate issue/revocation records, manager-previewed automatic membership rules, manager-only follow-up tasks linked to members, and leader-authored meeting feedback templates/responses with 1–10 prompts per recorded meeting. Active group members with linked accounts can submit named responses after the meeting; leaders can review them and export leader/attendee responses to CSV with spreadsheet-formula protection. Group Administration adds private group notes that leaders and managers can read/create; authors and managers can archive notes. Public tokenized group signup stores join requests for manager approval/decline and adds membership only on approval; managers can select an existing contact or create a visitor contact. Submitted email is not verified before approval. Feedback still lacks anonymous mode, required prompts and template version history.
- **Group leadership:** Group Administration provides a location-scoped roster and CSV export for active leaders, co-leaders, owners, and managers; emails require private People access.
- **Event staffing:** members can record date-range absences; event managers see assigned-role conflicts without private notes or automatic reassignment. Managers can bulk-assign one volunteer to multiple unfilled roles in a single event, with locked role validation and assignment-response synchronization. Service-plan roles can have separate staff-only notes: managers edit them, assigned volunteers read only their own role's note, and changes are audited without storing note text in the audit log. Assigned volunteers can request a same-event role swap; the recipient accepts/declines and the requester can cancel. Acceptance swaps roles atomically and resets both response states. Imported events are read-only; swap requests do not yet send notifications, and role qualifications are not modeled.
- **Chat:** locally managed Groups can link one group conversation; active group members with location accounts join dynamically, group leaders/managers can create the first chat only when they are members, and current group membership is checked on every access. Deleting a linked group removes its chat and messages. Existing direct and manual group chats remain independent.
- **Calendar:** appointments support images, first-to-fourth/last weekday monthly recurrence, an “on behalf of” People contact, per-occurrence service-event and public group-signup links, explicit generation of one disabled-signup group per recurring occurrence, previewed generation of linked service events from a location-scoped service-plan template with optional validated role-to-volunteer assignments, and revocable read-only ICS feeds for community calendars. Managers can inspect recurring-series extra dates and remove one extra date, clearing a matching occurrence exception transactionally.
- **Resource Scheduler:** recurring bookings support previewed future-series edits with explicit confirmation, past-occurrence preservation, transaction/audit handling, and approved-booking protections. Owners/managers can list and remove extra dates; removing cancels a pending booking only when the date is not also part of the regular recurrence, and records an audit. An approved standalone extra-date booking must be individually cancelled first. Managers can configure per-resource lead-in/setup and cleanup buffers; each booking can override them, and capacity checks include buffered intervals across module and legacy booking writes. Existing resources default to zero-minute buffers.
- **Wiki:** pages support location, selected-group, and Wiki-manager audiences; restricted content and linked files are filtered across Wiki and File Storage views. Managers can preview and compare sanitized historical revisions before restoring. Typed Wiki links navigate to readable pages; the link editor searches active pages visible to the current user. Other entity types still require manual IDs.
- **Wiki:** typed Wiki-page links open readable pages in-module; the editor searches/selects active Wiki pages, groups, and songs visible in the location, plus people for viewers with private People access. It fills the chosen ID and label. Only Wiki links navigate within the Wiki module; historical preview/compare panels do not navigate links.
- **Finance & Giving:** durable individual/collective donation receipts, a separate CSV bank statement reconciliation workflow with audited phrase-based suggestion rules, balanced split journal transactions with up to 100 account/cost-center/donor debit/credit/memo lines, configurable audited accounting periods, manager CSV report exports, and a read-only accounting-year close summary are implemented. Transaction search/date/year filters persist in the URL; the server returns bounded pages and a count, while CSV applies the same filters. Account and donor giving statements support date filters and manager CSV export; account balances remain cumulative from earlier ledger activity, and donor statements include posted income lines and signed reversals. The close summary shows posted debit/credit and income/expense totals, budget variance, and unmatched/suggested bank rows for the configured date range; it does not create closing entries or carry balances. Transaction date windows are constrained to the selected accounting year. Rules narrow possible matches but do not reconcile automatically; existing imported suggestions are not recomputed when rules change.

These are incremental features against the observed demo. They do not establish full ChurchTools parity; module-specific gaps remain tracked in the same GitHub issue and module READMEs.
