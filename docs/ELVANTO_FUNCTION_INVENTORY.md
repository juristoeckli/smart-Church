# Elvanto function inventory

Audit date: 2026-11-20
Purpose: a consolidated, implementation-oriented checklist of Elvanto's publicly documented product functions, member-facing functions, and published API operations. This is the Elvanto function list requested for the Smart-Church project.

## Scope and confidence

This inventory is compiled from Elvanto's official product pages, Help Center category index and topic pages, public API reference, and a read-only inspection in Chrome of Elvanto's public demo in both its Admin and Member areas. It lists documented and demo-visible capabilities; exact screens and availability can depend on plan, account configuration, location, permissions, integrations, and mobile platform. The public demo labels its entry point “Super Admin,” but direct inspection of individual Account Settings pages returned “You do not have access to this item”; those controls are therefore documented from Elvanto's Help Center rather than falsely described as verified in the demo. It does not claim access to Elvanto's private source code or undocumented internal functions. The ChurchTools demo supplied for context was inspected separately; its behavior is not attributed to Elvanto.

## 1. Church and account administration

- [ ] Cloud-hosted church management account accessible through a web browser.
- [ ] Multiple church locations/congregations under one account; associate people, groups, calendars, services, and flows with locations.
- [ ] Custom account defaults, settings, layouts, colors, logo, dashboard widgets, and member-area menu/layout.
- [ ] Admin settings areas include account information, legal/compliance, communication and occasion messages, sending domains, scheduled email/SMS, Super Admins, Access Permissions, password/security, formatting, contact templates, layouts/sidebars, and feature-specific settings.
- [ ] Role-based access permissions and user-level feature/data visibility controls; restrict access by location, group, department, or demographic where supported.
- [ ] Separate Admin Area and Member Area experiences, with configurable access for staff, volunteers, members, and guests.
- [ ] User account creation/invitations, user access upgrades, account status controls, and social sign-in integrations (Google/Facebook where configured).
- [ ] Account security and hosting controls, automatic backups, provider security, support, onboarding, and documentation.
- [ ] Email delivery settings and SMS integration via supported providers.
- [ ] Multi-location and account-specific language, currency, date/time, and financial year settings.

## 2. People database and member profiles

- [ ] Store people records and contacts; manage active people, contacts, volunteers, archived people, and login-account status.
- [ ] Store contact details, names (including preferred/middle names), addresses, phone/mobile, email, dates, family links, and church-specific information.
- [ ] Unlimited people records/custom data fields as marketed; people categories define different layouts and field sets.
- [ ] Custom fields and demographics; service types and locations; create searchable/reportable data for church-specific needs.
- [ ] Link family members and family relationships; use family data for contact, reports, giving, and check-in.
- [ ] People search and saved/custom searches; filter by age, location, demographics, category, group, and other criteria.
- [ ] People map/location search where address data is available.
- [ ] People profile notes, notes categories, private notes, and pastoral care records with restricted visibility.
- [ ] View people activity and relevant participation; track attendance and giving where enabled.
- [ ] Add/edit people one at a time or in bulk; mass manage selected people and fields.
- [ ] Import and export people data; export selected reports/data for administration.
- [ ] Merge/manage duplicates and keep records current.
- [ ] Send emails and SMS to individuals or filtered groups; use templates and schedule communications.
- [ ] Custom people reports and built-in reports; save, share with access controls, and export reports.
- [ ] Member directory with person/family view, search, sorting, configurable display fields/columns, preferred-name display, and family address display.
- [ ] Member directory privacy controls: member opt-in, pending approval, hide individual fields, exclude categories/demographics, always-include selected people, and automatically include newly created people by category.

## 3. People Flows and pastoral follow-up

- [ ] Build step-by-step flows for processes such as first-time visitor follow-up, new Christian, new member, first-time giver, baptism, volunteering, or pastoral care.
- [ ] Define flow name, location, applicable demographics, administrators, and step administrators.
- [ ] Create and order steps, descriptions, instructions, and entry points.
- [ ] Add people to a flow and move them between steps; track where each person is in a process.
- [ ] Assign people/administrators to follow-up actions and maintain accountability for due work.
- [ ] Configure automated or optional actions for flow steps where available.
- [ ] Configure reminder emails and/or SMS for flow and step administrators; schedule due and overdue reminders.
- [ ] Review flow status, people in each step, and flow-related reports.
- [ ] Collect follow-up information through forms and trigger additions to flows after submission/approval.

## 4. Groups and departments

- [ ] Create and categorize groups/departments; assign leaders and members and restrict access to leaders or authorized users.
- [ ] Organize groups for small groups, ministry teams, departments, boards, and other church structures.
- [ ] Group membership and role management; leader-scoped access and communications.
- [ ] Record group meeting schedules, events, and attendance; record individual attendance and custom reporting fields.
- [ ] Group-specific custom data/reporting and leader-submitted reports.
- [ ] Group notes, categories, private notes, and member-related notes.
- [ ] Group event calendars and invitations; invited people can accept or decline.
- [ ] Group locator map to view group locations and help members find a group.
- [ ] Group communication and reminders, including automated prompts for leaders to report attendance.
- [ ] Group-related reports and directory/search functions.

## 5. Services, worship planning, and volunteers

### Services and service plans

- [ ] Create service types and services for worship, youth, playgroup, or other recurring activities.
- [ ] Create recurring service schedules and service times; distinguish services or times as needed.
- [ ] Maintain upcoming, past, and all-services lists; configure locations and service details.
- [ ] Create service plan/run sheet with ordered items, service elements, songs, times, notes/comments, and attachments.
- [ ] Create reusable service templates and apply them to services.
- [ ] Create print presets and print service plans/rosters.
- [ ] Edit multiple services and move volunteers between services.
- [ ] Live run sheet view with progress, countdowns, notes, and team chat.
- [ ] Record service attendance as an individual roll or a headcount; add service reporting fields.
- [ ] Service reports for attendance, volunteers, and songs.

### Volunteers and rostering

- [ ] Define volunteer departments/teams and positions/roles; create teams that regularly serve together.
- [ ] Schedule volunteers into positions/services manually or with auto-scheduling.
- [ ] Check availability, scheduling preferences, frequency preferences, unavailability, and conflicts.
- [ ] Track assignment response/confirmation; send and follow up on roster requests.
- [ ] Let volunteers accept, decline, request swaps, or request a replacement for a particular service.
- [ ] Volunteer self-service login to view roster, update details, set preferences, and submit unavailability.
- [ ] Volunteer roster notifications and automated reminders; chase non-responses.
- [ ] Contact volunteers by email/SMS, including scheduled messages and templates.
- [ ] Calendar subscription/sync for a volunteer's roster.
- [ ] Mobile companion app for volunteers to view/respond to upcoming assignments and swap/replace.

### Songs and music library

- [ ] Song database with song categories and song/item distinction.
- [ ] Store song details and multiple arrangements; store keys, lyrics, and chord charts.
- [ ] Transpose chord charts to different musical keys.
- [ ] Import songs, lyrics, and chord charts through SongSelect integration.
- [ ] Mark songs as new/“to learn” and notify assigned musicians.
- [ ] Attach files/media to songs and share with teams; control whether audio can be downloaded.
- [ ] Publish/archive songs and control song access by permission/department.
- [ ] Include songs in service plans and song reports.

## 6. Child, youth, adult, and volunteer check-in

- [ ] Admin check-in by authorized leaders/team members.
- [ ] Self check-in for individuals/families using kiosk, computer, or tablet.
- [ ] Quick check-in by barcode/security-code scanning.
- [ ] Check children, youth, adults, and volunteers into a service, meeting, room, or location.
- [ ] Link families and select/check in relevant family members together.
- [ ] Assign age-based rooms; configure multiple rooms and room capacities/leader-to-child balancing.
- [ ] View who is checked in, arrival/departure, current room, and check-out state.
- [ ] Check out a person/family; use a security/session code to confirm an authorized pickup.
- [ ] Generate fixed or random family/person security codes and per-session pickup codes.
- [ ] Print child and parent labels; include name, security code, allergies, or other custom safety details.
- [ ] Configure label templates, printers, and multiple print stations/shared printers.
- [ ] Use barcode scanners and compatible label printers for quick check-in and checkout.
- [ ] Alert parents during a service via SMS.
- [ ] Filter/contact parents and guardians by email/SMS.
- [ ] Track individual attendance across services and check-in rooms; generate room, family, and attendance reports.
- [ ] Restrict child/youth data access through permissions; link family members for reporting and communication.

## 7. Calendars, events, registration, and assets

### Calendars and events

- [ ] Create multiple calendars for different ministries, event types, locations, and audiences.
- [ ] Create public, private, or draft events with name, date/time, all-day flag, location, description, organizer, color, and visibility.
- [ ] Create recurring events (daily, selected weekdays, weekly/fortnightly, monthly, yearly); configure frequency, recurrence day, number of occurrences, or end date.
- [ ] Assign events to one or more locations and calendars; display services and relevant group events on calendars.
- [ ] Invite people or groups; show who is attending, not attending, maybe attending, or has not replied.
- [ ] Contact guests/attendees, non-responders, or all invitees; send event reminders and updates.
- [ ] Hide private events from everyone except the organizer and invited guests.
- [ ] Calendar views for day, week, and month; search/filter and browse future events.
- [ ] Subscribe to member calendars through Google, Outlook, or iCalendar-compatible calendar feeds.
- [ ] Embed calendars on websites/apps via link, JavaScript, or iframe; choose included calendars, dates, view, week-start day, and locations.
- [ ] Integrate/view Google Calendar where supported.

### Registration and payments

- [ ] Accept simple attendance responses (yes/no/maybe) without ticketing.
- [ ] Link event registration to an Elvanto form or external registration URL.
- [ ] Create ticketed registration with multiple ticket types, ticket limits, prices, descriptions, and availability windows.
- [ ] Configure early-bird pricing and discount codes (percentage or fixed value), code limits, applicable tickets, and availability dates.
- [ ] Configure currency, taxes, supported payment methods, and part payments where available.
- [ ] Collect custom attendee information and optionally create new contacts from form registration.
- [ ] View/manage registrants and attendees and contact them.

### Rooms and assets

- [ ] Create/manage bookable rooms, equipment, and other assets.
- [ ] Attach resources/assets to events and see bookings by resource.
- [ ] Configure approval by an administrator for specific assets; track pending/approved/rejected booking state.
- [ ] Review upcoming and past asset bookings; filter by time range, status, calendar, location, asset, and address.
- [ ] View booking utilization/workload and print booking views.

## 8. Financial management, giving, and pledges

- [ ] Maintain giving transactions linked to a person/family or recorded without a person.
- [ ] Record batches and transactions by date, payment method, check number, amount, chart-of-account category, memo, and tax-deductible flag.
- [ ] Group transactions into batches; track batch status/date and whether funds were transferred/deposited.
- [ ] Split a transaction across multiple giving categories/accounts with separate amounts, tax settings, and memos.
- [ ] Import transaction and pledge histories from CSV; match transactions to people/giving numbers.
- [ ] Record and track pledges, frequency, goal amount, pledge transactions, and fulfillment.
- [ ] Maintain giving numbers; generate sequentially or assign manually.
- [ ] Categorize giving using the chart of accounts; configure tax-deductible defaults.
- [ ] Integrate supported online-giving providers; members can give through configured giving links/accounts.
- [ ] Generate individual or family giving statements; email or expose statements in a member account for viewing/downloading.
- [ ] Create tax-deductible receipts/statements and messages, including location-specific giving-statement messages.
- [ ] Allow members to view their own giving history/pledges and optionally family giving as configured.
- [ ] Reports for donations/giving, pledges, new givers, categories/accounts, and financial trends; share/export reports.
- [ ] Configure currency symbol, financial year end, chart of accounts, and financial access permissions.

## 9. Reports and data export

- [ ] Built-in reports for people, groups, services, volunteers, songs, financials, and attendance.
- [ ] Custom reports/search criteria for people, pastoral care, groups, check-in, services, and giving.
- [ ] Directory output, including photos where enabled.
- [ ] Save reports in the account and re-run later.
- [ ] Share reports with named users/teams under access permissions.
- [ ] Export reports/data to available formats.
- [ ] Report attendance, trends, volunteer schedules, group participation, service plans, room/child check-in, contributions, pledges, and donor activity.

## 10. Forms, email, SMS, blog, pages, and files

### Forms

- [ ] Build standard and event-registration forms with custom fields.
- [ ] Share forms by direct link or embed them on a church website/email.
- [ ] Collect new-contact details, update profiles, accept event sign-ups, and collect extra registration details.
- [ ] Set profile fields to update automatically or require admin approval.
- [ ] Trigger actions after submission/approval, including adding a person to a group or People Flow step.
- [ ] Support event registrations with ticket/payment information.

### Communication and content

- [ ] Send email and SMS to selected people, groups, volunteers, parents, or event guests.
- [ ] Drag-and-drop email editor; reusable email templates and placeholders populated from person/account fields.
- [ ] Schedule email/SMS communications for later delivery; automate roster, attendance, check-in, or flow reminders where supported.
- [ ] Blog with categories/tags, posts, and RSS feed for sharing news, updates, quotes, videos, and other content.
- [ ] Member-area Posts for timely notices and Pages for persistent information; configure which content guests/members can see.
- [ ] Sidebar/dashboard widgets and Member Area layout/menu editor.
- [ ] Store and organize files/folders; share documents/media with members, teams, leaders, or volunteers under permissions.

## 11. Member and volunteer self-service, web, and mobile

- [ ] Member login to a church-branded member portal with role-controlled features.
- [ ] Member-area Link dropdown with categorized named URLs; links can be published or hidden.
- [ ] Volunteer schedule/roster, service assignments, calendar sync, unavailability, preferences, and profile updates.
- [ ] Member directory and privacy controls.
- [ ] Member calendar and calendar subscription.
- [ ] Group Finder and My Groups.
- [ ] Member access to songs and related files, when granted.
- [ ] Member access to their own giving/pledges/statements when enabled.
- [ ] Pages, posts, blog, files, and other configured member resources.
- [ ] Personal profile self-service: edit profile/photo; control privacy by section; edit family where allowed; view giving/groups/needs; set email signature and general/scheduling email/SMS preferences; link Google sign-in where enabled; manage personal 2FA.
- [ ] User-created accounts for volunteers where enabled and controlled by account permissions.
- [ ] iOS/Android companion apps; documented mobile functions include worship planning/roster and member directory, with mobile-browser access to broader responsive account features.

## 12. Published developer API functions

These are API operation names/categories advertised by Elvanto's public API reference, separate from functions exposed in the web app. Available methods and writable fields vary by endpoint.

### API platform

- [ ] OAuth 2 authorization with scoped permissions and access-token refresh.
- [ ] API-key authentication using HTTP Basic authentication.
- [ ] JSON, XML, and PHP serialized response formats; POST JSON or form parameters; paginated reads.
- [ ] OAuth permission scopes: ManagePeople, ManageGroups, ManageServices, ManageSongs, ManageCalendar, ManageFinancials, AdministerAccount.

### People API

- [ ] `people/getAll`, `people/search`, `people/getInfo`, `people/create`, `people/edit`, `people/remove`, `people/currentUser`.
- [ ] `people/categories/getAll`, `people/customFields/getAll`.
- [ ] Profile fields include contact/name data, account flags, category/family information, and selected standard/custom fields; see the API field reference.

### People Flows API

- [ ] `peopleFlows/getAll`.
- [ ] `peopleFlows/steps/getAll`.
- [ ] `peopleFlows/steps/people` to list people in a step.
- [ ] `peopleFlows/steps/addPerson` to add someone to a flow step.

### Groups API

- [ ] `groups/getAll`, `groups/getInfo`, `groups/create`, `groups/edit`, `groups/remove`.
- [ ] `groups/addPerson`, `groups/removePerson`.

### Services API

- [ ] `services/getAll`, `services/getInfo`.
- [ ] Service reads can include service types, dates/status, service times, plans, volunteers, songs, files, and notes where those fields are requested and permitted. Public API reference lists read methods for Services.

### Songs API

- [ ] `songs/categories/getAll`.
- [ ] `songs/getAll`, `songs/getInfo`, `songs/create`, `songs/edit`.
- [ ] `songs/arrangements/getAll`, `songs/arrangements/getInfo`, `songs/arrangements/create`, `songs/arrangements/edit`.
- [ ] `songs/keys/getAll`, `songs/keys/getInfo`, `songs/keys/create`, `songs/keys/edit`.

### Calendar API

- [ ] `calendar/getAll` for calendars.
- [ ] `calendar/events/getAll`, `calendar/events/create`, `calendar/events/edit`, `calendar/events/remove`.
- [ ] Event API supports date/time, recurrence, status, organizer, location, description, registration links/forms, attendee visibility, locations, and assets as documented.

### Financial API

- [ ] Transaction reads: `financial/transactions/getAll`, `financial/transactions/getInfo`.
- [ ] Transaction writes: `financial/transactions/create`, `financial/transactions/edit`, `financial/transactions/remove`.
- [ ] Chart of Accounts: `financial/categories/getAll`, `financial/categories/create`.
- [ ] Transaction data supports person/batch, date/method, split amounts, accounts/categories, tax-deductible flags, memos, and amount-level edits/removals as documented.

## 13. External products and plan-dependent capabilities

- [ ] Online giving providers, SongSelect, Google Calendar, Google/Facebook sign-in, SMS gateway/provider, email delivery, barcode scanners, and label printers can add functionality or integrations.
- [ ] Pricing is described as based on active adults; children and inactive contacts/archived records are treated differently under the published pricing policy.
- [ ] Feature access, integrations, supported payment methods, mobile feature coverage, SMS charges, and country-specific tax/giving behavior must be verified for the actual account before implementation.

## 14. Page-by-page function map (Help Center taxonomy)

This section maps documented Elvanto page families to the actions and settings described by Help Center articles. Where several how-to pages cover the same workflow, the distinct functions are listed once.

### Account Settings pages

- [ ] **General account:** set account/church name; account time zone; language and date/time locale; manage user profile/password; configure two-factor authentication; review account security.
- [ ] **Access permissions:** create/edit permission sets; control Admin Area and Member Area features; assign permission sets to users individually or by mass management; limit records/fields by departments, groups, demographics, locations, and People Categories; export permission settings; configure sender/from email by access permission. Multiple assigned permission sets are permissive: the user's effective access reflects the highest grant, so restrictive lockdowns need to be consistent across assigned roles.
- [ ] **Users:** create/invite accounts; assign/update permissions; reset passwords; suspend/reactivate access; use single sign-on where enabled; enable/disable 2FA and manage account access.
- [ ] **Communication settings:** configure SMS provider and test messages; compose email, SMS and letters; schedule communications; configure two-way SMS where supported; manage encoding, message-length, sender identity, verified sending domains, delivery and unsubscribe.
- [ ] **Customization:** edit menu/navigation; configure dashboard widgets; change layouts, logo, colors, account domain and sidebar items; choose Member Area menu items.
- [ ] **Dashboard widgets:** add/remove, rename, color, reorder and position widgets for profile, service statistics, pending People Flow/note notifications, songs to learn, Member Area post comments awaiting admin approval, upcoming events, My Groups, and upcoming volunteer roster; available widgets follow user permissions.
- [ ] **Locations:** create/edit/delete locations; associate people, groups, services, events and flows with locations; configure location-specific access, timezone, reporting or giving-statement messaging where supported.
- [ ] **Demographics:** define demographic values/age brackets; set age-progression rules; override progression for an individual; use demographics in search, flow applicability, access restrictions and reports.
- [ ] **Departments:** create departments; assign members/volunteers and leaders; set report defaults; connect service positions and permissions to departments.
- [ ] **Assets:** create asset categories and assets; define bookable rooms/equipment; assign access/approvers; make and review bookings.
- [ ] **Billing/subscription:** review account subscription and plan; apply the published active-adult billing rules.
- [ ] **Integrations/developer settings:** configure integrations; register OAuth applications; manage/regenerate API keys; enable supported integration scopes.

### People pages

- [ ] **People directory/list:** search and filter; use standard/advanced filter logic; save People Views; choose columns; sort/page records; select multiple records for mass-management actions; view table/map; switch to legacy view where available.
- [ ] **Person profile:** view/edit contact data, categories, demographics, locations, family membership, volunteer status, notes, attendance, giving, history and custom fields according to permissions.
- [ ] **Profile Activity:** review profile change log, email/SMS activity (message content permission-dependent), service attendance and upcoming/past roster, financial activity, group attendance, form submissions and check-in activity; filter which activity categories appear.
- [ ] **Family pages:** link/unlink family members; manage family roles/address; update families; use family-wide form updates; include families in check-in, communications, giving views, reports and directory presentation.
- [ ] **Notes:** add, edit, categorize and restrict private people notes; import notes where supported; surface/report on notes according to permissions.
- [ ] **Scheduled pastoral/action notes:** choose a note type (Action, Call Back, Call In, Call Out, Meeting); assign it to a person; mark private; select a note category; schedule a follow-up date/time and assign a person responsible; complete, edit, or delete scheduled notes; search people with/without notes and report on note data.
- [ ] **Categories and fields:** create/edit/delete People Categories; define category-specific layouts and custom fields; control displayed columns and field visibility in profiles/reports; restrict access to sensitive fields.
- [ ] **Advanced Search:** compose multi-condition filters and AND/OR logic; save custom People Views; find age/location/membership/participation subsets; run targeted reports/communications.
- [ ] **Duplicates/data quality:** identify possible duplicates or misclassified records; compare and merge duplicate people; correct status/category while retaining the canonical profile.
- [ ] **People import/export:** map import-file columns; import new people; update existing profiles via imports; export directory data; import people notes; review import files and documented legacy migration paths.
- [ ] **Status/category management:** change category/status; distinguish active people, contacts, volunteers, archived records and login-user states; filter/export these populations.
- [ ] **Volunteer list/assignment:** list volunteers; assign department/service positions; review history/last scheduled date; submit individual/family unavailability; view/export unavailable-volunteer lists.
- [ ] **People Flows:** create/edit flows and steps; set flow/step administrators, dates, entry points and instructions; assign/unassign people; complete step assignments; find unassigned people and add them; configure due/overdue reminders and follow-up actions.
- [ ] **People activity/history reports:** report on category/status change history, participation and other supported activity; report on birthdays/age and active adult membership.
- [ ] **People defaults and profile behavior:** set default People Category and address; choose first/preferred/legal name rendering, middle-name initial, email/SMS name display, and sort order; set default displayed fields; include/exclude archived people in global search.
- [ ] **School grades and demographic progression:** create configurable grade fields; set the annual date for grade advancement; enable/disable automatic demographic advancement for new or edited records; set individual progression overrides.
- [ ] **Registration and self-service controls:** allow/disallow guest registrations; assign a default access permission to new accounts; require/select locations and departments at registration; control guest visibility of Posts/Pages; let members edit family data or block that capability; control whether a member may remove the year from their birth date/anniversary.
- [ ] **Administrative notifications:** set email recipients for registration and unsubscribe notifications; enable/disable email notices for scheduled person notes; approve requests to add someone who already exists to a family, with location-specific family administrators.
- [ ] **Archiving controls:** require or waive an archive reason; offer predefined reasons and allow a custom reason where configured; retain the reason in the record workflow.

### Groups pages

- [ ] **Group directory/detail:** browse, search, filter and categorize groups; edit group data, leaders, membership and access; mass-manage selected groups.
- [ ] **Group structure/roles:** assign leaders and assistant leaders; create category-specific additional positions (for example, secretary); restrict leaders to their own groups; allow category administrators to oversee leaders.
- [ ] **Group members:** add/remove people; manage leaders/members; contact groups; email group members; use member-area group access.
- [ ] **Group events/meetings:** create group events; invite members; send invitations; record attendance and meeting information; use group calendars.
- [ ] **Group notes/reports:** write group notes; restrict sensitive notes; configure report fields; track attendance; print offline attendance reports; remind leaders to submit reports; configure reminder settings.
- [ ] **Group category templates/automation:** use categories to standardize group setup/report fields; notify leaders/admins about new members or reports; set reminders for missing reports.
- [ ] **Group Finder/Locator:** enable/configure group finder; show groups by location/map; search nearby groups; contact leaders; submit join requests and manage approvals.
- [ ] **Member group interaction:** show groups, member/leader lists, and group message board/chat; let authorized members communicate and request to join.

### Service Planning pages

- [ ] **Service list/detail:** create/edit/delete services; view upcoming/past/all services; define service date, location, type and one or more service times; configure descriptions/images and recurrence.
- [ ] **Service types:** create/edit/delete service types; configure associated positions/teams and reporting behavior.
- [ ] **Plan/run sheet editor:** add/reorder service items and songs; enter start time/duration, lyrics/chords/key and notes; add comments, attachments and responsible roles; make plans available to authorized volunteers.
- [ ] **Templates/multi-service editing:** create/apply service templates; change multiple services together; move volunteers between services; print using saved print presets.
- [ ] **Volunteer roster:** assign volunteers to departments/positions; select availability-aware candidates; handle schedule conflicts; configure non-conflict settings for multiple roles; schedule teams or individual roles; add guest speakers; set reporting lines and responsible contacts.
- [ ] **Auto-scheduling/self-assignment:** automatically assign volunteers based on availability/preferences/conflicts; allow self-assignment for configured departments; manage teams and scheduling preferences.
- [ ] **Roster responses:** request confirmation; accept/decline assignments; swap/replace; notify affected volunteers; configure who receives swap requests; follow up on non-responses; send roster communications and reminders.
- [ ] **Unavailability:** volunteers submit dates or family unavailability; administrators review/export unavailable lists; scheduling checks these submissions.
- [ ] **Service reporting:** capture headcount/statistics/custom fields; record individual attendance; enter attendance for past services; delegate attendance-entry permission; review statistics and reports.
- [ ] **Elvanto LIVE:** show the current service plan with live progress/countdown, notes and team chat.
- [ ] **Songs area:** browse/search songs; add/edit/archive; add arrangements and keys; store chord charts, lyrics, audio/media/files; transpose/print charts; import/export; SongSelect integration; restrict access by department; mark songs to learn and notify musicians.
- [ ] **Volunteer/service notification settings:** configure automatic email/SMS (and app push where applicable) when scheduled or unscheduled; choose whether the “Reports To” person is notified on confirmation, decline, or both; follow up unconfirmed roster requests and repeat reminders until response.
- [ ] **Roster display/defaults:** set new assignments to confirmed or awaiting response; choose roster horizon and default tab; show/hide unconfirmed people; show family members; limit roster to services the volunteer serves at and departments to which they belong.
- [ ] **Volunteer response rules:** prevent a confirmed volunteer from declining, or impose a deadline; set advance notice for unavailability; allow/block unavailability submission when already scheduled; set swap/replace deadlines, cancel pending requests near service time, and configure who is notified about requests.
- [ ] **Scheduling constraints/preferences:** set a conflict buffer between services; define whether multiple service times count separately for preference limits; configure maximum desired service frequency; use non-conflict positions when a person can hold multiple roles.
- [ ] **Service report field types:** configure service reporting fields as headings, numeric reporting fields, text notes, or visual separators; save service-plan print presets for repeat printing.

### Check-in pages

- [ ] **Check-in setup:** enable check-in; set permissions; configure rooms, service eligibility and custom fields; connect printer/service requirements.
- [ ] **Check-in operation:** admin check-in, family self-check-in and barcode quick check-in; search by phone, surname or barcode; choose room; check in/out; view current attendance; handle children, adults, youth and volunteers.
- [ ] **Security/safety:** create fixed/random security codes; issue session codes; verify guardian pickup; show medical/allergy data to authorized operators; restrict child-data access.
- [ ] **Child-safety administration:** track background-check/screening status using profile fields, categories, People Views, People Flows and reports; use access permissions and check-in security codes to limit exposure and control child pickup workflows. The Help Center documents a tracking workflow; this is not evidence that Elvanto itself performs or verifies the background check.
- [ ] **Label configuration:** choose manual/automatic printing; set label content, logo, formatting, font size and custom fields; connect supported printers; configure print stations and troubleshoot.
- [ ] **Alerts/reporting:** message parents by SMS; review checked-in people/rooms; track attendance/absences; create/share/export room, family, child and attendance reports.

### Reports pages

- [ ] **Report browser:** browse built-in/custom reports by category; filter report categories; favorite reports; duplicate custom reports.
- [ ] **Standard/custom report builder:** create lists using selectable criteria and advanced filter logic; choose fields/export columns; set sharing permissions; generate PDF/CSV where supported.
- [ ] **Comprehensive reports:** combine built-in and standard reports, images, and text into one designed report; preview and generate; share securely; export to PDF (Help Center says comprehensive reports do not export to CSV/Excel).
- [ ] **Built-in reports:** run People, Groups, Services, Check-in and Financial report families.
- [ ] **Scheduled reports:** email custom, comprehensive, or built-in reports to selected recipients weekly, bi-weekly, monthly, every 3 months, every 6 months, or yearly; set start date/time and optional plain-text message; tune report filters/fields, preview, and export.
- [ ] **Report access and favorites:** filter report views by category, favorite reports, duplicate custom reports, set private/share access, and select whether recipients can only view/export; scheduled emailed reports grant recipients report access even if otherwise private.
- [ ] **People Views vs reports:** use reports for analysis/output; use People Views for mass-managing matched people (such as emailing or adding to a Flow); a report can be saved as both, or configured as either.
- [ ] **People/volunteer reports:** birthdays, category/status history, attendance, volunteer positions, unavailability, service assignments and sent-SMS reporting.
- [ ] **Financial report catalog:** batches, batch summaries, donors by method, donors by gift count, giving statements, new givers, pledge-vs-transaction amount, top givers and transactions; report fund totals and date/amount-filtered batches/transactions.
- [ ] **Service report catalog:** service attendance exports/statistics, group attendance, songs, volunteers and other built-in reports.

### Events pages

- [ ] **Event list/detail/editor:** create/edit/delete events; set event type, date(s), time, location, organizer, calendar, visibility/status, address/map, description, images and repeat/multi-day schedule.
- [ ] **Guest list:** invite people/groups; track yes/no/maybe/no response; contact guests/non-responders; show/hide guest list; restrict private events to organizer/invitees.
- [ ] **Simple attendance signup:** enable RSVP or link a form/external URL; allow existing people to respond; optionally create contacts from form signups.
- [ ] **Ticketed registration:** define ticket types, prices, descriptions, capacities/limits and sales windows; early-bird prices; discount codes with amount/percentage, ticket scope, dates and use limits.
- [ ] **Event payments:** configure currency/tax/payment gateway; support partial payments where enabled; record offline/cash/check payments; create invoices/tickets; print invoices/tickets; export ticket and invoice lists.
- [ ] **Event registrations/attendance:** view registration roster/attendance; capture extra fields; record attendance using form workflows; contact attendees; share registration links.
- [ ] **Event check-in:** record attendance from guest list, invoice/ticket list, attendee name, ticket number, barcode, or QR code; mark guest/ticket attended and review attendance status.
- [ ] **Event settings/invoices:** enable account-wide or per-event tax; set tax rate/inclusion defaults; configure online/offline payment methods and payment fees; enable part payments with minimum flat amount or percentage; customize invoice logo, numbering length/prefix/suffix, header/footer, and payment instructions.
- [ ] **Event ticket settings:** choose whether tickets show QR/barcodes; show ticket numbers remaining; create a QR code for a form/event registration link; review invoice/ticket exports.
- [ ] **Asset booking:** attach rooms/equipment/assets; enforce per-asset approval; review booking status/conflicts/utilization.
- [ ] **Event exports/recurrence:** export details/data; view past/upcoming lists; manage repeated/multi-day events; apply timezone behavior.

### Calendar pages

- [ ] **Admin calendar:** choose calendars to show; browse calendar views; display public/private events according to access; select/filter calendars.
- [ ] **Built-in calendar feeds:** show Services, Groups, People Notes, and Group Notes; choose calendar colors; scheduled notes appear on their due date for the assigned person.
- [ ] **Calendar defaults/guest access:** set default week/month view and week-start day; allow/block guest calendar access; choose whether guests may see services and/or groups; control shared events using calendar access/lockdowns.
- [ ] **Member calendar:** publish chosen events, services and group dates; group meetings can appear to group members and rostered activities to assigned volunteers; hide group/service dates when desired; configure which calendars appear in Member Area.
- [ ] **Calendar sharing/subscription:** subscribe through Google/Outlook/iCalendar-compatible feeds; share links; embed via JavaScript/iframe; choose calendars, dates, locations and display options.
- [ ] **Google Calendar integration:** display a public Google calendar in the Elvanto Admin Calendar; imported Google events are view-only external calendar content, not Elvanto Events, and do not appear as Member Area/Upcoming Events entries.
- [ ] **Calendar privacy caution:** an iCal subscription may expose Elvanto events marked private in the external calendar; confirm intended disclosure before enabling/subscribing.

### Forms pages

- [ ] **Form directory/editor:** create/edit standard and event-registration forms; categorize forms; set titles, fields, ordering and required state; share by link/embed.
- [ ] **Form design/logic:** drag-and-drop and reorder questions; use built-in People fields, category-specific custom fields, and form-only fields; configure conditional fields/headings based on prior answers; style colors and header/branding.
- [ ] **Form lifecycle/capacity:** publish, archive or close a form; set submission limits for standard forms and ticket limits for registration forms; show a closed-form message when unpublished, archived, or at limit.
- [ ] **Submission management:** inspect/export submissions; apply/approve profile changes; configure automatic updates and approval; require approval for email-address changes as documented.
- [ ] **Profile matching and automation:** choose not to update/add, add/update automatically, or wait for admin approval; auto-add/update requires the built-in email field; matching documented for existing records uses first and last name, while an existing active login user's submission requires admin acceptance; direct edits to form fields can alter/remove data in previous submissions.
- [ ] **Form-triggered actions:** create/update a contact; add a person to a group or People Flow step; configure multiple approval actions; set standard-form autoresponders where supported; capture event registration, ticket and payment information.
- [ ] **Form embedding:** embed/share standalone forms or insert forms into a Member Area Page/Post.

### Financial pages

- [ ] **Overview/donors:** inspect giving summaries and donor records; access transaction/pledge history; manage giving number and individual/family data visibility.
- [ ] **Batches:** create/edit/delete; set name/date/status/transferred flag; add transactions; change status; reconcile deposits by batch.
- [ ] **Transactions:** add/edit/delete; record date, donor/person, method, check number, amount, account, memo and tax-deductibility; split across accounts; add/remove batches; mass-manage; link/unlink to pledges.
- [ ] **Pledges:** create a dedicated account/fund; create/edit/delete pledges; record period/frequency and amount; add new or apply existing transactions; track fulfillment.
- [ ] **Chart of Accounts:** add/edit categories/accounts/subaccounts; categorize transactions; set tax-deductible defaults; print/export where supported.
- [ ] **Giving numbers:** auto-generate for new donors or all users; configure sequence/length; assign manually.
- [ ] **Giving statements:** generate for individuals/families/groups/selected donors; use templates/layouts/placeholders/messages; add location-specific text; print/download/email; expose in Member Area.
- [ ] **Financial filters/search:** search by donor name, giving number or batch number; filter transactions/batches by amount/date range.
- [ ] **Financial reports/exports:** run financial report set; customize fields; schedule/email reports; download/export PDF/CSV.
- [ ] **Financial settings:** set financial year end, currency, tax-deductible default vs account-specific settings, giving number generation, profile visibility of transaction/pledge/family data, giving URL and statement messages.
- [ ] **Scope limitation:** vendor documentation describes Financial as giving/pledge tracking and reporting, not full general ledger, payroll or accounting.

### Emails and Letters pages

- [ ] **Composition:** compose email, SMS or letter; select recipients; use templates/placeholders; style via drag-and-drop editor; personalize signature.
- [ ] **Bulk/scheduled messages:** send to people, groups, volunteers, parents, event guests and selected lists; schedule future communications and recurring report emails.
- [ ] **Mail delivery administration:** configure From address by permission; verify sending domain; manage one-click unsubscribe; view/report sent SMS; test SMS; use two-way SMS where available; handle delivery, encoding and length restrictions.
- [ ] **Letters:** create/print letters using placeholders and selected people data.

### Files pages

- [ ] **File storage:** upload/edit files and folders; organize shared documents/media; set published state and expiration date; copy File URL and image URL; insert files into Posts, Pages, emails, songs or other relevant content; view storage usage.
- [ ] **File lockdowns and versions:** control access by audience, location, demographic, department or permission; maintain file versions, republish prior versions, archive or delete old versions, and mass-delete files; use moderator permission to view files across lockdowns.
- [ ] **Profile files:** attach separate public/private files to a person's profile, manage/delete them, and view profile-file activity log; these files are separate from the shared Files storage and are not shown in the Member Area.

### Member Area pages

- [ ] **Member Area home/layout:** configure menu/pages/widgets; restrict pages/posts via lockdowns; set sticky pages and guest access behavior.
- [ ] **Posts and Pages:** create timely posts and persistent pages; embed forms/files; configure page lockdowns.
- [ ] **Member directory:** show family/person layouts and configurable fields; search/browse; configure inclusion/exclusion, opt-in and per-person privacy; print a church directory.
- [ ] **My Groups:** show a member's groups; use group message board; apply/join groups; configure group message board.
- [ ] **My Giving:** show permitted transactions/pledges/statements; link to online giving URL.
- [ ] **Volunteering:** view roster; accept/decline/respond; view service plan; set preferences/unavailability; request swaps/replacements; print songs/charts where permitted.
- [ ] **Calendar and Group Finder:** browse/subscribe to calendar; find groups, contact leaders and request to join.
- [ ] **Needs:** configure need types and optional email reminders before due date, on due date, and while overdue; members can create needs and subscribe/unsubscribe to need types; members browse Unassigned, Assigned to Me, and Completed lists, claim an unassigned need, mark it In Progress/Completed, and contact leadership to be reassigned if unable to finish. Administrators do not directly assign Needs in the documented workflow; subscribers receive email when a new need of their type is created.
- [ ] **Member login/security:** manage member account and optional 2FA.

### Import/migration pages

- [ ] Prepare source exports/import files; map fields/categories; set up prerequisites before import.
- [ ] Import people, profile updates, notes, group attendance, financial transactions and pledges where importers exist.
- [ ] Use published migration guides for supported source products; export event details/data from Elvanto.
- [ ] Review import errors and file formatting; verify each supported workflow per data type.

### Help, troubleshooting, and operations pages

- [ ] Troubleshoot access/permissions, workplace/network blocking, slow downloads, printers, email/SMS delivery and check-in.
- [ ] Review deletion/data-recovery guidance; do not assume deleted records are recoverable.
- [ ] Review security, email service use, printer compatibility and provider status/support documentation.

### Giving Statements pages

- [ ] **Statement templates/layouts:** configure statement layout, wording and available placeholders.
- [ ] **Statement generation:** select all or specific donors/people/families; generate statements for a chosen period; include location-specific messages where configured.
- [ ] **Statement delivery:** print or download statements; email statements; let members view/download their own statements when My Giving is enabled; correct source data and regenerate if a statement is wrong.

### Elvanto Guides pages

- [ ] **Administration guide workflows:** editing people; communication; using groups for meetings; reports; adding batches and transactions.
- [ ] **Children's and youth ministry workflows:** permission setup; background-check tracking; security codes/check-in; child reporting; follow-up using People Views and People Flows; volunteer check-in training.
- [ ] **Worship ministry workflows:** song management; songs and volunteers; communicating schedules.
- [ ] **Pastoral care workflows:** configure pastoral care records/flows and run pastoral-care reports.
- [ ] **Volunteer scheduling workflows:** schedule setup; last-scheduled review; volunteer service-plan access; self-assignment; diagnose missing swap/replace options.
- [ ] **Member/volunteer workflows:** view schedules, use Member Area directory/calendar, access service plans and self-assign where allowed.
- [ ] **Finance guide workflows:** giving numbers, built-in reports, My Giving, financial exports, event partial payments.

### Developer, integration, FAQ, and platform operations pages

- [ ] **Developer/API:** use the published API; regenerate API keys; configure supported integrations.
- [ ] **Published integrations and gateways:** PayPal event payments; Tithely Giving; Proclaim; Mailchimp capabilities; SongSelect; Google Calendar; external SMS/email/payment services as available.
- [ ] **Account operation and troubleshooting:** investigate missing features/permissions, network blocking, slow downloads, deleted-data recovery, email service policy, information security, and printer compatibility.
- [ ] **Third-party donation gateway FAQs:** support for integrations such as Engiven/cryptocurrency giving is described in FAQ material; availability depends on integration/provider configuration.

### Complete official Help Center page-family coverage

The public Help Center index is the source of truth for page families represented in this inventory. The following is its complete top-level category and subsection taxonomy as observed on 2026-11-20; article counts are the index's displayed counts where provided. Individual Help Center how-to articles are evidence for the workflows above, not additional Elvanto product modules.

| Help Center category | Page families listed in the index | Displayed article counts |
| --- | --- | --- |
| Giving Statements | Templates/layouts; print/download; donor-specific generation; complete guide | 4 |
| Account Settings | General; Communication (Scheduled Email & SMS); Users; Customization; Demographics and Locations; Assets; Departments; Billing | 7, 5, 14, 13, 6, 4, 3, 1 |
| People | All People; Duplicates; Advanced Search; Working with People; Volunteers and Scheduling; Flows; Categories; Import | 5, 2, 5, 29, 12, 7, 9, 2 |
| Groups | Group Finder / Locator; Working with Groups; Categories; Reports | 5, 14, 1, 5 |
| Service Planning | Working with Services; Service Types; Elvanto LIVE; Service Teams; Service Reporting; Songs; Worship | 17, 4, 2, 5, 7, 17, 1 |
| Check-In | Setup; Configuring Labels; Using the Check-in System | 8, 4, 13 |
| Reports | Scheduling and Sharing; Generating Reports | 2, 16 |
| Events | Event Registrations; Working with Events | 11, 16 |
| Calendar | Creating and Sharing Calendars | 7 |
| Forms | Working with Forms; Forms and Event Registrations | 6, 2 listed use cases |
| Financial | Financial settings/overview; Batches, Transactions and Pledges; Transactions; Reporting; Chart of Accounts; Giving Statements; Donor; Import | 5, 4, 5, 6, 2, 4, 3, 2 |
| Emails and Letters | Issues; Emails and Letters (composition, templates, signatures, unsubscribe, From addresses) | 4, 19 |
| Files | Working with Files / File Storage | 5 |
| Member Area | Member Directory; Posts and Pages; Needs; directory sharing/setup; My Giving; My Groups; Volunteering | 5, 9, 4, 6, 1, 2, 4 |
| Troubleshooting | Connectivity and Access; Data Recovery | 3, 1 |
| Importing | Overview; exporting from existing databases and source-specific migration | 8, 51 |
| FAQ | AI, giving integrations, email-use policy, security, printer compatibility and related questions | 12 |
| Elvanto Guides | Administration; Children's Ministry; Youth Ministry; Worship Ministry; Pastoral Care; Volunteer Scheduling; Members & Volunteers; Finance | 9, 6, 4 listed, 3 listed, 2 listed, 13, 9, 5 |
| Developer | Developers and Integrations | 6 |

Counts are navigation-index counts, not unique functionality counts; articles may be cross-listed in multiple categories, and some lists show only selected article titles before a “See all” link. The function checklist intentionally consolidates duplicates while retaining each documented capability.

## 15. Detailed settings and controls verified in article-level help

This section records controls that are easy to miss in a high-level module summary. These are documented settings rather than assumptions about every account's current screen.

### People settings

- [ ] Choose a default category and address values for people created in the account.
- [ ] Select name display rules for the app, email/SMS, full legal name, middle-name display, and sort order; preferred name falls back to first name when absent.
- [ ] Select which profile fields appear by default, and whether archived profiles appear in global navigation search.
- [ ] Set family contact-detail fields used in reports and People Views; choose whether changing one person's category also updates the family category.
- [ ] Assign family-add approval administrators by location; decide whether members may add/edit their family under My Profile.
- [ ] Decide whether self-edit of date of birth/anniversary may omit the year.
- [ ] Set grade fields and annual grade progression date; disable automatic demographic progression selectively for new-person entry or existing-person edits; apply person-specific overrides.
- [ ] Choose guest registration on/off, default permission for new registrants, required/optional location and department selection, guest access to public Posts/Pages, and completed-Flow visibility in the member sidebar.
- [ ] Set email recipients for new registration/account and unsubscribe alerts; enable/disable notifications for scheduled notes.
- [ ] Require archive reasons or make them optional; configure preset reasons alongside custom text.
- [ ] Set new-account access permissions carefully when public/guest registration is enabled; review permissions and member-directory exposure for unverified new registrants.

### Access permissions and profile activity

- [ ] Use preset roles (documented defaults include Inputting Finances, Admins, Group Leaders, Members/Volunteers, and Service Coordinators) or create role-based permission sets; assign or remove sets on an individual profile or by mass-managing selected people.
- [ ] Configure access at feature and data levels; restrict access to People Categories and fields as well as lockdown areas for locations, departments, demographics, groups, or other applicable records.
- [ ] Permission sets are additive/permissive: where a user has multiple permission grants, effective access uses the higher grant. Apply compatible lockdown restrictions to every assigned role.
- [ ] Review Profile Activity categories: profile changes, sent email/SMS activity, service attendance, financial activity, group attendance, form submissions, check-in events, and upcoming/past service schedules; filter activity categories and grant separate permissions for sensitive activity.

### Notes and pastoral follow-up

- [ ] Create person-linked notes with note type, category, privacy, creator, date, and (when applicable) a scheduled date/time and assigned completer.
- [ ] Use note categories to apply colors, private-by-default behavior, and access-permission visibility; Super Admins can see private notes, and explicitly authorized roles can be granted access.
- [ ] Users can see their own notes and notes scheduled for them, even if those notes are otherwise private/restricted; account for this exception when designing permissions.
- [ ] Complete, edit, or delete a scheduled note; search for people with or without notes; import note histories including note type, private flag, categories, creator, assigned completer, and completion date.

### Dashboard and files

- [ ] Personalize the Admin dashboard with permission-sensitive widgets: profile, service statistics, pending flow/note tasks, songs to learn, post comments awaiting approval, upcoming events, My Groups, and upcoming roster; add/remove, rename, recolor, and reorder widgets.
- [ ] In shared file storage, set a file's publish state, expiration date, member/public access and lockdown; obtain a file URL or image URL; monitor usage; organize files into folders with folder-level restrictions.
- [ ] Maintain file versions, republish an older version, archive/delete old versions, and mass-delete selected files; moderator permission can bypass individual file lockdowns.
- [ ] Attach separate private/public files to person profiles and review activity log entries for upload, rename, visibility changes, and deletion; profile files do not appear in Member Area and are separate from shared file-storage capacity.

### Needs workflow

- [ ] Admins create need types and configure email reminder on/off, pre-due frequency, due-date reminder, and overdue reminder frequency; reminders go to assigned members.
- [ ] Members enable/disable subscriptions to individual need types; subscribers receive email when a need of that type is created.
- [ ] Authorized users create needs, selecting a Need Type or creating a new “Other Type” as needed; access permissions control who may view/edit/respond.
- [ ] Members view Unassigned, Assigned to Me, and Completed needs; take an unassigned need, set it In Progress, then Completed.
- [ ] In the documented workflow, admins do not assign needs directly; an assignee unable to complete a need must contact leadership for reassignment/removal.

### Calendar settings and integration boundaries

- [ ] Maintain separate Admin and Member calendars; Admin Calendar can include Elvanto calendars/events/services/scheduled notes, while Member Calendar displays only what has been shared with the member audience.
- [ ] Choose a default week/month view, first day of week, built-in calendar colors, and guest access to selected calendars/services/groups.
- [ ] Add public external Google calendars for administrator reference; do not treat imported Google events as Elvanto events with member-feed or upcoming-event behavior.
- [ ] Embed a calendar as a link, JavaScript, or iframe; choose calendar(s), entire vs date-limited/upcoming range, month/week/day display (embed), first day of week, and location filters.
- [ ] Subscribe from Admin or Member Area using Google Calendar or iCal/Outlook links; member subscriptions reflect calendars exposed in the Member Area.

### Reports and sharing details

- [ ] Build standard reports from selected criteria; create comprehensive reports from report items plus text/images; use prebuilt reports for People, Groups, Services, Check-In, and Financial.
- [ ] Choose report category, fields, filters, output, sharing, and favorite; duplicate custom reports; generate/download CSV or PDF where supported.
- [ ] Schedule report emails at recurring intervals; configure start date/approximate send time, recipients, optional email message, filters/columns, preview, and PDF/CSV output where available.
- [ ] A recipient of a scheduled report email receives access to the report even when it is otherwise private; comprehensive reports are PDF-only according to the Help Center.

### Group settings and operation

- [ ] Decide whether a record should be a group, department, demographic, or People View: groups are recurring non-service gatherings; departments are used to roster service volunteers; demographics group by characteristics; People Views are saved query results.
- [ ] Maintain category-specific group information and reporting templates; assign leaders, assistant leaders, other category positions, and category-level administrators.
- [ ] Record baseline attendance and custom group report fields; let leaders view/edit their groups, create group events, and submit reports under their permissions.
- [ ] Enable member-facing group lists, leader/member visibility, group message board/chat, direct communication, and join requests as configured.

### Event payment and attendance settings

- [ ] Configure supported payment gateways (product/help documentation names Tithely, Stripe and PayPal, subject to current region/account support) and offline methods such as bank transfer, cheque/check, and cash.
- [ ] Set tax on/off, rate and include/exclude behavior globally with per-event override; configure fee passing for payment methods where supported.
- [ ] Allow deposits/part payments, configure minimum fixed or percentage amount, and provide a remaining-balance invoice payment link; don't assume automated balance-due reminders (the event-registration help article says those are not sent for part payments).
- [ ] Customize ticket descriptions, capacity and availability window, total event capacity, discount usage windows/limits/ticket applicability, invoice identity/format, and ticket QR/barcode.
- [ ] Check guests in from name, ticket number, QR or barcode; view attended status on guest and ticket lists.

### Service settings

- [ ] Configure volunteer contact on assignment and unassignment by email/SMS; where supported, app push accompanies the email/SMS.
- [ ] Configure reminders for pending confirmation and recurring follow-up intervals; edit the built-in contact templates used by those notifications.
- [ ] Choose which “Reports To” contacts receive confirmation/decline notifications.
- [ ] Set assignment default status, roster horizon, default roster tab, visibility of unconfirmed volunteers and family member schedules.
- [ ] Restrict volunteer rosters to assigned services/departments or expose broader service/department rosters where permission allows.
- [ ] Prevent a later decline after confirmation or set a cutoff; require advance notice for unavailability; allow/block unavailable submissions that overlap a scheduled service.
- [ ] Configure swap/replace deadlines, cancellation of pending requests close to the service, request recipients, scheduling conflict buffer, maximum service preference interpretation, and non-conflict multiple-role scheduling.
- [ ] Build service reporting layouts with numeric, note, heading, and separator field types; save print presets.

### Check-in methods and safeguarding behavior

- [ ] Choose admin-led check-in, self check-in at an unmanned station, or quick barcode check-in; check people into services and rooms, then check them out.
- [ ] Use individual or family security codes, barcode/phone/last-name lookup, fixed or regenerated security codes, and optional one-time session codes.
- [ ] Print child/person name labels and parent/guardian pickup labels; optionally include parent contact information, allergies, medical requirements, and configured custom fields.
- [ ] Set room eligibility/limits and report service/room attendance; restrict check-in access to assigned operators.

### Finance boundaries and reporting behavior

- [ ] Use batches as transaction groupings, transactions as recorded gifts/payments, pledges as commitments, and the Chart of Accounts/subaccounts as giving-purpose categories.
- [ ] Filter financial data by the configured fiscal-year end; search donors by name, giving number, or batch number; filter batches/transactions by date and amount; report fund totals.
- [ ] Keep the boundary explicit: Elvanto documents giving and pledge tracking/reporting, not payroll or full accounting.

## 16. Chrome demo: observed Admin and Member Area pages

This section records direct read-only observations from `https://demo.elvanto.com/` on 2026-11-20. It distinguishes what was visibly present in this demo from the broader documentation-based inventory above. Demo records are sample data; the list below records actions and page controls, not sample people's information.

### Admin navigation and main pages

- [ ] **Dashboard** (`/admin/`): permission-sensitive customizable widgets; demo showed Notifications, Attendance Last 3 Months, Upcoming Events, Attendance Last Month, People Categories, Quick Service Stats, Comments, Profile, and Songs To Learn. Widgets have edit/reorder controls. Notification widget included a link to pending Group Join Requests.
- [ ] **People** (`/admin/people/`): Add Person; Add Family; Contact People; Export; list search/view/filter controls; person and family management.
- [ ] **Groups** (`/admin/groups/`): Add Group; Contact Groups; search, saved View, Filter, list/table view.
- [ ] **Services** (`/admin/services/`): Add service; Edit Multiple; search, saved View, Filter, list/table view.
- [ ] **Songs** (`/admin/songs/`): Add Song; Export; CCLI Reporting; search, Filter, list/table view.
- [ ] **Check-in** (`/admin/checkin/`): Add Person or Family; Self Check-In; Start Print Station; test label; choose Children Only/Volunteers Only/All People; include/exclude archived people from searches; choose account default/DYMO Label App/DYMO Connect; review upcoming services, edit rooms, inspect check-in activity; search by name or last-name letter and filter. Print Station can prompt for a station when no physical printer is attached.
- [ ] **Needs** (`/admin/needs/`): Add; filter; choose page size; view all needs with type, date, location, status and assigned member; paginate.
- [ ] **Reports** (`/admin/reports/`): Add Standard Report; Add Comprehensive Report; search and choose report view/category; change list/table view; favorite, edit, share, email/schedule, duplicate, and export reports.
- [ ] **Events** (`/admin/events/`): Add Event; search; saved Views; Filter; list/table views.
- [ ] **Calendar** (`/admin/calendar/`): Add Event; Add Calendar; Subscribe; Embed; select calendars; filter; navigate previous/next/today; day/week/month views.
- [ ] **Forms** (`/admin/forms/`): Create Form; search; saved Views; Filter; list/table views.
- [ ] **Financial** (`/admin/financial/`): Add Batch; Add Transaction; Add Pledge; switch between Batches, Transactions, and Pledges; search by name or batch number; filter; show totals; switch list/table view; edit/open batches.
- [ ] **Emails & Letters** (`/admin/emails/`): Add Design Template; Add Standard Template; search and Filter.
- [ ] **Files** (`/admin/files/`): Add File; Add Folder; search; saved Views; Filter; show storage usage (the inspected demo displayed a 10 GB allowance); share uploaded files through pages, posts, or email.
- [ ] **Posts** (`/admin/posts/`): Add Post; search; saved Views; Filter; list/table views.
- [ ] **Pages** (`/admin/pages/`): Add Page; search; Filter; list/table views.
- [ ] **Links** (`/admin/links/`): Add Link; search; Filter. Link editor fields are name, published/hidden status, URL, and category; links appear under the Member Area Links dropdown, with uncategorized links at its top level.
- [ ] **Settings** (`/admin/settings/`): hub groups settings into General, Users, Customization, Features, and Developers; observed setting pages are itemized below.
- [ ] **Member Area** (`/`): public member-facing home; the observed demo exposed posts, an upcoming-events widget, and navigation itemized below.

### Settings hub page inventory observed in Chrome

- [ ] **General:** Account; Legal & Compliance; Communication; Occasion Messages; Sending Domains; Scheduled Email & SMS.
- [ ] **Users:** Super Admins; Access Permissions; Passwords & Security.
- [ ] **Customization:** Formatting (export/print/labels); Built-in Contact Templates; Layouts; Sidebars.
- [ ] **Features — People and groups:** People; Groups; Group Finder.
- [ ] **Features — service planning:** Services; Volunteers; Roster; Songs.
- [ ] **Features — check-in and events:** Check-in; Label Printing; Styles; Events; Calendar.
- [ ] **Features — giving and content:** Financial; Giving Statement Templates; Posts; Member Directory; Member Directory Layout.
- [ ] **Features — account data:** Departments; Demographics; Locations; Assets; Asset Categories; Note Categories; Needs; Need Types.
- [ ] **Developers:** Integrations.
- [ ] The settings hub exposed these entries by name/description; a direct visit to an individual Account Settings route returned an access-denied message in this demo, so the specific controls are described from official help articles instead of guessed from the index.

### Admin page editors and content controls observed in Chrome

- [ ] **Post editor** (`/admin/posts/post/`): title and permalink; rich-text body; insert/attach file from Files; publish immediately or schedule date/time; Published/Draft state; category, author and tags; allow comments; expiration date/time; lockdown by department, location, demographic, group, and access permission. With no lockdown selected, the demo states the post is visible to everyone.
- [ ] **Page editor** (`/admin/pages/page/`): title/permalink; rich-text formatting (bold, italic, alignment, lists, indents, quote, links, images, anchors, format/size/font, color, underline/strikethrough, tables, external media, special characters, paste modes, remove formatting, spell-check, maximize, source); attach Files-area documents; Published/Draft; choose Member Area navigation or home-page placement; expiration; lockdown settings (page-specific available areas depend on account configuration).
- [ ] **Member Link editor** (`/admin/links/link/`): set title/name, URL, Published or Hidden, and category; category controls dropdown grouping.
- [ ] **Reports list**: separate standard and comprehensive types; rows show category, description, created/modified details, and offer Edit, Sharing, Email, Duplicate, and Export actions.

### Member Area and personal profile pages observed in Chrome

- [ ] **Home** (`/`): posts and events; demo home showed a post detail with author/date/category and an Upcoming Events panel.
- [ ] **Roster** (`/roster/`): Subscribe; change upcoming-service horizon; navigate services by date; open service; switch Volunteers/Plan; Edit, LIVE, and Print actions; view other service times.
- [ ] **Group Finder** (`/groups/`): filter groups, choose result page size, paginate, browse group cards with image/name/meeting location, open group details.
- [ ] **My Groups / group detail** (`/profile/groups/`): list groups; group detail shows time/location/map, leaders, Notifications, Edit My Privacy, Submit Report, Messages and Members tabs; member message board includes a message composer.
- [ ] **My Giving** (`/profile/giving/`): member view of giving records/statements according to access/settings.
- [ ] **Needs** (`/needs/`): Assigned to Me, Unassigned, Completed tabs; need cards show type, due date, location and status.
- [ ] **Calendar** (`/calendar/`): Subscribe; View Admin Calendar if permission allows; day/week/month; previous/next/today navigation.
- [ ] **Member Directory** (`/directory/`): search; View Families toggle; card/list switch; result page size and previous/next pagination; directory entries expose only permitted fields.
- [ ] **Unavailability** (`/profile/unavailability/`): submit start/end dates; choose all-day or time-of-day; repeat never/daily/weekly/monthly-by-day/monthly-by-week/yearly; select location; enter reason; Add an interval, then Submit.
- [ ] **My Profile** (`/profile/`): Edit Profile; Profile Picture; Privacy Settings; Giving; Family (including Add Family Member); Groups; Needs; Communication Preferences; Roster; Unavailability; optional Google account linking; Two Factor Authentication.
- [ ] **Privacy Settings** (`/profile/privacy/`): set visibility per field/section; green fields are visible and gray fields hidden; observed sections include Member Directory and Groups.
- [ ] **Communication Preferences** (`/profile/preferences/`): configure personal email signature; opt into/out of general and service-scheduling emails and SMS; save preferences.
- [ ] **Two Factor Authentication** (`/profile/two-factor`): enablement flow asks for account password and authenticator-app code; inspection stopped before setup so no security state was changed.
- [ ] **Get Help** (`/pages/help/`): member help page with contact/support link.

### Demo inspection limits

- [ ] The Chrome session used the demo's Super Admin entry option and opened its Admin and Member Area pages without editing or saving records. Settings hub navigation was visible, but a direct visit to an individual Account Settings page returned “You do not have access to this item.”
- [ ] The demo displays only its configured sample data, permission sets, locations, categories, modules, and page menus. Do not interpret absent demo entries as proof that Elvanto lacks a documented function.
- [ ] Help Center and API research remains necessary for settings pages, other permission profiles, integrations, and functions not exposed in this demo session.

## Source references

### Elvanto product and feature pages

- [Features overview](https://www.elvanto.com/features/)
- [Administration and account functions](https://www.elvanto.com/features/administration/)
- [People](https://www.elvanto.com/features/all/people/)
- [Groups](https://www.elvanto.com/features/all/groups/)
- [Pastoral care](https://www.elvanto.com/au/features/pastoral-care/)
- [Worship planning and volunteers](https://www.elvanto.com/features/worship/)
- [Child and youth check-in](https://www.elvanto.com/eu/features/all/child-check-in/)
- [Event management](https://www.elvanto.com/features/all/event-management/)
- [Financial tracking](https://www.elvanto.com/features/financial/)
- [Reports](https://www.elvanto.com/features/all/reports/)
- [Community and volunteer login](https://www.elvanto.com/features/all/community-volunteer-log-in/)
- [Pricing](https://www.elvanto.com/pricing/)

### Elvanto help articles

- [Complete Help Center category and article index](https://help.elvanto.com/hc/en-us/categories/6656300302743-Help-Center)
- [Member area overview](https://help.elvanto.com/hc/en-us/articles/7501704992791-The-Member-Area-Overview)
- [Top areas members can access](https://help.elvanto.com/hc/en-us/articles/16848603785751-Top-Areas-Members-Can-Access-in-the-Elvanto)
- [Member directory settings](https://help.elvanto.com/hc/en-us/articles/7500997283607-Member-Directory-Settings)
- [People Flows](https://help.elvanto.com/hc/en-us/articles/7481304329495-People-Flows)
- [How to use People Flows](https://help.elvanto.com/hc/en-us/articles/7599396830871-How-to-use-People-Flows)
- [Services overview](https://help.elvanto.com/hc/en-us/articles/7481494400535-Services-Overview)
- [How to edit a service](https://help.elvanto.com/hc/en-us/articles/7604108730519-How-to-Edit-a-Service)
- [Service settings](https://help.elvanto.com/hc/en-us/articles/7500684639511-Service-Settings)
- [Check-in overview](https://help.elvanto.com/hc/en-us/articles/7482180476439-Check-In-Overview)
- [Events overview](https://help.elvanto.com/hc/en-us/articles/7482222664983-Elvanto-Events-Overview)
- [Forms](https://help.elvanto.com/hc/en-us/articles/7648187078551-Forms)
- [Forms use cases](https://help.elvanto.com/hc/en-us/articles/7580810756503-Using-Forms)
- [Financial section overview](https://help.elvanto.com/hc/en-us/articles/7482278722199-Financial-Section-Overview)
- [Elvanto API usage](https://help.elvanto.com/hc/en-us/articles/7626452924823-How-to-use-the-Elvanto-API)
- [People settings](https://help.elvanto.com/hc/en-us/articles/7499823513495-People-Settings)
- [People Flows setup and reminders](https://help.elvanto.com/hc/en-us/articles/7599396830871-How-to-use-People-Flows)
- [Service settings and roster controls](https://help.elvanto.com/hc/en-us/articles/7500684639511-Service-Settings)
- [Group overview, leaders and report categories](https://help.elvanto.com/hc/en-us/articles/7481435328791-Elvanto-Groups-Overview)
- [Check-in overview and security codes](https://help.elvanto.com/hc/en-us/articles/7482180476439-Check-In-Overview)
- [Security codes and check-ins](https://help.elvanto.com/hc/en-us/articles/7582115422743-Security-Codes-and-Check-Ins)
- [Form overview](https://help.elvanto.com/hc/en-us/articles/7482338373783-Forms-Overview)
- [Create/edit forms and conditional fields](https://help.elvanto.com/hc/en-us/articles/7624431623063-How-to-Create-and-Edit-a-Form)
- [Using forms and profile updates](https://help.elvanto.com/hc/en-us/articles/7580810756503-Using-Forms)
- [Event settings, tax, payment and invoices](https://help.elvanto.com/hc/en-us/articles/7501125829527-Event-Settings)
- [Event registration, tickets, discounts and part payments](https://help.elvanto.com/hc/en-us/articles/7622538747799-How-to-Add-Registration-to-an-Event-with-Tickets-and-Payments)
- [Event attendance/check-in](https://help.elvanto.com/hc/en-us/articles/7622421486359-Event-Attendance-in-Elvanto)
- [Financial settings](https://help.elvanto.com/hc/en-us/articles/7501255977239-Overview-of-the-Financial-Settings-Area)
- [Member Area overview](https://help.elvanto.com/hc/en-us/articles/7501704992791-The-Member-Area-Overview)
- [People Notes: scheduling, categories and private-note access](https://help.elvanto.com/hc/en-us/articles/7481357496983-People-Notes)
- [How to use Reports](https://help.elvanto.com/hc/en-us/articles/7622122691479-How-to-use-Reports)
- [Automatically email reports](https://help.elvanto.com/hc/en-us/articles/7622335970839-How-to-Automatically-Email-Reports)
- [Share custom reports](https://help.elvanto.com/hc/en-us/articles/7622315223319-How-to-Share-Custom-Reports)
- [Calendar overview and settings](https://help.elvanto.com/hc/en-us/articles/7482221501591-The-Calendar-Overview)
- [Google Calendar integration limits](https://help.elvanto.com/hc/en-us/articles/7622727186327-How-to-Integrate-a-Google-Calendar-into-Elvanto)
- [Calendar subscription](https://help.elvanto.com/hc/en-us/articles/7622719767959-How-to-Subscribe-to-your-Elvanto-Calendar)
- [Dashboard widgets and customization](https://help.elvanto.com/hc/en-us/articles/19208177151127-How-to-Customize-Your-Elvanto-Dashboard)
- [Creating and managing files, versions and lockdowns](https://help.elvanto.com/hc/en-us/articles/7624969513239-How-to-Create-and-Edit-Files)
- [File storage and folders](https://help.elvanto.com/hc/en-us/articles/7624927931415-How-to-Use-the-File-Storage-System)
- [Files attached to profiles and their activity logs](https://help.elvanto.com/hc/en-us/articles/10737419867927-Adding-Files-to-Profiles)
- [Needs: member claiming and completion](https://help.elvanto.com/hc/en-us/articles/7622808844567-Accepting-and-Completing-a-Need-as-a-Member)
- [Needs: types and reminders](https://help.elvanto.com/hc/en-us/articles/7622863673495-Setting-Up-Need-Types-and-Reminders)
- [Creating a Need](https://help.elvanto.com/hc/en-us/articles/7622806366359-Creating-a-Need)
- [Member subscriptions to Need Types](https://help.elvanto.com/hc/en-us/articles/7622810817431-Subscribe-to-a-Need-Type-as-a-Member)
- [Member facing features](https://help.elvanto.com/hc/en-us/articles/16848603785751-Top-Areas-Members-Can-Access-in-the-Elvanto)
- [Admin Area and Member Area differences](https://help.elvanto.com/hc/en-us/articles/7481034443159-The-Difference-Between-The-Admin-and-Member-Area-in-Elvanto)
- [Service planning overview](https://help.elvanto.com/hc/en-us/articles/7481494400535-Services-Overview)
- [Access Permissions](https://help.elvanto.com/hc/en-us/articles/7582092554391-Access-Permissions)
- [Create/edit access permission sets](https://help.elvanto.com/hc/en-us/articles/7625087265559-Add-or-Edit-Access-Permissions-in-Elvanto)
- [Assign permission sets individually or in bulk](https://help.elvanto.com/hc/en-us/articles/13068699328279-Assign-Access-Permissions-To-A-User)
- [Profile Activity categories](https://help.elvanto.com/hc/en-us/articles/22922824668183-Viewing-Profile-Activity)
- [Elvanto Glossary](https://help.elvanto.com/hc/en-us/articles/7482377567767-Elvanto-Glossary)

### Elvanto API reference

- [API index](https://www.elvanto.com/api/)
- [Getting started](https://www.elvanto.com/api/getting-started/)
- [People](https://www.elvanto.com/api/people/)
- [People fields](https://www.elvanto.com/api/people-fields/)
- [People Flows](https://www.elvanto.com/api/peopleFlows/)
- [Groups](https://www.elvanto.com/api/groups/)
- [Services](https://www.elvanto.com/api/services/)
- [Service fields](https://www.elvanto.com/api/services-fields/)
- [Songs](https://www.elvanto.com/api/songs/)
- [Events calendar](https://www.elvanto.com/api/calendar/)
- [Financial](https://www.elvanto.com/api/financial/)
- [Public Elvanto demo inspected in Chrome](https://demo.elvanto.com/login)

## Research note

“All” here means the capabilities documented in Elvanto's public product/Help Center/API references plus the page families and controls visible in the public Elvanto demo during this audit. This is substantially broader than a feature summary, but it is not a guarantee that every runtime feature or screen has been captured: Elvanto does not publish a complete source-level function inventory, and the public demo denied access to individual Account Settings pages. Private/account-specific options, role-specific navigation, mobile differences, plan gates, later product changes, and integrations can add or vary behavior.

## 18. Additional demo inspection and documented functions (continuation)

### People directory (observed in the public demo)

- [ ] Directory actions: Add Person, Add Family, Contact People, Export, and a page/view control.
- [ ] Search by text; open Advanced Search; select the visible view (All People in this session); open Filters / Views.
- [ ] Built-in views shown: All People, Volunteers, Contacts, Categories, Groups, and Custom.
- [ ] Filter dimensions exposed in the panel: Status (Active, Contacts, Suspended, Archived); Locations; Demographics; Departments; and Access Permissions. The panel also has a filter search field, Clear, Cancel, and Save.
- [ ] Directory table includes selection checkboxes and columns Full Name, Email Address, Mobile Number, Phone Number, People Category, and Locations; person rows provide Activity, Notes, Family, and Account & Volunteering shortcuts.
- [ ] The demo showed 274 results, paged at 100 rows. This is sample data, not a product limit.
- [ ] Clicking a person from the directory returned “You do not have permission to perform this action.” Profile detail could not be inspected under this demo permission.

### Group detail and reporting (observed in the public demo)

- [ ] Group actions include Submit Report, Contact, Add People, Print Checklist, Delete Group, and Duplicate Group.
- [ ] Group overview includes map/location context and leaders; tabs include People, Events, Activity, Notes, Reporting, and Join Requests.
- [ ] Group People rows expose person profile links and Activity, Notes, Family, Account & Volunteering links, with columns for name, position, email, phone, and mobile.
- [ ] Group reporting can be viewed over a selected period (the demo offered Last 3 months) and includes report date, people in group, members, guests, absent, and total attendance, with full history pagination.
- [ ] Group Activity records member added/removed, demographic added, meeting date changed, and group role changed events.

### Asset bookings (official Help Center)

- [ ] Assets are linked to events and bookings; the system checks time overlaps/conflicts.
- [ ] An asset can have a name, archive state, location, administrators to notify, notification preference, required booking buffer, and contact template.
- [ ] Asset categories bundle related resources and can have approver access. Event organizers/editors see linked room and asset bookings.
- [ ] A booking can require approval. Asset administrators receive an email; approval or rejection emails the event organizer. Organizers/editors can see linked bookings on the calendar.
- [ ] Asset booking list can be filtered by date range, status, calendars, locations, and assets; sorted by start/end, calendar, location, asset, or address; shown in list/table views. The documented maximum range is 36 months.

### File storage and access (official Help Center)

- [ ] File records expose file URL and image URL and can be public, member-accessible, or protected by lockdown rules.
- [ ] Documented limits: 40 MB per file and 10 GB account storage.
- [ ] Lockdown access can be defined by group, department, location, or demographic. Folder lockdown is inherited; parent/child rules combine using AND/OR logic. A moderator can bypass lockdown.
- [ ] Files support versioning: upload a new version, republish an older version, and archive/delete prior versions. Files/folders support bulk delete.
- [ ] Files can be inserted or attached in posts, pages, and emails as links, images, or attachments. Inline email images require no lockdown. Direct file attachments uploaded into an email are stored in Files without restrictions.

### Group Finder and join applications (official Help Center)

- [ ] Member-facing group finder supports map/list display, hiding the map, configured filters and restrictions, and embed code. Groups already joined by the member are excluded from their finder results.
- [ ] Members can apply to join a group using its form and can include friends/family; each included person needs their own application details.
- [ ] New applications notify the group leader; assistant leaders and category admins are not notified by this workflow.
- [ ] Leaders accept/reject requests and can choose whether applicants are notified. Groups have no automatic capacity limit; open/closed status is managed manually.
- [ ] Settings can enable automatic contact behavior and configure map visibility, finder filters, and restrictions.

### Financial batch and transaction detail (observed in the public demo)

- [ ] Financial overview exposes Add Batch, Add Transaction, Add Pledge; Batches/Transactions/Pledges views; Search, View, Filter, and total summary.
- [ ] Batch rows show ID, name, amount, date, and transferred status. Batch detail provides Add Transaction and Print, open/transferred status, totals received, number of transactions, totals by account/subaccount and payment method, plus a paginated transaction table.
- [ ] Transaction editor supports donor change, batch selection, transaction date, payment method (Cash, Check, Credit Card, Bank Transfer, Automatic Direct Debit, Online, Other), split account/subaccount amount rows, optional pledge selection, memo, tax-deductible flag, add/remove rows, calculated total, and Save.
- [ ] Demo inspection was read-only; no financial records were changed.

### Forms (observed in the public demo)

- [ ] Forms index provides Create Form, All Forms, Published/Unpublished/Standard/Event Registration filters, search, page-size control, and list-view switch. Each form row offers Edit, Duplicate, and View.
- [ ] A public contact form showed First Name, Last Name, Email, Phone, Mobile, repeatable Add Another Person, and per-person remove controls. The form was not submitted.

### Event demo limitation

- [ ] Event list rows expose Registration, Invoices & Tickets, and Guests shortcuts; list columns include name, start/end, calendar, locations, assets, and where.
- [ ] Opening the observed event detail route returned “Internal Server Error,” so event detail functions need further inspection through other demo routes or Help Center documentation.

### New references

- [Asset booking](https://help.elvanto.com/hc/en-us/articles/7625861242903-How-to-Book-an-Asset)
- [Link assets to an event](https://help.elvanto.com/hc/en-us/articles/7482226592279-Link-Assets-to-an-Event)
- [Add an asset](https://help.elvanto.com/hc/en-us/articles/7625805655831-How-to-Add-an-Asset)
- [View asset bookings](https://help.elvanto.com/hc/en-us/articles/17036957042199-How-can-I-view-my-Asset-Bookings)
- [Create and edit files](https://help.elvanto.com/hc/en-us/articles/7624969513239-How-to-Create-and-Edit-Files)
- [Add and manage files](https://help.elvanto.com/hc/en-us/articles/7580873578007-Adding-and-Managing-Files)
- [File lockdowns](https://help.elvanto.com/hc/en-us/articles/7624983869719-How-File-Lockdowns-Work)
- [Apply to join a group](https://help.elvanto.com/hc/en-us/articles/7600138035607-How-to-Apply-to-Join-a-Group)
- [Enable Group Finder](https://help.elvanto.com/hc/en-us/articles/7600070900631-Enabling-Group-Finder)
- [Public Elvanto demo](https://demo.elvanto.com/login)

## 19. Additional people, communications, and member content functions (official Help Center)

### People data management

- [ ] Duplicate queue supports comparing records, choosing/changing the primary profile, selecting non-conflicting fields from secondary profiles, and merging duplicates; after a merge, the next duplicate can be opened. A record can be marked Not a Duplicate, later reviewed in a separate list, and restored to the duplicate queue. Merge is irreversible according to Help Center guidance.
- [ ] People import can add new records and update matched existing records from CSV. Import options include date format, column-to-field mapping, duplicate handling (update or skip), match keys, a review summary, and a final import step.
- [ ] Mass Manage bulk-updates selected people after Advanced Search; select all and deselect exceptions, then change location or other supported details.
- [ ] Profile editing includes personal details, department, demographics, and family information. Contact status can make some profile fields read-only until the person is made Active. Super Admin-specific email fields have stricter editing permissions.
- [ ] Deletion is permanent; archiving preserves the record but removes it from reports and active roles.

### Communication and email/SMS/letters

- [ ] Contact an individual from their profile, a group from its page, or multiple recipients from a People View/Advanced Search. Recipient pane shows contact-channel eligibility and allows removing recipients; warnings identify missing contact details or unsubscribed people.
- [ ] Compose email only, SMS only, both email and SMS, or a letter. SMS requires account setup; character count and reply option are available. Reply-enabled SMS does not use the configured sender ID.
- [ ] Emails and SMS can be scheduled for a future date/time, at least 24 hours ahead. Scheduled items support preview/reschedule; content and recipients cannot be edited after scheduling.
- [ ] Communication settings include default sending address/domain verification via DNS CNAMEs, permitted From addresses controlled by Access Permissions, archive-copy address, sent-email reporting, default empty messages, mandatory but customizable unsubscribe text, shared email header/footer, and Mailchimp integration.
- [ ] Custom SMS templates are not supported; email and letter templates are. Built-in templates are grouped by People, Groups, Notes, SMS, Services & Volunteers, Needs, Forms, Events, Reports, and Assets. Template editing allows subject/message (and images for email), supported placeholders, save, and restore-default.
- [ ] Design Email Editor supports drag/drop columns, buttons, dividers, headings, text, images, menus, HTML, prebuilt blocks, body text/background colors, content width/alignment, font family, preheader, and hyperlink color/underline. Templates have active/inactive status, From, subject, lockdowns, preview, and save.
- [ ] Placeholder library includes person/family/address/contact fields, demographics/departments/locations/groups/service types, usernames, security code, receipt name, giving number, and custom-field placeholders. Availability varies by template.
- [ ] Automated birthday/anniversary communication supports email, SMS, or both; filters by category/demographic and whether contacts are included. When both channels are selected, SMS may be limited to people without email. Anniversary sending requires matching spouse/primary family relationships, Married status, and shared anniversary date.
- [ ] People can unsubscribe from general/scheduling email and SMS separately. Recipients can unsubscribe by email link, SMS STOP/CANCEL/UNSUBSCRIBE keywords, or Member Area communication preferences; resubscription is available by form opt-in or SMS START.
- [ ] Address labels can use multiple custom templates with draggable person/family/address fields, selected paper/label size, and generation from a People View or report.

### Posts and pages in the Member Area

- [ ] Pages are static content; Posts are time-sensitive/member news. Both can be placed in Member Area navigation; built-in pages, custom links, and post categories can be added in Menu Editor and tabs renamed/removed.
- [ ] Posts and Pages share the lockdown model with Files. Access can be open to guests/members or restricted to members, with rules based on profile criteria; category/folder lockdowns are inherited and access rules combine through AND/OR logic.
- [ ] Post categories have details, permalink, lockdown/access, and RSS feeds for the blog or individual categories.
- [ ] Pages and Posts can embed a form or calendar using iframe code, and content can include files. Pages support static content and access restrictions in the member area.
- [ ] Member Area navigation/layout controls govern which pages users see, alongside access permissions. Sidebar widgets may surface external updates such as Twitter.

### Sources

- [Communicating with people](https://help.elvanto.com/hc/en-us/articles/7481230820375-Communicating-With-People)
- [Compose email, SMS, or letter](https://help.elvanto.com/hc/en-us/articles/7630552414871-How-to-Compose-an-Email-SMS-or-Letter)
- [View scheduled email and SMS](https://help.elvanto.com/hc/en-us/articles/7630335289111-How-to-View-Scheduled-Emails-and-SMS)
- [Email setup and templates](https://help.elvanto.com/hc/en-us/articles/7501628020247-Using-Email)
- [Design email editor](https://help.elvanto.com/hc/en-us/articles/24800660300823-Getting-Familiar-With-the-Design-Email-Editor)
- [Automatic birthday and anniversary messages](https://help.elvanto.com/hc/en-us/articles/7597134929047-Setting-Up-Automatic-Birthday-and-Anniversary-Emails-and-SMS)
- [Placeholders](https://help.elvanto.com/hc/en-us/articles/7627239440151-List-of-Placeholders)
- [Unsubscribe from email and SMS](https://help.elvanto.com/hc/en-us/articles/20120221662103-How-to-Unsubscribe-from-Email-and-SMS)
- [Print address labels](https://help.elvanto.com/hc/en-us/articles/7627310973591-How-to-Print-Address-Labels)
- [Merge duplicate people](https://help.elvanto.com/hc/en-us/articles/7597336832151-How-to-merge-Duplicate-People-in-Elvanto)
- [Update profiles by import](https://help.elvanto.com/hc/en-us/articles/29465019001111-How-to-Update-Profiles-via-Importing)
- [Edit people](https://help.elvanto.com/hc/en-us/articles/7580986769047-Editing-People)
- [Delete a person](https://help.elvanto.com/hc/en-us/articles/31565412131351-How-to-Delete-A-Person)
- [Post categories](https://help.elvanto.com/hc/en-us/articles/7624755641879-How-to-use-Post-Categories)
- [Page lockdowns](https://help.elvanto.com/hc/en-us/articles/7624861332887-How-Page-Lockdowns-Work)
- [Embed forms in posts/pages](https://help.elvanto.com/hc/en-us/articles/7624854163863-How-to-Embed-a-Form-in-an-Elvanto-Page-or-Post)
- [Add a page to the Member Area](https://help.elvanto.com/hc/en-us/articles/7624845651863-How-to-add-a-Page-to-the-Member-Area)
- [Customize the Member Area menu](https://help.elvanto.com/hc/en-us/articles/22901872246935-How-to-Customize-Your-Menu)

## 20. Additional scheduling, check-in, and directory functions (official Help Center)

### Volunteer scheduling and service plans

- [ ] Volunteers can enter date/time unavailability in Member Area or mobile app; delete future unavailability by selecting rows and using mass manage. Scheduling Preferences let volunteers state desired frequency (for example weekly or twice per month); auto-scheduling avoids unavailable ranges.
- [ ] Departments organize teams hierarchically with sub-departments and volunteer positions. Service Types define typical time/recurrence, run sheet, and required volunteer positions.
- [ ] Service plans contain items, headings, songs, duration/time, descriptions, department/position notes, files, and comments. Drag/drop reorder updates start times. Timed elements can be hidden from live and printed plans while adjusting subsequent times; series title and section headings can be set.
- [ ] A Service Type plan template can be applied to future services, replacing their existing plan items. Service plans can be printed/exported as PDF with selected print options.
- [ ] Member roster view can show upcoming only or include past services, assigned role, rehearsal/soundcheck times, family roster if enabled, ordered songs, song PDFs/downloads, service files, and (for admins) Edit Service.

### Check-in

- [ ] Check-in can operate without label printing. Settings include label printing/design, security/session codes, print station names, and maximum label count on self-check-in.
- [ ] Check-in types include admin-assisted, self check-in, and barcode quick check-in; track people arriving and leaving across children, adults, and volunteers.
- [ ] Search can use name, phone number, or security code. Family or individual security codes support barcode lookup; fixed codes may generate new random session codes per check-in, printed on screen/labels for secure pickup. Family-code quick check-in can check family in/out together.
- [ ] Custom labels can include parent contact details, allergies, medical requirements, and custom fields. Barcode scanners and label printers are supported.
- [ ] Rooms can be assigned through demographic progression; date of birth/grade and family relationship Child drive room age/grade placement. Admin can choose service time and room; attendance and room/absence reports can cover date ranges.
- [ ] Security codes can allow shared family codes, manual assignment at first check-in, custom length/characters, and CSV import through People Import.

### Member directory and profile privacy

- [ ] Directory settings choose which people categories/demographics appear; can limit visibility to members/families connected through a viewer's departments/groups.
- [ ] Directory display modes: individual, family, or both; default view; individual first-name/last-name sort; preferred-name display; family address display; configurable list columns and profile layout fields.
- [ ] Exclusions can hide specific people (for example children/vulnerable people); Always Include can force designated contacts/leaders to appear despite normal lockdowns/category/demographic/privacy rules.
- [ ] Newly created people can be automatically listed for selected categories. Optional opt-in sends an email request; only active users can appear, and moving an existing person into a category does not trigger auto-add.
- [ ] Individuals or admins can set per-profile field privacy for directory display through My Profile/Privacy Settings or the admin profile.
- [ ] Users can update permitted personal details and their own profile photo. Family photos cannot be uploaded by another family member; photos are internal unless included in a published directory.

### Sources

- [Availability and scheduling preferences](https://help.elvanto.com/hc/en-us/articles/7659762692887-How-to-Update-Your-Availability-and-Scheduling-Preferences)
- [Volunteer scheduling setup](https://help.elvanto.com/hc/en-us/articles/7702188843671-Setting-Up-Overview-of-Volunteer-Scheduling-in-Elvanto)
- [Create a service plan](https://help.elvanto.com/hc/en-us/articles/7600599413783-Creating-a-Service-Plan)
- [View my roster](https://help.elvanto.com/hc/en-us/articles/19365320143127-How-to-View-My-Schedule-Roster)
- [Check-in system setup](https://help.elvanto.com/hc/en-us/articles/7621913331991-Getting-started-with-the-Check-in-System)
- [Check-in overview](https://help.elvanto.com/hc/en-us/articles/7482180476439-Check-In-Overview)
- [Security codes](https://help.elvanto.com/hc/en-us/articles/7582115422743-Security-Codes-and-Check-Ins)
- [Check people into a service](https://help.elvanto.com/hc/en-us/articles/7622014287255-How-to-Check-People-into-a-Service)
- [Import security codes](https://help.elvanto.com/hc/en-us/articles/26281991363991-How-to-Add-and-Import-Security-Codes-for-Profiles-in-Elvanto)
- [Member directory setup](https://help.elvanto.com/hc/en-us/articles/7626834109591-Setting-up-the-Member-Directory)
- [Hide directory profile fields](https://help.elvanto.com/hc/en-us/articles/7626875687191-How-to-Hide-Specific-Fields-Within-an-Individual-s-Member-Directory-Profile)
- [Update profile/photo](https://help.elvanto.com/hc/en-us/articles/7626778904343-Update-Your-Profile-and-Photo-in-Elvanto)

## 21. Reporting, songs, and transaction-entry details (official Help Center)

### Reports

- [ ] Report types: built-in/preconfigured, standard/custom, comprehensive (combines multiple reports). Reports can be organized by category and favorited.
- [ ] Standard reports can target individuals or families, optionally act as a People View, name/describe the report, define criteria using match any/match all/custom logic, add multiple criteria, select display fields separately for reports and People Views, and sort at two levels.
- [ ] Advanced report/view logic numbers criteria and supports parenthesized AND/OR expressions; NOT/NOR/XOR/NAND are unsupported.
- [ ] Standard reports export CSV/PDF (Help Center also describes Excel export); comprehensive reports export PDF only. Reports can be duplicated, privately shared with named people, and permissions can limit a recipient to view/export.
- [ ] Scheduled report emails support weekly, biweekly, monthly, every 3 months, every 6 months, or yearly; start date, approximate send time, recipients, and optional plain-text message. Built-in reports accept report-specific filters/columns, preview, export, share, and edit. Super Admins can inspect scheduled report emails. Email recipients gain access to that report even if it is private.

### Songs and SongSelect

- [ ] Song creation accepts SongSelect suggestions by title or CCLI number; imported metadata can include CCLI number, artist, album. Songs can have multiple arrangements, location assignment, music-team notes, and custom chord charts.
- [ ] SongSelect can import lyrics and key, assign category/location lockdown/arrangement, import chord charts as attached PDF files, and refresh lyrics on existing songs. Chord charts cannot become editable native Elvanto charts due to SongSelect API limits.
- [ ] Song categories organize the library; SongSelect integration supports CCLI reporting for copies of songs, videos, and other media.

### Financial transaction entry

- [ ] Transaction can be created from Transactions or a Batch; choose new/existing batch, date, link to existing person/add a new person/no person, payment method, amount, account, optional memo, tax-deductible status, then Save or Save & Add Another.
- [ ] Additional payment methods can be entered through Other but cannot be edited or removed.
- [ ] Financial area tracks batches, transactions, pledges, account/subaccount categories, giving reports, and pledge fulfillment; it is not accounting/payroll software.

### Sources

- [Reports overview](https://help.elvanto.com/hc/en-us/articles/7581235744919-Reports)
- [Use reports](https://help.elvanto.com/hc/en-us/articles/7622122691479-How-to-use-Reports)
- [Create a standard report](https://help.elvanto.com/hc/en-us/articles/7622210129943-How-to-Create-a-Standard-Report)
- [Advanced report filter logic](https://help.elvanto.com/hc/en-us/articles/7622293867031-How-to-set-up-Advanced-Filter-Logic-for-Reports-and-People-Views)
- [Automatically email reports](https://help.elvanto.com/hc/en-us/articles/7622335970839-How-to-Automatically-Email-Reports)
- [Share custom reports](https://help.elvanto.com/hc/en-us/articles/7622315223319-How-to-Share-Custom-Reports)
- [Songs overview](https://help.elvanto.com/hc/en-us/articles/7482124161943-Songs-Overview)
- [Add a song](https://help.elvanto.com/hc/en-us/articles/7607495824535-How-to-Add-a-Song-in-Elvanto)
- [Import SongSelect chord charts](https://help.elvanto.com/hc/en-us/articles/7608017260951-How-to-Import-Chord-Charts-from-SongSelect)
- [Financial overview](https://help.elvanto.com/hc/en-us/articles/7482278722199-Financial-Section-Overview)
- [Add a transaction](https://help.elvanto.com/hc/en-us/articles/7623887992343-How-to-Add-a-Transaction)

## 22. Advanced People Search — directly observed in demo

- [ ] Criteria matching can use All of the following fields, Any of the following fields, or Advanced: Create your own filter logic. Multiple criteria can be added/removed.
- [ ] Date Added operators shown include Equals, Does Not Equal, Is After, Is Before, Is In The Last, Is Not In The Last, Is Between, Is In The Next, Is Not In The Next.
- [ ] Searchable criteria families visible: Person Details (date added, names, category, archived/contact/deceased, gender, birth date/month, age, marital status, anniversary/month, notes, member directory); Contact Details (email, email preferences, phone, mobile, SMS preferences); Assets (access permissions); departments/department leader positions, demographics, locations, service types; Groups (membership, status, category, department, demographic, location); People Flows and People Flow Steps; account (volunteer, status, username, last login); address; Family (members, relationship, parents/parent with children, children filtered by gender/demographic/location/group/school grade); Children (school grade, development child, special needs child, security code); Attendance (attended/did not attend a service or group); Financial (receipt name, giving number, transaction amount); and custom fields.
- [ ] Available result columns can be searched and added/removed; observed field groups include person/contact/department/demographic/location/group/account/address/family/children/financial/custom fields. This account's custom examples included Allergies, Background Check Expiration/Number, Baptism Date, and a field named foo1.
- [ ] Default result columns in this demo were Photo, Full Name, Email Address, Mobile Number, Phone Number, People Category, and Locations. Fields can be reordered; primary sort supports a selected column and ascending/descending, with a second sort column/direction.
- [ ] Search submits the selected criteria to results; advanced search page has a search-field control for available result columns and a Search button.

### Source

- [Public Elvanto demo — People Advanced Search](https://demo.elvanto.com/admin/people/advanced_search/?from_new=1)

## 23. People Map and People Flows — directly observed in demo

### People Map

- [ ] People Map renders a Google map with clustered person markers (65 shown in this demo view), zoom in/out, map camera controls, keyboard shortcuts, fullscreen toggle, and open-current-area-in-Google-Maps link.
- [ ] Map filter panel exposes People Categories, Demographics, Locations, and Departments; includes filter search, Clear, Cancel, Save, and shows whether filters are applied.

### People Flows index and flow detail

- [ ] Flows page has Add Flow and filters (Active shown; 7 sample records); each record has Edit and an additional action menu.
- [ ] Flow detail has Steps and Edit tabs, Print, Add Step, step-level Edit/action menu. Steps can be dragged to reorder and nested by dragging left/right.
- [ ] Step cards link to the step's people and status buckets (Unassigned, Not Started, Completed shown), display whether notifications are On/Off and due delay (examples 3 days/30 days later).
- [ ] Example flow uses email, phone-call, and outcome steps (Connected/Not Connected); status counts are displayed on each step.

### Flow step people and assignments

- [ ] Step people page has views Due Now, Assigned to You, Unassigned, Not Started, Pending, In Progress, Completed, All People; choose step and view, Add Person, Contact, Edit, sort, page-size selection, and bulk controls.
- [ ] People rows show step status, due date, assignee; unassigned rows offer Accept This Person, assigned rows can be removed. Person/assignment detail provides previous/next navigation.
- [ ] Assignment actions include View profile, Reassign, Complete Step, Change due date, Change status, Remove from this Step, Add to another People Flow; an assignment can also be contacted.
- [ ] Assignment detail displays flow/step instructions, person contact fields/location/demographic/address, current status/due date/assignee, and a Notes panel with Write Note, All Notes, and Filter. It also provides Flows Add, Groups Add, and Family Edit controls.
- [ ] Inspection remained read-only; no people were reassigned, completed, removed, or edited.

### Sources

- [People Map in the public demo](https://demo.elvanto.com/admin/people/map)
- [People Flows in the public demo](https://demo.elvanto.com/admin/people/flows/)
- [Flow step assignment in the public demo](https://demo.elvanto.com/admin/people/flow_step_person/?id=4e52a902-8b31-40b6-acea-462f1c54b69c)

## 24. People Categories and profile layouts — directly observed in demo

- [ ] Categories index has Add Category, Sort, and per-category counts for Active, Contacts, Archived, Total; records include a My Profile Layout control and additional action menu.
- [ ] Category detail offers View People, Copy Layout, Duplicate Layout, Edit, and My Profile Layout.
- [ ] Category Details include editable name and optional highlight color (hex value).
- [ ] Category profile layout editor explains that its fields are shown when editing a person assigned to the category. It supports draggable sections/fields, section labels, field edit/delete controls, searching available fields, and controls to add field types from a palette.
- [ ] Sample Congregation / Members layout included Personal Information, contact details, gender/date of birth, custom Allergies, School Grade, Marital Status, Anniversary, Receipt Name, Giving Number, Security Code, Baptism Date, Access Permissions, Home Address, and Mailing Address; rows and sections can be reordered/edited/removed.
- [ ] Demo category list showed counts: Congregation / Members (251 active, 0 contacts, 12 archived, 263 total), Visitors / New People (12 active, 0 contacts, 0 archived, 12 total), Community Contacts (5 active, 6 contacts, 7 archived, 18 total). These are sample data.

### Source

- [People Categories in the public demo](https://demo.elvanto.com/admin/people/categories/)
- [Sample People Category layout in the public demo](https://demo.elvanto.com/admin/people/category/?id=34bc35a8-f828-11e4-bd65-06e37142e2e1)

## 25. Duplicate review — directly observed in demo

- [ ] Duplicates page provides name search, Filter, page size (20 shown), Export, and Table/List view toggle; page shows detected records and date/email/phone/mobile columns.
- [ ] A separate View 'Not Duplicates' List is available.
- [ ] Each duplicate record offers Merge with duplicates and a secondary action menu; table rows also expose Activity, Notes, Family, and Account & Volunteering shortcuts.
- [ ] List view shows record photo, people category, date added, email, phone, mobile, and Merge with duplicates action.
- [ ] No merge or Not a Duplicate action was executed.

### Source

- [Duplicates in the public demo](https://demo.elvanto.com/admin/people/are_duplicates#v:duplicates)

## 26. People Import page — directly observed in demo

- [ ] People > Import page has guidance links for preparing/importing, a file chooser, import Type radio options People or Notes, Date Format dropdown (dd/mm/yyyy or mm/dd/yyyy), and Continue.
- [ ] Demo explicitly states records cannot be imported into the demo account; it offers an optional sample-file exploration path. No file was uploaded and no import was started.

### Source

- [People Import page in the public demo](https://demo.elvanto.com/admin/people/import/)


## Group Leader role — group detail workflows observed in demo

This inspection used the demo's Group Leader persona (Andrew) after logout and role selection. It is role-specific demo evidence, not a complete permissions matrix. The navigation available in this role was Dashboard, People, Groups, Services, Songs, Reports, Events, Calendar, Forms, Files, and Member Area; Check-in, Needs, Financial, Emails, Posts, Pages, and Links were not present in this role's menu.

### Group detail and edit
- Group list was limited to two visible groups in this role (demo sample/permissions); group list includes All Groups, Active filter, Contact Groups, search, table/list switch, and columns Name, Categories, Locations, Meets, Started, Address, Members. Rows offer detail, Edit, Activity, Notes, Reporting.
- Group detail shows Submit Report, Contact, Add People, image Edit, Previous/Next group navigation, meeting details/map, Print Checklist, Leaders with Leader buttons, upcoming Events and Add, and People/Edit/Activity/Notes/Reporting/Join Requests tabs.
- People tab shows members with selection checkboxes; name, position, email, phone, mobile columns; row shortcuts Activity, Notes, Family, Account; list/table toggle and page-size selector. The demo displayed five people plus Gender/Marital Status and Ages charts. Opening a person profile from this role yielded a permission error.
- Group Edit exposes name, Active/Archived status, rich-text description (bold/italic, alignment, numbered/bulleted lists, indent, block quote, links, image, font size/name, text color, underline, strikethrough, table, special character, paste/plain text, remove formatting, spell-check, maximize, source); category checkboxes; searchable departments, demographics and locations.
- Meeting Details include street address, city, state, zip, country, digital meeting link, start date, start/end times, frequency (weekly/monthly), interval, weekday, optional end date.
- Group Finder options include Open/Closed status and member-count limit (0 means unlimited). Save is available; no edits were submitted.
- Group activity history is chronological and logs member add/remove, group name/status changes, meeting date/time/address changes, and position changes with timestamps and actor.
- Group Notes has Write Note, All Notes, Filter, and a chronological feed showing author, timestamp, note text, and per-note overflow actions.
- Group Reporting shows 409 records in this sample, period selector (Last 3 months shown), and columns Report Date, People in Group, Members, Guests, Absent, Total Attendance. The page displayed a notice that no attendance fell within the selected period while showing historical records.
- Join Requests has a Pending Requests section with applicant name, free-text reason, email, phone, and optional Family or Friends names/contact details. Each applicant/family request has Accept Request and Decline Request actions. No requests were accepted or declined.
- Submit Report opens a Group Report modal with Date Met and Time Met, Group did not meet checkbox, Service(s), Group Members section, Guests in Attendance count, Notes Specific to the Entire Group, Private Note checkbox, Categories selector, Cancel and Submit. No report was submitted.

Source: [Group detail in the public demo](https://demo.elvanto.com/admin/groups/group/?id=58dbfe01-05bd-11e5-bd65-06e37142e2e1).

### Demo permission boundary
- In the Group Leader role, opening member profiles returned “You do not have permission to perform this action.” Account settings pages and event detail failures previously recorded remain separate observed access/runtime limitations; they do not establish that the underlying product lacks those features.



## Group-level contact and membership actions — directly observed in Group Leader role

- Contact [group name] opens a composer offering Send Email or SMS and Send a Letter tabs. Email/SMS mode offers Both Email & SMS, Email Only, and SMS Only choices; Cancel and Send controls are visible. No communication was sent. The demo remained in a loading state while this panel was open, so the body/recipient configuration steps were not verified.
- Add People opens a compact panel explaining that names can be entered one after another, with a Name field, Add People button, and Close control. No person was entered or added.
- Source: [Group detail in public demo](https://demo.elvanto.com/admin/groups/group/?id=58dbfe01-05bd-11e5-bd65-06e37142e2e1).



## Services — list, detail, plan, volunteers, reporting observed in demo

### Service index
- Services page has Add, Edit Multiple, search, saved-view selector, Filter (Published shown), page-size selector, Table/List toggle, and paginated results.
- Upcoming Services was the selected view. Rows show Name, Date & Time, Location, Service Type; each service exposes detail, Plan, Volunteers, Reporting, Live, Print shortcuts.
- Demo showed six upcoming Sunday Morning services at Central Campus, dated weekly from 22 November through 27 December 2026. Sample data only.

### Service detail and editing
- Service detail actions: Contact Volunteers, Print, LIVE, previous/next service, Duplicate Service.
- Summary shows Published, Name, Type, Location, Date, Time, Created timestamp/creator, Teams, Volunteers, Songs, Files, Notes. Section-level Add/Edit actions are present.
- Edit form includes Name, Date, Location, Service Type, rich-text description editor; service time rows with editable name/start/end and add/remove; Other Times with name, type (Rehearsal or Other), start/end, relation (Same Day, Days Before/After Service), add/remove; printable-plan logo upload; and department/position selection to highlight at the top of the printed plan. Save is present; no edits/uploads were made.
- Service Type help text explains typical time/recurrence, run sheet, and required volunteer positions; details appear selected via Type field.

### Service Plan
- Plan controls: Add Item, Add Song, Add Heading, overall plan title field, times/duration summary, drag handles for reordering, delete controls.
- Entries show planned start time and duration; items can link to Comments, Notes, Attachments. Observed sample sections included Praise & Worship, individual songs, MC, Welcome, Announcements, Offering, Preach, Message, Altar Call, Close, and Farewell. Current plan total displayed 75 minutes (9:30–10:45).
- Plan section mirrors service detail summary and has Print, LIVE, Duplicate Service, previous/next navigation. No item was added/deleted/reordered.

### Volunteer assignment view
- Controls include Volunteer (Add a Volunteer), Team (Add a Team), Auto (Auto-schedule Volunteers), Contact links per department/team.
- Department hierarchy and required-position rows are displayed; plus controls are present to assign volunteers, and vacancies show counts such as “2 volunteers needed.” Observed departments include Worship Team (Instruments, Vocals, Production, Stage), Hosting Team (Ushers, Hospitality Team), Set Up & Tear Down Team (Set Up Team). No volunteer/team was assigned and Auto was not run.
- Summary sections provide Edit Volunteers, Songs, Files, Notes. Contact Volunteers is available in the header.

### Service Reporting
- A time tab (9:30) shows built-in statistics that update from individual attendance and says reporting values can be edited in Service Settings.
- Custom Statistics are grouped by headings (Kids Church Information; Pastoral Care information) and expose per-stat Edit buttons. Sample fields: information for kids church, number of incidents, verses read, dedications, baptisms.
- Built-in Statistics include total individuals, families, adults, children, guests (editable), counts by People Category and Demographic.
- Individual Attendance provides Print Offline Checklist, Mass Add People, search/add person instructions, and attendance list. Empty in the selected sample service. No attendance was added.

Source: [Sunday Morning service in the public demo](https://demo.elvanto.com/admin/services/service/?id=9b0cdfeb-c071-4f92-a0d8-904623f67650).



## Reports and Songs — additional directly observed demo pages

### Reports index and report types
- Reports navigation includes Add Standard Report and Add Comprehensive Report. Search, report-view selector, page size, table/list toggle, and result count are available.
- Report views displayed in the selector: Custom Reports, All Reports, Standard Reports, Comprehensive Reports, Snapshots, Built-in Reports, People, Groups, Services, Favorite Reports, and Categories.
- Report rows show name, category, description, created/modified timestamps and actors; actions include Edit, Email, Duplicate, Export, and favorite marker.
- Sample showed 13 custom reports and 11 standard reports. Sample names included Background Checks Expires Soon, Expiring in the Next 3 Months, Expired or Invalid Background Checks, People Not in a Group, Service Attendance (Comprehensive), Upcoming Anniversaries, and Upcoming Birthdays. Sample data only.

### Song library and song details
- Songs index has Add Song, CCLI Reporting, search, Published filter, page size, List/Table switch, pagination; rows include Name, Arrangements, Artist, Album.
- Song detail has Member Area preview link, previous/next, Arrangements Add, Files Add, Schedule with prior scheduled service date/time/location links, and fields Name, CCLI Number, Artist, Album, Published/Archived status, Type Song/Item, Song To Learn, Allow Downloads, Categories, Locations, volunteer notes rich-text editor, Save.
- Arrangement detail has tabs Edit, Keys & Charts, Lyrics & Chords, Files. Details include name, length minutes/seconds, BPM, meter numerator/denominator, copyright text, male/female key plus Major/Minor mode; a configurable sequence of sections (Verse, Chorus, Bridge, Pre-Chorus, Instrumental, Intro, Outro, Vamp, Tag, Breakdown, Misc) with numbered occurrence and add/remove/reorder controls; arrangement notes and file attachments.
- Keys & Charts shows Add Key, a table of keys and chord charts with Download and remove controls.
- Lyrics & Chords provides Original Key and mode, Download Lyrics, allow-PDF-download toggle, page orientation, columns, chord color, text size/font, lyrics/chord editor, preview, transpose-to-key control, Save.
- Arrangement Files provides Add File and rows with Name, Type (Chart shown), remove control.
- No song, arrangement, lyric, chord chart, or file was changed.

Sources: [Reports in the public demo](https://demo.elvanto.com/admin/reports/#v:all), [Songs in the public demo](https://demo.elvanto.com/admin/songs/#v:all), [Song arrangement in the public demo](https://demo.elvanto.com/admin/songs/song_arrangement/?id=1a8557c1-03fe-11e5-bd65-06e37142e2e1&edit=1a862445-03fe-11e5-bd65-06e37142e2e1).



## Forms, Files, Calendar subscriptions, and Member Area — additional directly observed demo pages

### Calendar subscription options
- The Admin Calendar Subscribe dialog lists account calendars (Church Calendar and Labrador) with separate iCal/Outlook and Google Calendar subscription links.
- It also lists built-in calendar feeds for People Notes, Group Notes, Services, and Groups, each with iCal/Outlook and Google Calendar options. This is a feed/subscription chooser; no subscription was initiated.
- Calendar filter and display controls are documented in the earlier Calendar section.

### Forms library and form configuration
- Forms index exposes Create Form, search, saved view chooser (All Forms observed), filters for Published, Unpublished, Standard, and Event Registration, page size, table/list switch, pagination, and rows with Edit, Duplicate, and View actions.
- Form detail exposes View, Export, Embed, Submissions, and Edit.
- Form editor details observed without changing or saving:
  - Name; status Published/Unpublished/Archived; category; multi-person submissions; pre-fill logged-in user's visible profile data.
  - Event Attendance option for basic event registrations without tickets; full event ticket/payment registrations are directed to a Registration Form.
  - Layout editor with drag/reorder fields, adding rows, headings, People Fields, People Custom Fields, Form Custom Fields, and Event Attendance Fields. Existing form preview presents configured labels and helper copy.
  - Add Another Person custom button label; submission limit; database behavior (do not add/update, add/update, or add/update after admin approval); handling blank form fields (delete or preserve existing data); make new people contacts; post-submit actions; default/custom success message or redirect; named form admins and email notification on new submissions.
  - Form styles include preview, default/preset colors and custom style; custom header toggle.
- Form submissions view exposes Contact People, filters for Approved and Action Pending, page size, table/list switch, pagination; rows show submitter/linked-person summary and submitted date. The sample included action-pending and linked-person indicators; personal sample names omitted here. No contact, export, submission approval, or submission was performed.
- Sample form names/statuses in the demo included background-check, contact-card, group-sign-up, volunteer-interest, communication-preference and event-registration forms. Names only identify sample records, not a claim that the demo fully exercises every form configuration.

### Files library and access controls
- Files index shows Add File, Getting Started with Files help, search, view chooser (All Files observed), Published filter, Usage/storage meter, page size, table/list switch, pagination, and columns for file name, date/creator, file size/versions, total size, and file access. Rows expose Open File and Versions controls.
- Add File workflow observed without upload or save:
  - Upload up to 50 files at a time by drop or file chooser; displayed maximum size 40 MB.
  - Details include Published/Draft status, Notes, Expires On, and Folder (sample folders Audio Files and Pictures).
  - Access choices: only specified people; people assigned to selected Lockdown areas; members and guests; members only; or guests only.
  - Lockdown targeting can include departments/teams, locations, demographics, groups, and access permissions. The interface explains that leaving lockdown selections empty makes a file accessible to anyone who has its link.
- Usage displayed 0/10 GB (0%) and sample records showed file versions and access labels; values are demo/account configuration only. No file was uploaded, opened, edited, or deleted.

### Member Area home and navigation
- Member Area navigation observed: Home, Roster, Group Finder, My Groups, My Giving, Calendar, Member Directory, Links, Unavailability, and Get Help, with an Admin Area route back.
- Home shows posts/announcements with author/date/category and rich text, link items, upcoming events and a View Full Calendar action.
- Roster shows Subscribe, a list of upcoming services, selected service's Edit, Volunteers, and Plan actions, service date/time/location and any Other Times such as rehearsal. The sample selected service showed no assigned volunteers; sample only.
- Group Finder lists groups with meeting-location summaries, filters, page-size controls, pagination, and group cards. No join request was submitted.
- My Groups presents the signed-in member profile area with sections/tabs for Profile Picture, Privacy Settings, Giving, Family, Groups, Communication Preferences, Volunteering, Roster, Unavailability, Social Login (Google link shown), Security, and Two Factor Authentication; group membership is listed. No profile settings were changed and no social account linked.
- My Giving displays the signed-in member's giving-record area (empty for the demo account). No financial records were changed.
- Member Calendar offers Subscribe, View Admin Calendar, Today, Day/Week/Month, previous/next navigation and a weekly time-grid with group/service entries.
- Member Directory offers search, View Families, List switch, page size, previous/next pagination and family cards. Sample personal names and addresses are omitted from this inventory.
- Unavailability offers a request form with start/end dates, time choice (all-day or time of day), repeat options (do not repeat, daily, weekly, monthly by day/week, yearly), location, reason, Add, and Submit, plus a display area for existing entries. No request was entered or submitted.
- Get Help is an informational page that directs demo users to contact the team; it does not expose product administration.

### Demo boundaries and confidence
- These details are direct observations from the public Elvanto demo using the Group Leader / member-facing account. Controls requiring higher permissions, account-specific integrations, external links, or submission were not activated. Buttons seen in the UI document exposed actions, not proof of every downstream outcome.
- All data values, names, counts, folders, locations, and examples above are sample or account-specific. This inventory remains a broad function checklist, not a guarantee of undocumented internals or of features disabled in this demo.

Sources: [Calendar in the public demo](https://demo.elvanto.com/admin/calendar/), [Forms in the public demo](https://demo.elvanto.com/admin/forms/), [Files in the public demo](https://demo.elvanto.com/admin/files/), [Member Area in the public demo](https://demo.elvanto.com/).



## Super Admin modules and admin-only workflows — directly observed in Chrome demo

The public demo provides a role selector with Super Admin, Group Leader, and Member / Volunteer personas. Super Admin expanded the admin navigation to Dashboard, People, Groups, Services, Songs, Check-in, Needs, Reports, Events, Calendar, Forms, Financial, Emails & Letters, Files, Posts, Pages, Links, and Member Area. The top-bar Settings route is separate. This is observed navigation for the sample account, not a full permission matrix.

### Dashboard
- Dashboard offers Edit Dashboard and widget areas for notifications, upcoming roster, attendance summaries, upcoming events, people categories, quick service statistics, comments, profile greeting, and songs to learn. Widget contents depend on selected date range and sample-account activity.
- Notifications can be filtered and showed pending group join requests. No notification or request was actioned.
- A welcome video overlay can be closed. Dashboard editing controls were not saved.

### Check-in
- Check-in main page exposes Add Person or Family, Self Check-In, Start Print Station, Settings, and Print Test Label.
- Current check-in scope options: Children Only, Volunteers Only, All People; option to include archived records; label printer software choices Account Default, DYMO Label App, Dymo Connect.
- Upcoming Services and Check-in Activity panels; Rooms list and Edit route (sample rooms included Nursery, Younger Kids, Main Auditorium, Surfside Hall, No Room).
- People lookup supports Search by Name, Filter, and A–Z last-name quick navigation. No person was checked in.
- The demo showed a Print Station chooser stating there was no physical label printer attached, offering default room print station and named stations; no station was selected or confirmed. This device constraint blocked further print-station verification.

### Needs
- Needs index exposes Add, view/filter controls, page-size selector and pagination. Need cards show need title, type, due date, location, status, and assigned member.
- Add New Need fields: Need Name; Type (sample choices Sunday Service Pickup & Drop-off, Catering Request, Home Repairs, Other type); rich-text Description; Due Date; Location (named locations or Any); Status; Assigned Member; Save/Cancel.
- No need was created or edited. Sample need titles and people names are omitted from this inventory.

### Emails & Letters and templates
- Email template library exposes Add Standard Template and Add Design Template, search, Active filter, sort, page size and pagination. Rows distinguish Standard Email Format and Design Email Format and provide Duplicate.
- Standard email/letter template editor has Name, Active/Inactive status, sender choices (admin account address, sender's own email, or custom address), Subject & Message editor, test email and test letter actions, letter formatting and margins, placeholder/field insertion, file insertion/attachment, and Lockdown controls.
- Lockdown can target departments, locations, demographics, groups, and Access Permissions; no selection means the template is available to users permitted to send email/letters. No test message was sent, file inserted, template edited, or duplicate created.

### Posts
- Posts index has Add Post, search, All Posts view, Published filter, page-size selector, list/table switch, pagination; table columns Title, Author, Categories, Comments, Date.
- Add Post fields: Title and rich-text Content, editable Permalink, insert/attach files, Publish On date/time (blank publishes immediately), Published/Draft status, Categories, Author, Tags, Allow comments, Expires On, and lockdowns by department, location, demographic, group, and access permission. No post was saved.

### Pages
- Pages index has Add Page, help/onboarding links, search, Published filter, page-size selector, list/table switch and pagination. Table includes Title, Author, Access, Location.
- Add Page fields include Title and rich-text content, Permalink, file insertion/attachment, Published/Draft status, Page Location choices (show in Member Area navigation or on Member Area home page), Expires On and the same lockdown target families (departments, locations, demographics, groups, access permissions). No page was saved.

### Member Area Links
- Links index has Add Link, search, Published filter, sort, and records with URL, Categories, Delete.
- Add Link fields: Name, Published/Hidden status, URL and Categories. Help text says the link appears in the Member Area Links dropdown; no category places it directly in that menu rather than under a category. No link was saved or deleted.

### Settings index and limits
- Settings index groups pages under General, Customization, Features, Layout, and Developers:
  - General: Account; Legal & Compliance; Communication; Occasion Messages; Sending Domains; Scheduled Email & SMS; Super Admins; Access Permissions; Passwords & Security.
  - Customization: Formatting; Built-in Contact Templates; Layouts; Sidebars.
  - Features: People; Groups; Group Finder; Services; Volunteers; Roster; Songs; Check-in; Label Printing; Styles; Events; Calendar; Financial; Giving Statement Templates; Posts; Member Directory; Layout.
  - Layout: Departments; Demographics; Locations; Assets; Asset Categories; Note Categories; Needs; Need Types.
  - Developers: Integrations.
- The index includes short descriptions (for example, account location/language, legal requirements, exports/printing/labels, default people fields, volunteer settings/notifications, check-in labels/security, calendar/event settings, giving statements, and integrations).
- Opening the Account settings page returned “You do not have access to this item” even when the demo role selector displayed Super Admin. Therefore the settings index is directly observed; deeper setting pages were not verified in this account. This reinforces the scope limit; it does not establish that Super Admins in paid accounts lack access.

### Financial
- Super Admin menu exposes Financial and a Batches view with Add Batch, Add Transaction, Add Pledge, Search, View, Filter, totals, list/table switch and pagination. Earlier batch/transaction details are recorded above.
- No new financial record was added and no existing financial record was changed during this additional pass.

Sources: [Check-in in the public demo](https://demo.elvanto.com/admin/checkin/), [Needs in the public demo](https://demo.elvanto.com/admin/needs/), [Emails & Letters in the public demo](https://demo.elvanto.com/admin/emails/), [Posts in the public demo](https://demo.elvanto.com/admin/posts/), [Pages in the public demo](https://demo.elvanto.com/admin/pages/), [Links in the public demo](https://demo.elvanto.com/admin/links/), [Settings in the public demo](https://demo.elvanto.com/admin/settings/), [Financial in the public demo](https://demo.elvanto.com/admin/financial/).



## Additional directly observed Settings workflows

### Check-in Room setup
- Rooms index is reachable from Check-in > Rooms. It offers Add Room and sorting; cards show room name, capacity (or unlimited), demographics, locations, and View Check-ins.
- Room detail fields: Name, Active/Inactive, check-in capacity (0 means unlimited), label Print Station, Locations, Demographics, and Service Types. Help text says demographics automatically link people in that demographic to the room. Save is available; no room was changed.
- The public demo had rooms Nursery, Younger Kids, Main Auditorium, and Surfside Hall. These are sample values.
- Source: [Check-in rooms in the public demo](https://demo.elvanto.com/admin/checkin/rooms/).

### Check-in settings
- General Check-in settings expose default check-in scope (Children Only, Volunteers Only, All People), show/hide People Categories during check-in, optional default parent SMS text for child check-in with child-name/security-code/room placeholders, and security-code policy.
- Security code options: unique per family member or allow shared family code; random first-time code, random code each session, or manually entered code; length, allowed letters/numbers, start/end characters; enable/disable random session codes.
- Self Check-in settings: searchable Phone Number, Last Name, Security Code; hide/display security codes; idle timeout duration; enable/disable Check-in All; enable/disable Check-out.
- Label Printing settings: DYMO Label Software or DYMO Connect; per-mode automatic label printing at Finish vs manual per-person printing; parent labels disabled/printed for each child/one per family; parent-label rules for Volunteers Only and All People; label sizes (address, large address, shipping, medium, name badge); live preview and draggable available fields for child/parent/adult labels; separate logos by check-in mode; self-check-in print-all toggle and per-person label limit; label print-station configuration and overall printing disable. No settings or labels were modified/printed.
- Styles page exposes Add Style; the demo account showed no styles. No style was added.
- Sources: [Check-in settings](https://demo.elvanto.com/admin/settings/checkin/), [Label Printing](https://demo.elvanto.com/admin/settings/checkin/label-printing/), [Check-in Styles](https://demo.elvanto.com/admin/settings/checkin/styles/).

### Needs settings and need types
- Need Types settings contains Need Types and Reminders sections; Add a Need Type; a table with name/description; and Needs Reminder Settings with Send Email Reminders toggle and Save. No setting was changed.
- Source: [Need Types in the public demo](https://demo.elvanto.com/admin/settings/needs/types/).

### People settings — directly observed fields
- Default Settings: default People Category for new accounts; default address state/country.
- Name formatting: display First Name, full name with preferred name, preferred name alone, or preferred plus first name; email/SMS placeholder display choice; first-name/last-name ordering; legal-name formatting; middle-name initial; whether members may remove birth/anniversary years in My Profile.
- People Flows: hide/show completed flows in member sidebar.
- Registration & Access: allow/disable guest account registration; assign new users to an Access Permission; require Locations/Departments selections; allow/disable guest access to posts/pages; registration and unsubscribe notification addresses; scheduled-note email notifications.
- Search/viewing: include/exclude archived people from global search; choose default display fields across person/contact/assets/access/department/demographic/group/account/address/family/children/security/financial/custom-field groupings.
- Family: designate administrators to approve adding a family member who may already exist (optionally by location); define Family Contact Details contents; default whether category updates cascade to family; restrict adding/editing family details in My Profile.
- School Grades & Demographics: edit grade labels, set annual grade advancement date, disable demographic progression on adding/editing people; check-in always applies demographic progression according to the text.
- Archiving People: choose whether a reason is required and provide predefined reasons.
- This settings page was inspected read-only; no account defaults, notification recipients, access rules or family/grade settings were altered.
- Source: [People settings in the public demo](https://demo.elvanto.com/admin/settings/people).

### Design Email Template gallery
- Add Design Template opens a gallery with Blank / Start blank and reusable layout choices (newsletters, announcements, event promotions, galleries, grids, multi-column and weekly-summary styles). Each template provides Preview; selecting a preview presents Back and Next. The workflow was not advanced to the editor and no design template was created.
- Source: [Design template gallery in the public demo](https://demo.elvanto.com/admin/emails/templates).



## Further official Help Center functions confirmed during completeness cross-check

The following are official Help Center descriptions, not direct demo observations. They extend areas where the demo’s account, permission, or device limits left downstream behavior unverified.

### Events: invitations, ticketing, attendance
- Events can have descriptions, address/map, linked assets, recurrence, calendar assignment, and public/private visibility. Private events are visible on the calendar only to the organizer and invited guests.
- Event guest lists can include people, groups, or People Views. Organizers can send invitations by email (and SMS where provider integration is configured); guests can respond. Contact Guests supports later follow-up.
- Ticket registration supports multiple ticket types with price/free status, per-ticket and overall limits, descriptions and availability dates; recurring-event charge per occurrence or entire event; percentage or fixed-value discount codes with usage/date/ticket restrictions; currency, tax, payment methods and optional partial payments. Partial payments send an invoice PDF with a payment link for the balance.
- Registration forms can be linked to an event (one form to one event). The form URL can be shared externally or through guest invitations.
- Event attendance can be recorded via QR/barcode ticket scan, ticket number or guest-name lookup and marks guests/tickets Attended. Name lookup requires the person be on the event guest list.
- Sources: [Events overview](https://help.elvanto.com/hc/en-us/articles/7482222664983-Elvanto-Events-Overview), [Create an event](https://help.elvanto.com/hc/en-us/articles/7622437988503-How-to-Create-an-Event), [Event tickets and payments](https://help.elvanto.com/hc/en-us/articles/7622538747799-How-to-Add-Registration-to-an-Event-with-Tickets-and-Payments), [Invite people to an event](https://help.elvanto.com/hc/en-us/articles/7622440273175-How-to-Invite-People-to-an-Event), [Record event attendance](https://help.elvanto.com/hc/en-us/articles/7622421486359-Event-Attendance-in-Elvanto).

### Check-in: attendance, checkout, reporting
- Check-in tracks arrival and departure for children, adults, and volunteers. Admin check-in can search by name, mobile, or security code and check in family members; self-check-in supports native/on-screen/external keyboard modes and quick barcode mode. The official guide describes self-check-in availability beginning up to six hours before service.
- Room leaders/admins can see checked-in people, check people out, and contact parents by SMS. Parent contact is also available from Check-in reports, by email or SMS when enabled.
- Built-in reports: Overall Check-in Attendance (room check-in counts, average check-ins, room load), Room Attendance (people checked into rooms), and Absentees (people not checked in over a date range). Reports accept date range, room, other filters and extra columns; reports can be generated or used for parent contact.
- Sources: [Check-in guide](https://help.elvanto.com/hc/en-us/articles/7647636153623-Elvanto-Check-In), [Check-in attendance reports](https://help.elvanto.com/hc/en-us/articles/7622115144471-How-to-run-Reports-on-Check-in-Attendance), [Contact parents](https://help.elvanto.com/hc/en-us/articles/7596839143959-How-to-Contact-the-Parents-of-Children).

### Needs: reminders and member actions
- Need reminder settings can enable email reminders, set recurring reminders before the due date, send on the due date, and set recurring overdue reminders; assigned members receive reminders.
- Official help also lists member actions to subscribe to a Need Type, accept a need, and complete it. These member flows were not available in the demo pages inspected.
- Source: [Need Types and reminders](https://help.elvanto.com/hc/en-us/articles/7622863673495-Setting-Up-Need-Types-and-Reminders).

### Financial: imports, pledges, statements and settings
- Financial supports batches, individual transactions, pledges, chart-of-accounts categories/subaccounts, financial reports, and online-giving integrations; it is a giving/pledge tracker rather than accounting or payroll software.
- Transaction import maps CSV fields for donor/giving number, batch, date, payment method, check number, account, amount, tax deductibility, memo and pledge link. Pledge import includes donor, date range, account, weekly/monthly/yearly/one-time frequency, installment count and installment amount.
- Pledges support one or multiple people, start date, installment amount, frequency, duration, account/subaccount, calculated end date/total; payments can be added or existing transactions linked. The official help warns deleting pledges is irreversible.
- Financial settings include year-end, currency, default tax-deductibility behavior, generated/manual giving numbers, member visibility of transactions/pledges/family giving, online-giving URL, statements visible to members, and statement messages/placeholders (optionally location-specific). Giving statements can be printed/downloaded from generated statement batches.
- Sources: [Financial overview](https://help.elvanto.com/hc/en-us/articles/7482278722199-Financial-Section-Overview), [Import financial information](https://help.elvanto.com/hc/en-us/articles/7503433613335-Importing-Financial-Information-into-Elvanto), [Pledges](https://help.elvanto.com/hc/en-us/articles/7623999232023-How-to-Create-and-Add-a-Pledge), [Financial settings](https://help.elvanto.com/hc/en-us/articles/7501255977239-Overview-of-the-Financial-Settings-Area), [Giving statement printing](https://help.elvanto.com/hc/en-us/articles/27805800001559-How-to-Print-and-Download-Giving-Statements-in-Elvanto).

### Group and volunteer engagement
- My Groups can expose group chat/message boards. Members can post messages; notifications may arrive by email and mobile push. Members can configure notification preferences. Category-level admin settings can show/hide groups in the Member Area, allow all members or only leaders to message, and choose message style.
- Service roster members can accept/decline pending requests, view their own/family schedules where enabled, view roles and rehearsal times, open service songs/files/plan and download/print song PDFs; admins may open Edit Service. Roster can show upcoming only or include past services and offers schedule subscription.
- Sources: [Group chat](https://help.elvanto.com/hc/en-us/articles/12215426004631-Using-Group-Chat-In-Elvanto), [Member roster](https://help.elvanto.com/hc/en-us/articles/19365320143127-How-to-View-My-Schedule-Roster), [Volunteer calendar subscription](https://help.elvanto.com/hc/en-us/articles/7659760014615-How-to-Check-Your-Upcoming-Schedule-and-Subscribe-to-Your-Volunteer-Calendar-in-Elvanto).

### Source index used for this cross-check
- Elvanto Help Center's category index includes topic collections for People (search/import, categories, duplicates, volunteer scheduling, flows), Services (service types, teams, reporting, LIVE), Songs, Check-in, Events, Forms, Groups, Needs, Finance, Member Area, Pastoral Care, and Member Directory.
- Source: [Elvanto Help Center](https://help.elvanto.com/hc/en-us/categories/6656300302743-Help-Center).



## Follow-up, volunteer scheduling, assets, and song-import details — official Help Center

### People Flow creation and step assignments
- Flow setup includes name, flow administrators, location, optional demographic targeting, reminder channels (email, SMS, both, or SMS only when no email) and reminder frequency for due/overdue assignments.
- Flow steps can define name, status, description, instructions, due-date rule, days to hide pending tasks, notification behavior, multiple step admins, and completion actions. Actions can be automated or optional and may update a person, category, group, or move them to another step.
- Automatic assignment can assign a person to an administrator; with it disabled, step admins can manually take unassigned records. Notifications can go to all step admins for unassigned people or only the assigned admin.
- People can enter a flow from the flow itself, a person profile, Mass Manage, forms, or another flow. Flow steps support assigned-to-you views; reassign, change due date/status (Not Started, Pending, In Progress, Complete), remove from step, move to another flow, display instructions/contact details, and complete the step with optional private/categorized note and follow-up actions.
- Sources: [People Flows](https://help.elvanto.com/hc/en-us/articles/7481304329495-People-Flows), [Set up a People Flow](https://help.elvanto.com/hc/en-us/articles/7596115197463-Setting-up-a-People-Flow), [Working with People Flows](https://help.elvanto.com/hc/en-us/articles/7596156290839-Working-with-People-Flows), [Complete flow-step assignments](https://help.elvanto.com/hc/en-us/articles/24231920410007-How-to-complete-Flow-Step-Assignments).

### Volunteer roster requests
- Volunteers may decline requests, request a swap with another rostered volunteer (reciprocal exchange) or ask an eligible unrostered volunteer to replace them. A request can be sent to multiple candidates and succeeds only when accepted.
- Eligibility/conflict checks consider availability/preferences, service type/department/position and conflicting scheduled positions. Admin settings can limit how near a service time a swap/replacement request can be submitted or cancel unfilled requests near service.
- Sources: [Swap, replace, or decline a request](https://help.elvanto.com/hc/en-us/articles/7659757415191-How-to-Swap-Replace-or-Decline-a-Volunteer-Request), [Swapping and replacing volunteers](https://help.elvanto.com/hc/en-us/articles/7702388577815-Swapping-Replacing-Volunteers-in-Elvanto).

### Asset booking details
- When an event reserves assets, Elvanto checks time conflicts; event organizers/editors can see booked assets on the calendar. If approvals are required, the booking becomes pending, asset admins are notified, and the organizer receives approval/rejection updates (except where organizer is the approver).
- Asset booking views can filter event date range (maximum 36 months), event status, calendar, location, and asset; sort by start/end, calendar, location, asset, address; and show table/list views.
- Sources: [Book an asset](https://help.elvanto.com/hc/en-us/articles/7625861242903-How-to-Book-an-Asset), [View asset bookings](https://help.elvanto.com/hc/en-us/articles/17036957042199-How-can-I-view-my-Asset-Bookings).

### Song and arrangement imports
- SongSelect integration can find a song and populate title, CCLI number, artist and album; import lyrics, choose a key, assign category/location and arrangement details. Chord charts are imported as PDF attachments because the SongSelect API does not provide an editable chart format. Existing arrangement lyrics can be re-imported.
- Song CSV or Planning Center Online imports can map song title, status, author, album, Song/Item type, CCLI number, Song to Learn, downloads, notes, video/audio links, plus up to three arrangement entries (name, length, BPM, male/female/starting/ending keys). Column mapping can set overwrite behavior and handle new/duplicate songs.
- Sources: [Import chord charts from SongSelect](https://help.elvanto.com/hc/en-us/articles/7608017260951-How-to-Import-Chord-Charts-from-SongSelect), [Import songs](https://help.elvanto.com/hc/en-us/articles/7503588764055-Importing-Songs-into-Elvanto).



## More Settings pages — directly observed in Super Admin demo

### Groups and Group Finder
- Group settings include email notifications for scheduled group notes; recurring attendance reminder days from 1–28 before a meeting, email/SMS channels, and customizable Contact Template; available group report fields built from Heading, Reporting, Notes and Separator components; and whether leaders need to log in to submit reports.
- Group Finder settings: enable/disable; auto-contact join applicants by email/SMS; show map by default or behind a button; website iframe embed code; member-visible filters for categories, departments, demographics and locations; and server-side restrictions by those same group attributes.
- No notification, access, map, filter, or report settings were changed.
- Sources: [Groups settings](https://demo.elvanto.com/admin/settings/groups), [Group Finder settings](https://demo.elvanto.com/admin/settings/groups/sign-up/).

### Services, volunteer notifications and roster rules
- Services settings provide configurable service reporting fields and print presets; report field types include Heading, Reporting, Notes, Separator, and custom fields.
- Volunteer notifications can email/SMS the 'Reports To' person when a volunteer confirms or declines (or only declines); automatically contact volunteers when scheduled or unscheduled; and follow up unconfirmed volunteers after a chosen number of days. Settings say auto-contact is skipped for unpublished services and auto-scheduled volunteers where applicable.
- Volunteer schedule reminders support multiple email/SMS reminders 1–28 days before service.
- Roster settings: default new volunteer status Confirmed/Unconfirmed; how far ahead services appear; default Volunteers or Plan tab; show/hide unconfirmed volunteers; show/hide family rosters; limit visible roster to services/teams assigned to a volunteer or expose all; allow or block declines after confirmation with a cutoff; minimum notice and required reason for unavailability; allow/block unavailability on scheduled dates; family-wide unavailability; swap/replace prevention and pending-request cancellation windows; allow declining while swap/replace is available; per-department swap-only/replace-only/both/neither rules; conflict time between services; and whether scheduling preferences count each service time or whole service.
- No settings were changed.
- Sources: [Services settings](https://demo.elvanto.com/admin/settings/services/), [Volunteer settings](https://demo.elvanto.com/admin/settings/services/volunteers/), [Roster settings](https://demo.elvanto.com/admin/settings/services/roster/).

### Event, Calendar and Financial settings
- Event defaults: show/hide map; hide or show free-ticket price and remaining-ticket count; enable tax with percentage, include/exclude tax and label; configure payment methods; allow/disallow part payments; invoice logo and header/footer template, numbering length/prefix/suffix; enable/disable invoices and tickets for free registrations; ticket barcode None/Standard Barcode/QR Code. Event details can override several defaults.
- Calendar defaults: Week/Month view, first day Sunday/Monday, built-in colors for People Notes, Group Notes, Groups, Services, and allow guests to view Member Area calendar.
- Financial settings: choose financial year-end day/month and currency symbol; tax-deductible default or Chart of Accounts behavior; automatic/manual giving numbers and bulk generate for existing people; Member Area online-giving URL; show pledges/transactions and optionally family giving; statement message placeholders plus location-specific extra messages. Giving Statement Templates showed a new Basic Template and old default template, each with Duplicate.
- No settings were changed.
- Sources: [Event settings](https://demo.elvanto.com/admin/settings/events), [Calendar settings](https://demo.elvanto.com/admin/settings/calendar/), [Financial settings](https://demo.elvanto.com/admin/settings/financial/), [Giving statement templates](https://demo.elvanto.com/admin/settings/financial/giving-statements/).

### Member Directory and Posts settings
- Directory settings: enable/disable and custom name; display individuals, families or both; default view and individual sort; preferred-name format; exclude People Categories/demographics; always-include selected people despite lockdowns; auto-add new people, require opt-in, and initially list all members.
- Directory Layout editor configures a draggable profile section and a separate selectable set of individual/family list columns; the page notes only the profile section is shown in the mobile app, not the Columns to Display section. Field groups span identity, contact, departments, groups, account, address, family, children, financial, and custom fields.
- Posts settings: allow/disallow comments; require login or allow guests; require approval for no comments/all comments/guest comments only; number of posts per page.
- Sources: [Member Directory settings](https://demo.elvanto.com/admin/settings/member-directory/), [Member Directory layout](https://demo.elvanto.com/admin/settings/member-directory/layout/), [Posts settings](https://demo.elvanto.com/admin/settings/posts/).

### Layouts and Member Area navigation
- Layout index shows Add, configured layout name, custom URL, custom domain and site name. The demo warns layout changes cannot be saved.
- Layout editor sections:
  - Layout identity: name, site title, departments this layout is assigned to (used to limit information shown to logged-out members).
  - URL/domain: account custom URL and optional custom domain redirect.
  - Member Area branding: logo and background upload; background repeat mode; header color/height; navigation background/text colors.
  - Admin Area logo and color; login page style (custom, Member Area or Admin Area); log-out redirect URL; iOS home-screen PNG icon.
  - Menu editor lists built-in Member Area links (Home, Roster, Songs, Calendar, Member Directory, Group Finder, My Groups, My Giving, Links, Unavailability, Volunteer Preferences, Needs) plus custom links, Pages, Post Categories and Links, with draggable menu structure, Add to Menu and Save.
- A Sidebars settings route returned “You do not have access to this item.” Layout save is explicitly disabled in the public demo; no configuration was changed.
- Source: [Layouts in the public demo](https://demo.elvanto.com/admin/settings/customize/).

### Access Permission detail — observed on the Group Leaders permission
- Access Permission records can enable Admin Area and Member Area separately, expose Print, and configure module-level access; the index offered Add Access Permission and View Full List.
- Admin module list includes People, Groups, Services, Songs, Check-in, Reports, Calendar, Events, Forms, Needs, Financial, Emails & Letters, Files, Posts, Pages, Links, Settings, Billing & Plan, Lockdown Areas and Communication. Member Area sections include Roster, Needs, Songs, Links, Unavailability, Pages, Sidebars, Files, Member Directory and Calendar.
- People permissions cover record creation/profile viewing/editing/category changes, directory privacy, volunteer preferences/status, activity and sent communication visibility, public/private profile files, shared/private/personal notes and note edit/complete/delete, family tab, account/volunteer details, password/access permission administration, contacts/volunteers, archive/deceased/delete, duplicates, views/map/flows/categories/import; restrictions can scope records to categories or groups. The UI warns People import is not lockdown-limited.
- Groups permissions cover viewing by category/leader/member, adding people with corresponding scope restrictions, editing positions, member removal, create/edit details/activity/notes/reporting/custom statistics, report deletion, group deletion/categories, and CSV attendance import; the UI warns group import is not restriction-limited.
- Services permissions include create/view/edit details/plan/volunteers/reporting, custom reporting fields, edit songs, print/presets/song print, email/SMS scheduled volunteers, delete, LIVE and kick controller, service types, and service teams/subteams with create/edit/delete/email/SMS plus import; UI warns service import is not lockdown-limited.
- Other checked modules expose specific controls: Reports create/edit/share/automated email/delete/export/categories; Events create/edit details/registration, view invoices/tickets, issue refunds, cancel invoices/tickets, manage guests, delete and invite to others' events; Forms restrict access/create/edit/delete/export submissions/archived items/unpublished forms/categories; Files moderator/view/view versions/create/edit/upload/delete versions/delete/folders; Communication grants contact/email/SMS people and groups and restricts From addresses. These examples are the visible controls in the sample Group Leaders permission, not the complete product permission model.
- No permission was changed. The checked/unchecked sample configuration is not generalized to other accounts.
- Source: [Access Permissions in the public demo](https://demo.elvanto.com/admin/settings/access/).




### Admins permission profile — additional module capabilities directly observed
The demo's separate Admins Access Permission enabled all shown admin modules except Billing & Plan and Lockdown Areas. The checked state is only sample configuration. These module panels expose the following controls:

- Check-in: access toggle and room management.
- Needs: create, edit, cancel and delete needs.
- Financial: separate view/create/edit/delete for batches, transactions and pledges; Chart of Accounts; publish financial information; import CSV (warning: financial import is not lockdown-restricted).
- Emails & Letters: create/edit and delete templates.
- Posts: view all posts regardless of lockdown; create/edit; change author; delete; manage categories and comments.
- Pages: view all regardless of lockdown; create/edit and delete.
- Links: create/edit, delete, manage categories.
- Settings: separate access to formatting; People, Groups, Services, Needs, Songs, Communication, Check-in, Events, Calendar, Financial, Posts and Member Directory settings; manage Departments, Demographics, Locations, Access Permissions, Assets/Asset Categories, Note Categories, Built-in Contact Templates, Layouts, Sidebars, Integrations/API keys, and Scheduled Email & SMS (view/delete).
- Member Area Roster access: view scheduled services; optionally view all services/volunteers; view/print plan and songs; LIVE.
- Member Area Needs: view published needs and accept them. Songs: view songs and download attached media. Directory: access plus lockdown by department, demographic, location, group. Unavailability: submit. Sidebars: edit sidebar content without Admin Area access.
- As with other Access Permission screens, options are independent capabilities. No permission was changed.
- Source: [Admins Access Permission in the public demo](https://demo.elvanto.com/admin/settings/access/access/).




## Church reference lists and configuration pages — direct demo inspection

### Departments
- Departments index offers Add, Merge, Change Order, delete and nested hierarchy. A department editor exposes name, volunteer self-assignment visibility, non-conflict configuration, department-specific default roster status (Account default/Unconfirmed/Confirmed), whether a notification must be prepared when scheduling, and sub-department/position management.
- Intro text defines departments as areas where volunteers serve, organized into sub-departments and positions. No department was changed or merged.
- Source: [Departments settings](https://demo.elvanto.com/admin/settings/departments).

### Demographics and progression
- Demographics index offers Add, Assign Demographic Progression, Change Order and delete, with demographic help topics. Separate progression page explains that configured progression can automatically assign people to their correct demographics and provides an Assign button. No progression was run and no demographic was changed.
- Source: [Demographics settings](https://demo.elvanto.com/admin/settings/demographics).

### Locations
- Locations index offers Add, Change Order and delete. Help describes locations as separate campuses/sites for services. The demo showed two sample campuses; no location was changed.
- Source: [Locations settings](https://demo.elvanto.com/admin/settings/locations).

### Assets and asset categories
- Assets index offers Add, Manage Categories, All Assets view, search, Active filter, sort, page size, Table/List switch, pagination and deletion; records display categories and associated locations.
- Asset editor fields: Name, Archive Asset, Category, Locations, asset Admins, notification choice (none, notify, notify-and-require-approval), required gap before/after bookings in minutes, and custom email messages on approval/decline.
- Asset Categories index offers Add, Change Order, delete; introductory text says categories can group rooms/vehicles or assets used together in a package.
- No asset, category, approval, or booking was changed.
- Sources: [Assets settings](https://demo.elvanto.com/admin/settings/assets/), [Asset categories](https://demo.elvanto.com/admin/settings/assets/categories/).

### Note Categories
- Note Categories provides Add, sort, delete; description says categories organize notes for reporting and at-a-glance/history review and can have distinct access permissions. No category was changed.
- Source: [Note Categories settings](https://demo.elvanto.com/admin/settings/note-categories/).

### Integrations
- Integrations index offers Add and notes that certain settings cannot be saved in the demo. It showed no existing integrations. Opening Add returned “Internal Server Error,” so provider choices and setup fields remain unverified; this is a demo runtime limit, not evidence that integrations are absent.
- Source: [Integrations settings in public demo](https://demo.elvanto.com/admin/settings/integrations/).




## Communication Settings and built-in contact templates — directly observed

### Occasion messages and sending domains
- Occasion Messages configure automatic birthday and anniversary Email/SMS separately. Each can filter by People Category and Demographics, include/exclude contacts, and choose SMS only when no email address is available. Message content is managed through Built-in Contact Templates. No message or filter was changed.
- Sending Domains describes verification of sender domains by adding three CNAME records. The sample showed two domains with incomplete status; record values were not available in the demo. No DNS changes were made.
- Scheduled Email & SMS settings page showed No Results Found. The page is an area for viewing scheduled sends; none were scheduled, edited or deleted.
- The main Communication settings route returned Internal Server Error; provider and sending preferences could not be checked in that page. The Security settings route returned “You do not have access to this item.”
- Sources: [Occasion Messages](https://demo.elvanto.com/admin/settings/communication/occasions/), [Sending Domains](https://demo.elvanto.com/admin/settings/communication/sending-domains/), [Scheduled Email & SMS](https://demo.elvanto.com/admin/settings/scheduled/).

### Built-in Contact Templates library
The library lets admins select categories and edit built-in email/SMS templates. Template list and descriptions observed:

- People: login details (standard and social sign-in), reset password (active/inactive account), new-account notification, family-member approval, People Flow assignment notices, unsubscribe notification, directory opt-in approval, birthday/anniversary messages, step-admin reminders.
- Groups: new-member/report notices to leaders/admins; attendance-submission and meeting-attendance reminders; unread-message notice; new join request; Group Finder response; accepted/declined join request.
- Notes: scheduled, rescheduled and completed note notices.
- SMS: SMS reply to sender by email, failed reply, and no-email-address response.
- Services & Volunteers: contact volunteers for one/multiple services; Reports To notifications on confirmation/decline; scheduled/unscheduled notices; follow-up for unconfirmed volunteers; schedule reminders; full volunteer swap/replacement lifecycle (request, completed/accepted, no-response, Reports To, unsuccessful and canceled notices).
- Needs: reminder to assigned members; new need notification to eligible members at the same location subscribed to its Need Type.
- Forms: submission notification and approval-required submission notification.
- Events: manual and automated invite emails/SMS.
- Event Registration: invoice and invoice-plus-tickets emails.
- Reports: scheduled report emails.
- Assets: asset booked, approval-required, approved and declined emails.
- Source: [Built-in Contact Templates](https://demo.elvanto.com/admin/settings/contact-templates/).




## Song, service-type, group-category and formatting configuration — directly observed

### Song settings and CCLI reporting
- Song settings limit Member Area song access to selected departments (none selected means all users with Songs permission). Default CCLI reporting fields are Print, Digital, Translation, Recording, and Music Reproduction Licence (MRL) number. Arrangement defaults include duration, page orientation, columns, font, chord color, and text size.
- Songs index also has CCLI Reporting. Its report dialog offers custom ranges plus relative, calendar week/month/quarter/year and prior-year date options; include published but unscheduled songs; filter Service Types and Locations; sort by Song, Status, CCLI Number, Times Used, Print, Digital, Translation, Recording, or File Downloads in ascending/descending order; output Web, XLSX, CSV or PDF; Save Snapshot, Cancel, Generate. No report was generated.
- Sources: [Song settings](https://demo.elvanto.com/admin/settings/songs/), [Songs / CCLI Reporting](https://demo.elvanto.com/admin/songs/#v:all).

### Group Categories
- Group Categories index offers Add Category, Change Order, View Groups, Delete and a Member Area indicator.
- Category editor has assigned Admins; group Positions; Reporting Reminders (enabled/disabled, email/SMS/both, multiple reminder hours); Reporting Template; category name/color/description.
- Member Area options control whether members can see groups in that category; message posting by leaders only vs all members; message-board vs chat display; notification targets (leaders/admins) on member added and group report submitted.
- No group category was changed.
- Source: [Group Categories](https://demo.elvanto.com/admin/groups/categories/).

### Service Types
- Service Types index offers Add Service Type, sort and duplicate. Each type exposes Plan, Departments, Reporting, Location, default name and default service times.
- Type editor tabs: Edit, Plan, Departments, Reporting; also Apply Service Times/Template to Future Services.
- Details include admin-only type name, Location/All Locations, volunteer-facing name, highlight color, description, one or more default Times, Other Times (Rehearsal/Other and same day/before/after relation), plan logo, and highlighted service-plan department positions.
- Plan template supports Add Item and Add Heading, duration rows, songs and section headings.
- Departments tab selects which departments/sub-departments/positions apply and sets required counts; Reporting tab chooses which global reporting fields are shown for that type. No type/template was changed or applied to future services.
- Source: [Service Types](https://demo.elvanto.com/admin/services/types/).

### Formatting
- Formatting settings include account date and time formats; currency; address format with field placeholders; export/print paper size and PDF/XLS font; Avery address-label layouts; custom address-label templates and name-tag label templates.
- Source: [Formatting settings](https://demo.elvanto.com/admin/settings/formatting).

### Remaining access boundary
- Super Admins settings route returned “You do not have access to this item” for the public demo's Admin persona, despite the persona picker name. Account, Passwords & Security, Sidebars and main Communication settings have separate access/runtime blockers recorded above. These settings are listed in the index but are not claimed as directly verified configuration workflows.



## Financial module: transactions, pledges, imports, giving statements and reports — directly observed in demo

### Financial navigation and list views
- The Financial module exposes Batches, Transactions, Pledges, Chart of Accounts, Giving Statements, Reports and Import.
- Transactions list columns observed: Name, Amount, Paid By, Date, Batch. Pledges list columns: Name(s), Amount, Start Date, End Date, Account/Sub Account. Demo data included many records; no donor details are repeated here.
- Chart of Accounts supports adding/sorting accounts; account status can be Active or Archived and tax deductibility can be defaulted at account level. Subaccounts can inherit the parent tax-deductibility setting or override it.
- The Pledge editor offers Add Person, Start Date, Amount, Frequency (One Time, Weekly, Monthly, Yearly), installment count, Account/Sub Account, and automatically calculated End Date and Total Amount. The UI notes that a pledge within 30 days can make a person marked as Contact active. The form was closed without saving.

### Giving statements
- Giving Statements page offers Publish Giving Statement and lists previously published statements.
- The publish dialog configures a name and date range; Families or Individuals; optionally separate primary/spouse statements; transaction/pledge inclusion (all, unlinked only, linked only); output selection (transactions plus overview, overview only, pledge statement, tax overview); include pledges without transactions; deductible/non-deductible filters; account/subaccount selection; and a statement template.
- These controls were inspected without publishing, sending, or saving a statement.
- Source: [Giving Statements](https://demo.elvanto.com/admin/financial/#v:giving-statements).

### Financial imports
- Financial Import page documents that imports cannot be performed in the demo, though sample-file exploration is mentioned. The page offers a file picker, Transaction or Pledge import type, date-format choice (dd/mm/yyyy or mm/dd/yyyy), and Continue. No file was selected or uploaded and Continue was not used.
- Source: [Financial Import](https://demo.elvanto.com/admin/financial/import/).

### Built-in Financial report catalog
The Financial report category contains nine built-in reports, each with Generate and Email actions:
- Batches: transactions within chosen batches.
- Batch Summaries: batch detail summaries across a period.
- Donors by Method: people who did or did not give through a selected method.
- Donors by Number of Gifts Given: people making their Nth gift in a period.
- Giving Statements: generate/print statements for people, families or groups.
- New Givers: new givers in a period.
- Pledge & Transaction Amounts: each individual's pledge amounts and total transactions over a period.
- Top Givers: a specified number of individuals with highest donation amounts in a period.
- Transactions: transactions over a period for people.

### Financial report dialog controls observed
- Common date-range selector includes custom range, today/yesterday, trailing 7/14 days, 3/4 weeks, 2/3/6/9/12 months, this/last calendar week or month, this calendar year and quarters, last calendar year and quarters, and 2 through 10 calendar years ago.
- Batch Summaries additionally filter Tax Deductible Only / Non Tax Deductible / Both and accounts/subaccounts, then output to Web, XLSX, CSV, PDF or Save Snapshot.
- Batches report can find batches by name or date and choose List all transactions, Group transactions by method, Group transactions by account, Totals per method, or Totals per account. It filters deductible status, accounts/subaccounts and payment methods (Cash, Check, Credit Card, Bank Transfer, Automatic Direct Debit, Online); optional batch columns include Memo, Method, Check Number, Batch Name and External Notes. It can add extensive person columns across identity, contact, assets, groups, account details, address, family, children, financial and custom fields; sort by person, transaction, batch or selected person field and direction; output Web, XLSX, CSV, PDF or Save Snapshot.
- Report dialogs expose Cancel and Generate. No report was generated, emailed, exported or saved as a snapshot.
- Sources: [Financial reports](https://demo.elvanto.com/admin/reports/#existing:financial), [Batch report dialog](https://demo.elvanto.com/admin/reports/#existing:financial).

### Observed demo limitations
- Import controls explicitly block actual imports. Financial reports were viewed in configuration dialogs only; report generation and Email actions were not exercised. Public-demo availability and sample records can change.



## Further report, form and event workflows — official Help Center cross-check

### Report types and scheduled delivery
- Reports are grouped by category and include built-in, standard/custom and comprehensive reports. Standard reports build a person list from custom criteria, with CSV/PDF export and sharing permissions. Comprehensive reports combine built-in and standard reports with text and images; they export to PDF.
- Report lists support category filtering and favorites. Existing reports can be duplicated.
- Reports may be emailed on schedules: weekly, biweekly, monthly, every three months, every six months or yearly; configure start date/time, recipients and optional plain-text message. Recipients of scheduled reports may retain access to view the report even when private sharing permissions would otherwise exclude them. Super Admins can view scheduled report emails. Built-in report scheduling additionally configures that report's filters; the workflow has preview, export/link sharing/edit and a later scheduling step.
- Report categories can be added and named.
- Sources: [How to use Reports](https://help.elvanto.com/hc/en-us/articles/7622122691479-How-to-use-Reports), [Automatically Email Reports](https://help.elvanto.com/hc/en-us/articles/7622335970839-How-to-Automatically-Email-Reports), [Add Report Categories](https://help.elvanto.com/hc/en-us/articles/21354831347863-How-to-Add-Report-Categories), [Generate a Comprehensive Report](https://help.elvanto.com/hc/en-us/articles/7622234586391-How-to-Generate-a-Comprehensive-Report).

### Service attendance and reporting
- Built-in service reports include three Service Attendance reports, filterable by date range, service type and location. Service Reporting offers statistics as table, line, bar or column chart; totals can be grouped per service/day/week/month/year and filtered by service type, location and people category, using built-in or custom statistics such as individuals, families or guests.
- Detailed service reporting shows one service per row, can group by type/location or show one list, and can include custom note/statistic fields.
- Individual attendance reporting can filter attendance/frequency, show totals or individual service grids, and list those who attended or did not attend, including thresholds across a time period.
- Source: [How to Report on Services](https://help.elvanto.com/hc/en-us/articles/7604602275991-How-to-Report-on-Services).

### Forms
- Forms are shareable by link or embed code and can update person profiles automatically or require review/approval. Approval can trigger actions such as adding the person to a group or People Flow step. Forms may be standard forms or registration forms and can be event registration forms handling free/paid registrations, tickets, discounts and payment methods.
- Form content can include standard and custom people fields; visual styling supports custom colors and a header; forms can be embedded in the Member Area navigation. Email changes submitted via forms require admin approval.
- Editing/removing form fields retroactively affects past submissions, including updating/deleting submission data.
- Sources: [Forms Overview](https://help.elvanto.com/hc/en-us/articles/7482338373783-Forms-Overview), [Using Forms](https://help.elvanto.com/hc/en-us/articles/7580810756503-Using-Forms).

### Event check-in
- Event attendance can be recorded from the event’s Guests or Invoices & Tickets area. Check-in can search guest names or accept ticket number, barcode or QR scans; successful check-in marks attendance on the event guest and corresponding ticket. A person must already be on the event guest list before name-based check-in.
- Source: [Event Attendance](https://help.elvanto.com/hc/en-us/articles/7622421486359-Event-Attendance-in-Elvanto).

### Access permissions context
- Official help says a default account includes five preset permission levels: Inputting Finances, Admins, Group Leaders, Members / Volunteers and Service Coordinators. Lockdown Areas optionally limit an admin's visible information by location, department or demographic; if a user has multiple permission roles, lockdown settings must be set on each role. This supplements, but does not replace, the role-specific controls directly inspected in the demo.
- Source: [Add or Edit Access Permissions](https://help.elvanto.com/hc/en-us/articles/7625087265559-Add-or-Edit-Access-Permissions-in-Elvanto).




## Built-in report catalog — all report names shown in the demo

The Reports View selector offers Custom Reports (All, Standard, Comprehensive, Snapshots), Built-in Reports (All, People, Groups, Services, Check-in, Financial), Favorite Reports, and user categories. Built-in category counts and titles below were read directly from the demo. Each listed report row offers Generate and Email; the lists also provide search, page size, table/list switching and a favorite star.

### People (7)
- No Notes Report — people without a note in a selected period.
- People Activity — activity recorded on people.
- People Category History — counts of people in selected categories at a point in time.
- People Flow Steps Detail — flow steps and people assigned to each.
- People Notes — notes recorded in a period.
- SMS Text Messages — people who sent SMS in a period.
- Unsubscribes — people who unsubscribed from email or SMS.

### Groups (8)
- Group Attendance Summary — group attendance summary over a period.
- Group Details — information about each group.
- Group Individual Attendance — people who attended or missed groups.
- Group Notes — notes recorded over a period.
- Group People — people in groups.
- Group People History — membership in selected groups at a point in time.
- Group Reporting (Detailed) — one group report at a time with added detail/custom notes.
- Group Reporting (Statistics) — graphs and statistics from Group Reporting.

### Services (6)
- CCLI Reporting.
- Service Details — service overview during a selected period.
- Service Individual Attendance — people who attended or missed services.
- Service Reporting (Detailed) — one service report at a time, including custom-statistic notes.
- Service Reporting (Statistics) — graphs/statistics from Service Reporting.
- Volunteer Positions — volunteers and positions served during a period.

### Check-in (3)
- Absentees — people not checked in on specified dates.
- Overall Check-in Attendance — check-in counts by room, averages and room load over a period.
- Room Attendance — people checked in by room over a period.

### Financial (9)
- Batches; Batch Summaries; Donors by Method; Donors by Number of Gifts Given; Giving Statements; New Givers; Pledge & Transaction Amounts; Top Givers; Transactions. Descriptions and filter controls are documented above.

### Custom Reports sample in the demo (15)
The All Custom Reports table showed standard and comprehensive report records. Available row actions: open/view, Edit, Sharing, Email, Duplicate and Export; comprehensive entries are labeled. Columns include category, description, created/created-by and modified/modified-by. Sample report titles included background-check action/expiry reports, new-people and attendance reports, parents-of-children reports, people-not-in-a-group, un-baptized members, upcoming birthdays/anniversaries and other safety-check reports. These are demo examples, not an exhaustive list of report templates available to every account.

### Direct-observation boundary
- The demo's built-in catalog covers 33 entries in five categories (7 + 8 + 6 + 3 + 9). Report names/counts reflect this demo account at inspection time. The interface's dynamic lists can vary with account data, subscription and permissions.
- Most report configuration dialogs were not run. The previously documented Batches, Batch Summaries and Donors by Method dialogs show concrete filter/output controls; Email/Generate/Export actions remain unexecuted.



## People, groups, services and needs workflows — official Help Center detail

### People Views, bulk management and duplicates
- People Views can use preset filters or custom criteria; custom views define a name, description and category; return individuals or family units; match all/any criteria or advanced filter logic; select built-in/custom field criteria; drag/drop displayed columns and sort order.
- Views update dynamically as records change, can be private/shared, edited/deleted, exported to CSV/Excel (legacy also PDF/snapshot), and used to contact or mass-manage their matching people. People lists default to active people and can be exported with selected columns.
- Mass Manage can take selected people from advanced search, People Views, categories or groups; supports selecting visible records or all pages and then applying bulk actions.
- Duplicate management offers a candidate list, select the primary profile, choose nonconflicting field values, merge duplicates, or mark false positives Not a Duplicate; a separate list can restore records previously marked Not a Duplicate.
- Sources: [Create a People View](https://help.elvanto.com/hc/en-us/articles/7622213604247-How-to-Create-a-People-View), [Manage and export People Views](https://help.elvanto.com/hc/en-us/articles/16461426719383-Edit-Share-Export-or-Delete-Custom-People-Views), [Viewing and Exporting People](https://help.elvanto.com/hc/en-us/articles/7598167581591-Viewing-and-Exporting-People), [Mass Manage](https://help.elvanto.com/hc/en-us/articles/7597703856791-Using-the-Mass-Manage-Tool), [Merge Duplicate People](https://help.elvanto.com/hc/en-us/articles/7597336832151-How-to-merge-Duplicate-People-in-Elvanto).

### People Notes and activity
- People Notes support a note type and category, private visibility, scheduled date/time, assignee/follow-up person, and completion, edit or delete actions. Scheduled assignees receive an email. Category access can be permission-restricted; authors and assignees may still see their notes. Bulk advanced search can filter by people with/without notes.
- People Activity reports can filter activity type and include events such as added, marked active/contact, archived (with archive reason when recorded), deceased/deleted, emails/SMS sent, group additions/removals and People Flow additions/step additions.
- Sources: [People Notes](https://help.elvanto.com/hc/en-us/articles/7481357496983-People-Notes), [People Activity Reports](https://help.elvanto.com/hc/en-us/articles/22050409643287-People-Activity-Reports-Overview).

### Group attendance and member access
- A group report records meeting date/time or marks the group as not met, optionally associates a service time, marks member attendance, records member notes and guest count, and submits configured custom fields. Leaders can complete attendance from reminder email. Admins can view reports by date range and revise past reports.
- Groups distinguish from service volunteer departments and attribute-based demographics. They have leaders and assistant leaders, optional category positions, category templates, report reminders, and reporting fields. Member Area My Groups can show a member's groups, leaders and other members and support member communication.
- Sources: [Track Group Attendance](https://help.elvanto.com/hc/en-us/articles/7600255099031-How-to-Track-Group-Attendance), [Groups Overview](https://help.elvanto.com/hc/en-us/articles/7481435328791-Elvanto-Groups-Overview).

### Services and volunteer scheduling
- Service editor areas: details (name/date/location/type/times), plan (songs, service items, comments, notes, attachments), volunteers (assign/contact roles), reporting (individual attendance, built-in/custom service reporting) and check-in entry point.
- Bulk-add services supports generation by end date or count at a chosen frequency; a service can have multiple times and additional rehearsal/other times. Service templates can populate details.
- Volunteer scheduling supports auto-scheduling, manual drag/drop assignment, or both; department/subdepartment/position filters; availability/conflict warnings; call times, Reports To notifications, status, notifications and per-volunteer service time assignment. Teams can be rostered as a unit, with availability/conflict resolution before scheduling. Member Area volunteers can accept/decline requests, review schedule/songs/files/plan and subscribe to the volunteer calendar.
- Sources: [Add/Edit Services](https://help.elvanto.com/hc/en-us/articles/7600590376471-Adding-and-Editing-Services), [Edit a Service](https://help.elvanto.com/hc/en-us/articles/7604108730519-How-to-Edit-a-Service), [Schedule Volunteers](https://help.elvanto.com/hc/en-us/articles/7604005299863-How-to-Schedule-Volunteers-Onto-a-Single-Service), [Schedule a Service Team](https://help.elvanto.com/hc/en-us/articles/7604502154903-How-to-Schedule-a-Service-Team-for-an-Individual-Service), [Volunteer Roster Overview](https://help.elvanto.com/hc/en-us/articles/7702298525463-Using-Services-Scheduling-Your-Volunteers-in-Elvanto), [Member Roster](https://help.elvanto.com/hc/en-us/articles/7659760014615-How-to-Check-Your-Upcoming-Schedule-and-Subscribe-to-Your-Volunteer-Calendar-in-Elvanto).

### Needs
- Admins create a Need under an existing Need Type or create an Other Type; admins cannot directly assign it. Members subscribe to Need Types in Member Area and receive email alerts when new needs of subscribed types are created. A member claims/accepts a need by viewing Needs in Member Area.
- Sources: [Create a Need](https://help.elvanto.com/hc/en-us/articles/7622806366359-Creating-a-Need), [Subscribe to a Need Type](https://help.elvanto.com/hc/en-us/articles/7622810817431-Subscribe-to-a-Need-Type-as-a-Member).



## Events, calendar, songs and finance — additional official workflows

### Events and registration
- Events can be recurring, assigned to calendars, public/private, include a description, location/map and linked assets. Event invitations can target individuals or groups; invitees respond whether attending.
- Registration supports one linked registration form per event; multiple ticket types/prices/limits, per-occurrence vs whole-event charging for recurring events, overall event limits, descriptions and availability windows; percentage or fixed-value discount codes with use limits, eligible tickets, descriptions and availability windows.
- Part payments can use a minimum percentage or fixed value; registrants receive a PDF invoice with a unique link for paying the remaining balance later (no automatic reminder for remaining part payments). Offline payment methods create unpaid invoices. Payment methods may include fees. Tax can be overridden per event.
- Sources: [Events Overview](https://help.elvanto.com/hc/en-us/articles/7482222664983-Elvanto-Events-Overview), [Create an Event](https://help.elvanto.com/hc/en-us/articles/7622437988503-How-to-Create-an-Event), [Event Registration, Tickets and Payments](https://help.elvanto.com/hc/en-us/articles/7622538747799-How-to-Add-Registration-to-an-Event-with-Tickets-and-Payments).

### Calendar
- Admin Calendar can create calendars/events, view services and scheduled notes, link Google calendars and embed the calendar on an external website. Its contents feed the Member Calendar. Calendar settings choose weekly/monthly default, week-start day, built-in colors for Services, Groups, People Notes and Group Notes, and guest access to calendars/services/groups.
- Source: [Calendar Overview](https://help.elvanto.com/hc/en-us/articles/7482221501591-The-Calendar-Overview).

### Songs and arrangements
- A song may have multiple arrangements with distinct tempo/style/key, lyrics with chord notation, and attached audio, video, chart, lyrics, file, image or multitrack materials. Files may be uploaded, linked or embedded and attached at song or arrangement level (Help Center states a 100 MB maximum). Audio and linked video can play directly in Member Area Songs. A service plan selects a song arrangement; alternate keys can be added to an arrangement, while substantially different sequences may use a new arrangement.
- Lyrics support inline chords in brackets, chords above lines, bold/italic text, new-page and column-break markers; the system generates printable/downloadable chord charts.
- Sources: [Song Arrangements](https://help.elvanto.com/hc/en-us/articles/7482125752471-Song-Arrangements), [Add Chords to Lyrics](https://help.elvanto.com/hc/en-us/articles/7607782493463-How-to-Add-Chords-to-Lyrics).

### Financial batches, transactions and pledges
- A batch has a name, status, date and optional Transferred indicator for tracking whether funds were physically banked; transactions can be added to the batch.
- A transaction can be added toward an existing pledge, or an existing transaction can be linked to a pledge. Transaction details include batch, transaction date, person, method, amount, pledge, account, memo and tax deductibility. Pledges support multiple people, one-time/weekly/monthly/yearly frequency, amount per installment and duration; Save & Add Another is available.
- Financial CSV imports require mapping a person, batch, transaction date/method/account/amount/deductibility and optional check number/memo; transaction imports may link pledge by pledge person/start date/account. Pledge imports specify person, start/end, account, frequency, installment count and per-installment amount. Demo blocks performing the import; no file was selected.
- Sources: [Add a Batch](https://help.elvanto.com/hc/en-us/articles/7623897039895-How-to-Add-a-Batch), [Create/Add a Pledge](https://help.elvanto.com/hc/en-us/articles/7623999232023-How-to-Create-and-Add-a-Pledge), [Import Financial Information](https://help.elvanto.com/hc/en-us/articles/7503433613335-Importing-Financial-Information-into-Elvanto).



## Check-in, communication, Member Area and assets — official workflow details

### Service check-in and safety
- Check-in supports admin-assisted, self-service and quick barcode check-in for children, adults or volunteers; check-in/out times can be tracked. People can be found by name, phone or security code and assigned to service time/room; demographic progression can auto-assign a room. Rooms can be mapped by demographics, location or service type and support room attendance reporting.
- Security codes may be fixed or randomly generated. A fixed code can be combined with a new random single-use session code for parent/child pickup. Labels can display parent contact details, allergies, medical/custom fields. Admins can disable labels, control self-check-in label limits, configure label design and print stations, and use barcode scanners/DYMO printers.
- Sources: [Check-in Overview](https://help.elvanto.com/hc/en-us/articles/7482180476439-Check-In-Overview), [Getting Started with Check-in](https://help.elvanto.com/hc/en-us/articles/7621913331991-Getting-started-with-the-Check-in-System), [Check People into a Service](https://help.elvanto.com/hc/en-us/articles/7622014287255-How-to-Check-People-into-a-Service), [Check-in Rooms](https://help.elvanto.com/hc/en-us/articles/7482228987159-Check-In-to-Rooms).

### Communication
- People and groups can be contacted in bulk by email, SMS or printed letters; reusable email and letter templates are supported. There are no user-created custom SMS templates in the documented workflow (built-in system SMS templates are a separate library). Service pages can contact rostered volunteers and choose recipients plus email/SMS; department/sub-department/position contacts can be found through People search. Sending domain verification uses CNAME records; integrated SMS providers are recommended for reliability.
- Sources: [Communicating with People](https://help.elvanto.com/hc/en-us/articles/7481230820375-Communicating-With-People), [Volunteer Communication](https://help.elvanto.com/hc/en-us/articles/7702338363031-Working-with-Volunteers-General-Communication-in-Elvanto).

### Member Area
- Depending on permissions and church setup, Member Area can expose roster, calendar, directory, Group Finder, My Groups, My Giving, unavailability, volunteer preferences, songs, needs, posts and pages. Volunteers can respond to service requests, see family rosters where enabled, access/print/download song files and service files, and subscribe to roster calendars.
- Directory browsing/search is permission- and privacy-aware; people can be hidden by category/demographic/department/group, and individuals may opt out or hide fields. Admins control list/card columns, profile layout, family address, automatic inclusion, opt-in email, custom directory name and lockdown. Always-included people can bypass directory exclusions/lockdowns.
- Sources: [Member Area features](https://help.elvanto.com/hc/en-us/articles/16848603785751-Top-Areas-Members-Can-Access-in-the-Elvanto), [Admin Area vs Member Area](https://help.elvanto.com/hc/en-us/articles/7481034443159-The-Difference-Between-The-Admin-and-Member-Area-in-Elvanto), [Member Directory setup](https://help.elvanto.com/hc/en-us/articles/7626834109591-Setting-up-the-Member-Directory), [Member Directory as a member](https://help.elvanto.com/hc/en-us/articles/7659763171607-Using-the-Member-Directory-in-Elvanto-as-a-Member).

### Event and asset booking
- An event can book one or more assets; the system checks conflicts. Booked assets show on the calendar to the organizer or event editors. If approval is required, booking is pending, asset admins are emailed, and organizer is notified on approval/rejection (except when the organizer is the approver). Asset booking lists can filter a maximum 36-month range, event status (active/private/draft), calendars, locations and assets; sort by start/end, calendar, location, asset or address; switch table/list.
- Sources: [Book an Asset](https://help.elvanto.com/hc/en-us/articles/7625861242903-How-to-Book-an-Asset), [View Asset Bookings](https://help.elvanto.com/hc/en-us/articles/17036957042199-How-can-I-view-my-Asset-Bookings).



## Files, communication composition, integrations — official workflow detail

### Central file library and profile files
- Central Files supports uploaded files/images (help documentation states 10 GB account storage), folders, publication state, expiration, file URL/image URL, access for members or lockdown areas, and per-file version history. Prior versions may be republished; replacing a file version can archive or delete the current one. Moderators can access all files regardless of lockdown.
- Profile files are separate from central Files storage; can be Public or Private, are not shown in Member Area, and have an activity log for add/edit/delete/status changes. Help documents a 40 MB profile-file limit. Profile permissions can separately grant viewing profiles/activity and managing public/private files.
- Sources: [Create/Edit Files](https://help.elvanto.com/hc/en-us/articles/7624969513239-How-to-Create-and-Edit-Files), [File Storage System](https://help.elvanto.com/hc/en-us/articles/7624927931415-How-to-Use-the-File-Storage-System), [Profile Files](https://help.elvanto.com/hc/en-us/articles/10737419867927-Adding-Files-to-Profiles).

### Compose and schedule communications
- From a person profile, group, People View or Advanced Search, admins can compose email only, SMS only (when configured), email+SMS together, or a letter. Recipient panels flag missing email/phone/mailing address and unsubscribed recipients; recipients can be removed. Email/SMS can be scheduled for a future date/time. SMS has a character counter and optional replies; allowing replies disables configured sender ID. Letters can generate address labels and can be filtered to people without a usable email/SMS contact.
- Email templates, sending-from addresses authorized by Access Permissions, default empty messages, required-but-customizable unsubscribe message, shared header/footer, sender signature, and an email archive address can be configured. Email activity is reportable. Email and SMS settings can use scheduled messages.
- Sources: [Compose Email/SMS/Letter](https://help.elvanto.com/hc/en-us/articles/7630552414871-How-to-Compose-an-Email-SMS-or-Letter), [Compose Email or Letter](https://help.elvanto.com/hc/en-us/articles/7630352669975-How-to-Compose-an-Email-or-a-Letter), [Using Email](https://help.elvanto.com/hc/en-us/articles/7501628020247-Using-Email).

### Integrations and API
- Standard integrations are added from Settings > Integrations. Mailchimp integration uses an API key and lets admins select Mailchimp lists/groups for people to subscribe to, with opt-in requirements. API keys can be viewed/regenerated in developer settings; help recommends sharing only with trusted applications. The public demo’s Add Integration route returned Internal Server Error, so available providers and current fields were not directly verified there.
- Official Tithely Giving integration syncs eligible Tithely giving and pledge transactions into Elvanto using an API key, frequency/default fund and error notifications; it does not sync Tithely pledge commitments, events or Tithely Pay. This is documented cross-product capability, not verified in the Elvanto demo.
- Sources: [Elvanto API](https://help.elvanto.com/hc/en-us/articles/7626452924823-How-to-use-the-Elvanto-API), [Mailchimp Integration](https://help.elvanto.com/hc/en-us/articles/7627375246359-How-to-Integrate-Your-Account-With-MailChimp), [Tithely Giving Integration](https://help.elvanto.com/hc/en-us/articles/9558102157463-Tithely-Giving-and-Elvanto-Integration).



## Family records, People import, group chat and event invitations — official workflow detail

### Family records
- Family tab can find existing people (same surname by default; searchable by another name) and add them with built-in relationships: Primary Contact, Spouse, Child, Sibling, Grandfather, Grandmother, Partner, Other. Existing linked family members are carried over when families are merged.
- Admins can add an individual family member or create a whole family with shared baseline contact details, then add individual people and set each relationship. Check-in can add a new person to an existing family or a new family. People can be removed from a family and linked to another one.
- The Member Area can allow family profile edits, restrict editing other family members, and disable adding new family members.
- Sources: [Working with and Editing Families](https://help.elvanto.com/hc/en-us/articles/7481201498903-Working-With-and-Editing-Families), [Member Family Profile Editing](https://help.elvanto.com/hc/en-us/articles/23921436664855-How-a-Member-can-Edit-Family-Profiles).

### People CSV import/update
- People import accepts CSV, date-format selection, column-to-field mapping including custom fields, and overwrite options (do not overwrite existing fields or overwrite only if blank). Duplicate handling can update existing people or skip; matching identifiers can include Elvanto ID/email or legacy ID in a custom field. Import records may include family relationships, marital status, volunteer/contact/archive/deceased flags, and departments/demographics/locations. The demo says imports cannot be performed, so this remains help-documentation detail.
- Sources: [Importing People](https://help.elvanto.com/hc/en-us/articles/7503488972055-Importing-People-into-Elvanto), [Update Profiles via Import](https://help.elvanto.com/hc/en-us/articles/29465019001111-How-to-Update-Profiles-via-Importing).

### Group chat and contact
- My Groups chat sends a message to group members and can notify by email or mobile push; group categories set whether all members or only leaders can post and whether groups appear in Member Area. Members configure notification preferences for group messages.
- Admins can select one or more groups and contact group leaders or members via email/SMS where enabled. Group invitations/registration, leader reporting and attendance are covered in the group workflows above.
- Sources: [Using Group Chat](https://help.elvanto.com/hc/en-us/articles/12215426004631-Using-Group-Chat-In-Elvanto), [Contact Groups](https://help.elvanto.com/hc/en-us/articles/27833289604119-How-to-Contact-Groups).

### Event invitations and registration links
- Event admins can invite individuals, groups or saved People Views to a guest list; send invites immediately or add guests and contact them later. Email/SMS invitations include a registration link when configured; SMS availability depends on an integrated provider. A public event assigned to a Member Area calendar can expose its registration form URL for sharing.
- Sources: [Invite People to an Event](https://help.elvanto.com/hc/en-us/articles/7622440273175-How-to-Invite-People-to-an-Event), [Share Event Registration](https://help.elvanto.com/hc/en-us/articles/22570760122135-How-to-Share-Your-Event-Registration).



## People index and Advanced Search — direct demo inspection

- The People index exposes Add Person, Add Family, Contact People and Export actions; a text search; Advanced Search; saved-view/filter navigation (All People, Volunteers, Contacts, Categories, Groups, Custom); page-size and pagination controls; and list columns for person identity/contact, category and locations. Row-level shortcuts include Activity, Notes, Family and Account & Volunteering. The filter panel groups status (Active, Contacts, Suspended, Archived), locations, demographics, departments and access permissions and offers Search Filters, Clear, Cancel and Save. No people were searched, exported, contacted, or edited.
- Advanced Search combines criteria using All, Any, or custom Advanced logic. Criteria can be added and removed; the criterion field picker is searchable and divided into categories. Observed filter categories and criteria include: Person Details (date added, names, people category, archived/contact/deceased flags, gender, birth/anniversary dates or months, age, marital status, notes, directory); Contact Details (email/phone/mobile and email/SMS preferences); Assets (access permissions, departments/department leader positions, demographics, locations, service types); Groups (membership, status, category, department, demographic, location); People Flows (flow and flow step); Account Details (volunteer, status, username, last login); Address (mailing and home address, line 2, city, state, zip and country); Family (members, relationship, parents and parent-with-children criteria including gender, demographic, location, group and school grade); Children (school grade, development, special needs, security code); Attendance (attended/did not attend a service or group, with combined or separate service/group criteria); Financial (receipt name, giving number, transaction amount); and Custom Fields (demo examples included allergies, background-check fields, baptism date and a custom field).
- The observed date criterion offered Equals, Does Not Equal, Is After, Is Before, Is In The Last, Is Not In The Last, Is Between, Is In The Next and Is Not In The Next. Available operators depend on field type; other field operators were not exhaustively opened.
- Results can have custom display fields chosen from categorized available fields, a removable/reorderable Display Fields list, one primary and one secondary sort field, and ascending/descending order for each, then Search. The default output displayed photo, full name, email, mobile, phone, people category and locations. Search was not run and no view was saved.
- Sources: [People index and Advanced Search in the public demo](https://demo.elvanto.com/admin/people/advanced_search/?from_new=1), [official Advanced Search help](https://help.elvanto.com/hc/en-us/articles/7481393959319-Advanced-People-Search).

## Settings index and access limitation — direct demo inspection

- The Settings index grouped visible destinations under General (Account, Legal & Compliance, Communication, Occasion Messages, Sending Domains, Scheduled Email & SMS), Users (Super Admins, Access Permissions, Passwords & Security), Customization (Formatting, Built-in Contact Templates, Layouts, Sidebars), Features (People, Groups, Group Finder, Services, Volunteers/Roster, Songs, Check-in/Label Printing/Styles, Events, Calendar, Financial/Giving Statement Templates, Posts, Member Directory/Layout, Departments, Demographics, Locations, Assets/Asset Categories, Note Categories, Needs/Need Types) and Developers (Integrations).
- The Legal & Compliance destination rendered an access-denied message even under the demo Admin persona. Needs settings showed Reminders and Need Types; reminder settings expose a “Send Email Reminders?” control and Save. Need Types provides Add a Need Type and existing type entries. Settings controls were inspected without changing or saving them.
- Source: [Settings index in the public demo](https://demo.elvanto.com/admin/settings-new).



## Forms, check-in printing and report delivery — official Help Center additions

- Forms can be standard or event-registration forms, linked or embedded on a website/page/post. They accept person/custom fields, may update profiles automatically or require approval, and approval can add a person to a group or People Flow. Event forms support tickets, discounts and payment methods; submissions can be accessed/exported. Editing fields can retroactively change/remove prior submission data. Sources: [Forms Overview](https://help.elvanto.com/hc/en-us/articles/7482338373783-Forms-Overview), [Using Forms](https://help.elvanto.com/hc/en-us/articles/7580810756503-Using-Forms).
- Label printing can be disabled or set to manual/automatic for children, volunteers or all check-ins, with optional parent pickup labels. Manual mode prints selected/all labels before Finish and Print; automatic prints at completion. Mobile/tablet check-in can route labels through named print stations connected to DYMO software; multiple stations/printers can serve rooms. Quick barcode check-in auto-checks in when only one service/room applies and asks for selection when there are several. Sources: [Manual vs. Automatic Label Printing](https://help.elvanto.com/hc/en-us/articles/21354170091031-Manual-vs-Automatic-Label-Printing), [Print Stations](https://help.elvanto.com/hc/en-us/articles/7621894883863-Using-Print-Stations-for-Mobile-and-Tablet-Printing), [Barcode Scanner Check-in](https://help.elvanto.com/hc/en-us/articles/19068834242839-How-to-use-a-Barcode-Scanner-with-Check-in).
- Standard reports allow criteria and named-user sharing (optionally view/export only) and export to CSV/PDF. Comprehensive reports combine built-in/standard reports, text and images and export to PDF. Scheduled reports support weekly, biweekly, monthly, quarterly, every six months or yearly delivery, start date/time, recipients and optional message. Recipients gain access even to private reports; Super Admins can view all scheduled report emails. Sources: [Use Reports](https://help.elvanto.com/hc/en-us/articles/7622122691479-How-to-use-Reports), [Generate Comprehensive Report](https://help.elvanto.com/hc/en-us/articles/7622234586391-How-to-Generate-a-Comprehensive-Report), [Schedule Reports](https://help.elvanto.com/hc/en-us/articles/7622335970839-How-to-Automatically-Email-Reports), [Share Reports](https://help.elvanto.com/hc/en-us/articles/7622315223319-How-to-Share-Custom-Reports).

Continuation of [#67 — Elvanto complete functionality inventory](https://github.com/juristoeckli/smart-Church/issues/67), [#68 — continuation 2](https://github.com/juristoeckli/smart-Church/issues/68), and [#69 — continuation 3](https://github.com/juristoeckli/smart-Church/issues/69), which is at GitHub's issue-body limit. The consolidated working inventory is `docs/ELVANTO_FUNCTION_INVENTORY.md`. Continue appending verified workflows and distinguish direct demo observations from official Help Center coverage.

## Member Area pages and navigation — official Help Center

- Pages hold static content, while Posts are the dynamic/urgent update surface. Page access can allow members and/or guests, with lockdown areas restricting visibility. Pages may be added to Member Area navigation, made sticky, and include embedded forms/files.
- Menu Editor can add built-in features, pages, categories, files or custom URLs; items can be reordered by drag/drop and nested by indentation to two submenu levels. Menu visibility follows user permissions and lockdowns.
- Sources: [Add a Page to Member Area](https://help.elvanto.com/hc/en-us/articles/7624845651863-How-to-add-a-Page-to-the-Member-Area), [Modify the Navigation Menu](https://help.elvanto.com/hc/en-us/articles/7625675051543-How-to-Modify-the-Navigation-Menu), [Posts and Pages Help](https://help.elvanto.com/hc/en-us/sections/6656332645527-Posts-and-Pages).

## Report exports, scheduling and sharing — additional official detail

- Standard reports have configurable criteria and sharing to named users, optionally limiting those users to view/export; CSV/PDF export is available. Comprehensive reports combine built-in reports, standard reports, text and images and export as PDF. Built-in report options depend on the selected report and may include date filters, report types, locations, additional people columns and output formats.
- Scheduled report frequency can be weekly, biweekly, monthly, every 3 months, every 6 months or yearly, with start date/time, recipients and an optional plain-text message. Scheduled recipients gain access even when the report is private; Super Admins can view all scheduled report email entries.
- Sources: [Use Reports](https://help.elvanto.com/hc/en-us/articles/7622122691479-How-to-use-Reports), [Generate Comprehensive Report](https://help.elvanto.com/hc/en-us/articles/7622234586391-How-to-Generate-a-Comprehensive-Report), [Schedule Reports](https://help.elvanto.com/hc/en-us/articles/7622335970839-How-to-Automatically-Email-Reports), [Share Reports](https://help.elvanto.com/hc/en-us/articles/7622315223319-How-to-Share-Custom-Reports).

## Remaining audit notes

- Official Help Center pages are documentation evidence; they do not prove every option exists in the currently rendered demo/account. Earlier inventory entries explicitly identify demo errors, disabled writes, unavailable permissions and documentation-only capabilities.
- Continue searching and inspecting the demo's remaining modules and settings pages. Do not treat the inventory as exhaustive until each module/page and its nested actions have been covered or recorded as inaccessible/unverified.



## Forms, Posts, Pages and Links — directly observed in the Admin demo

### Forms index and new-form dialog
- Forms index offers Create Form; search; All Forms view; filters for Published/Unpublished and Standard/Event Registration; a 20-item page-size control, pagination, table/list presentation and a Name/Category table. Each form exposes Edit, Duplicate and public View actions. The Create Form dialog asks for a name and Standard or Registration type. No form was created, edited, duplicated, opened for submissions, or submitted.
- Source: [Forms in the public demo](https://demo.elvanto.com/admin/forms/).

### Posts index and editor
- Posts index offers Add Post, search, All Posts view, Published filter, page size, pagination and card/list presentation. Table columns are title, author, categories, comment count and date.
- Post editor includes title/permalink, rich-text content tools (formatting, alignment, lists, indentation, block quote, links/unlink, images, anchors, insert-more break, format/font/size/color, underline/strike, tables, external media, special characters, paste options, spellcheck, maximize, source), file attachment, publish date/time, Published/Draft status, categories, author, tags, comments toggle and expiry date/time.
- Posts can be locked down by departments, locations, demographics, groups and access-permission sets. The add form was inspected but not saved.
- Source: [Posts editor in the public demo](https://demo.elvanto.com/admin/posts/post/).

### Pages index and editor
- Pages index offers Add Page, search, Published filter, page size, pagination and card/list presentation; columns include title, author, access and Member Area location. The editor provides title/permalink and rich-text content with the same broad formatting/media/file attachment tools as Posts.
- Page details include Published/Draft, expiration date/time, and placement either in Member Area navigation or on the Member Area home page. Lockdowns can target departments, locations, demographics, groups and access-permission sets. The blank add form was inspected only; no page was saved.
- Source: [Pages editor in the public demo](https://demo.elvanto.com/admin/pages/page/).

### Links index and editor
- Links index offers Add Link, search, Published filter, sort, card/list presentation and category display; records expose their URL and an individual Delete action.
- Link editor fields are name, Published/Hidden status, URL, and category membership. If no category is selected, the link appears directly under the Member Area Links dropdown; otherwise it appears under a category. The blank form was inspected only and not saved.
- Source: [Links editor in the public demo](https://demo.elvanto.com/admin/links/link/).

## Demo inspection boundary
- Direct demo inspection is account-specific and read-only in this inventory: create/edit forms were inspected without saving; list rows and submissions were not exported or modified. Help Center docs supplement the page-level UI where demo workflows are unavailable.



## Email design editor, two-way SMS and content lockdown logic — official documentation

- Design Email Editor has three work areas: Content blocks (columns, buttons, divider, heading, text, image, menu, custom HTML), prebuilt Blocks/layouts, and Body settings. Body controls include default text/background colors, content width/alignment, font family, preheader text and hyperlink color/underline. Email images are compressed during sending.
- SMS integrations support everyday person messages and volunteer schedule confirmations. Recipients may reply Yes/No to confirm/decline; non-Yes/No replies are emailed to the original sender. Sender ID cannot accept replies, so enabling replies uses a reply-capable number. Two-way replies can ambiguously update the most recent service when volunteers have multiple schedules and cannot distinguish family members sharing a number. Providers documented include BulkSMS, Inspirus, Next Digital, SMSBroadcast, Twilio and ViaNettSMS; provider availability may vary by region/account.
- Page, Post and File lockdowns use combined AND/OR logic: multiple dimensions (departments, locations, demographics, groups, access permissions) each must meet their configured rules, while multiple choices within a dimension can be alternatives. Items inherit restrictions from their parent folder/category; users must satisfy both parent and item restrictions.
- Sources: [Design Email Editor](https://help.elvanto.com/hc/en-us/articles/24800660300823-Getting-Familiar-With-the-Design-Email-Editor), [Getting Started with SMS](https://help.elvanto.com/hc/en-us/articles/8741261705111-Getting-Started-with-SMS-in-Elvanto), [Two-Way SMS](https://help.elvanto.com/hc/en-us/articles/7630491060119-Information-About-Using-2-way-SMS-Messaging), [File Lockdowns](https://help.elvanto.com/hc/en-us/articles/7624983869719-How-File-Lockdowns-Work).



## Emails & Letters templates — directly observed in demo

- Emails & Letters index exposes Add Design Template and Add Standard Template, search, Active filter, sort, page size and duplicate actions. Seed records distinguish Standard Email Format from Design Email Format.
- Blank Design Template setup first presents a searchable gallery of built-in layouts and a Blank option, each with Preview; selecting one enables Next. On the blank editor page, the email builder frame remained a loading spinner and Save Template was disabled, so content-building controls could not be verified in the demo. No template was saved.
- Standard Email & Letter editor fields: name; Active/Inactive status; From address chosen from account/admin address, the sender's address, or a custom address; subject; separate rich-text email message and printable letter body; Insert Field for merge placeholders; and file attachments. Both rich-text editors support formatting, alignment, lists, indentation, quotes, links, images, size/font/color, tables, special characters, paste options, spellcheck, source and maximize controls. Printed letters also expose font family, font size and four page margins.
- Standard templates can be restricted by departments, locations, demographics, groups and Access Permissions. No template was saved or sent.
- Sources: [Emails & Letters index](https://demo.elvanto.com/admin/emails/), [Standard template editor](https://demo.elvanto.com/admin/emails/email/), [Design template picker](https://demo.elvanto.com/admin/emails/templates).



## Account-wide controls, dashboard, sidebars and subscription — official Help Center

- Dashboard is user-customizable: add/remove widgets, rename/recolor, reorder and position them. Documented widgets include Profile, Service Statistics, Notifications for People Flows/Notes, Songs to Learn, post Comments needing approval, Upcoming Events, My Groups and Upcoming Roster. Widget availability follows the user's admin permissions.
- Account settings include organization country, default time zone (used for scheduled groups, events, services, etc.) and account display language. Formatting separately configures date and time formats. Documentation lists multiple localized variants; incomplete translations are marked as such.
- Sidebars can be created with title/content and optional file attachment, assigned by locations/departments (no assignment means everyone), edited, and reordered via Sort/drag-and-drop.
- Personal 2FA setup uses an authenticator app, QR pairing, verification code and backup codes; users can deactivate their own 2FA when allowed. Super Admins can disable 2FA for a locked-out account. Account-wide/permission-based 2FA can be required, and access-recovery documentation describes restoring it after device loss.
- Billing & Plan access is separately permissioned. Documented account functions include edit billing contacts, add billing contacts, change plan, change monthly/annual frequency, update payment details, view past invoices and cancel account. This is documentation-only here; no billing area or financial action was opened. Downgrades may deactivate active profiles above the new plan limit.
- Sources: [Customize Dashboard](https://help.elvanto.com/hc/en-us/articles/19208177151127-How-to-Customize-Your-Elvanto-Dashboard), [Account Time Zone and Language](https://help.elvanto.com/hc/en-us/articles/22894471110679-Setting-up-your-Account-Time-Zone-and-Language), [Date and Time Formatting](https://help.elvanto.com/hc/en-us/articles/7625895672215-Change-Your-Date-and-Time-Format), [Sidebar Items](https://help.elvanto.com/hc/en-us/articles/7625801488279-How-to-Add-Sidebar-Items), [Personal 2FA](https://help.elvanto.com/hc/en-us/articles/7625157352983-Enabling-2FA-in-your-Personal-Elvanto-Account), [Billing and Subscriptions](https://help.elvanto.com/hc/en-us/articles/7626702266135-Billing-and-Subscriptions-in-Elvanto).



## Forms — builder, submission handling and event attendance details

- Form builder supports drag/drop field and question ordering, custom styling/colors, People fields, category-specific People Custom Fields, form-specific custom fields with configurable types, and conditional questions/headings based on earlier answers. Registration forms can link an event; standard forms can also collect event attendance without ticketing/payments, allow multiple submissions or limit one per event, autofill prior user data, constrain eligible event dates, and require admin approval before adding guests.
- Database update behavior can be disabled, automatic, or admin-approved; auto-add/update creates records in a default category unless actions override it and requires a built-in email field for matching/addition. Form actions can include automatic follow-up tasks such as adding a group member or starting a People Flow step. Standard forms can have autoresponders (not when multiple submissions are allowed). Forms can be unpublished, archived, or closed by reaching submission limits. Forms can be organized into categories.
- Submissions tab supports review, approval, archive/restore (including bulk archive/restore via Mass Manage), and export. Logged-in-user submissions are documented as auto-approved. The demo's submissions were not opened, exported, changed or archived.
- Sources: [Create and Edit Forms](https://help.elvanto.com/hc/en-us/articles/7624431623063-How-to-Create-and-Edit-a-Form), [Event Attendance with Standard Forms](https://help.elvanto.com/hc/en-us/articles/18018181840407-Recording-Event-Attendance-using-Standard-Form), [Access/Export Form Submissions](https://help.elvanto.com/hc/en-us/articles/7624498763031-How-to-Access-and-Export-Form-Submissions).



## People Categories, profile layouts, People settings and custom fields — official detail

- People Categories are mutually exclusive organizational categories (one per person), distinct from Active/Contact/Suspended/Archived status. Each category has Admin Area and Member Area profile layouts. Category layouts can be viewed, copied to other categories or duplicated; drag/drop changes field order/visibility, and Display Fields controls People-list columns. Field-level settings can set global/category access, required status and copy access to other categories; some built-in fields are fixed. My Profile layout separately configures what members can see/edit, with per-field edit/view-only controls.
- Category custom fields can define field name/type, visibility/edit permissions and whether editable on check-in, and can be placed into the category layout. Custom fields can also supply fields for reporting/People Views; check-in custom fields must be enabled per field.
- People settings cover default category and address; preferred/first/full-legal name display, sort order and middle-name initial; whether members may remove DOB/anniversary year; show/hide completed flows in Member Area; guest registration and default permission, optional required Location/Department selections, guest access to Posts/Pages; registration/unsubscribe notification email recipients; scheduled-note email notifications; include archived people in global search; default People list fields; location-specific family-admin notifications for adding an existing person; family contact breakdown and family category-change defaults; controls to restrict family editing in My Family; school grade fields and yearly progression date; demographic auto-assignment behavior; and archive reason requirement with predefined/custom reasons.
- Duplicate management supports field-by-field merge, choosing the primary record, preserving primary values on conflicts, marked-not-duplicate records and restoring them to the queue. Successful merges cannot be undone per official documentation.
- Sources: [People Categories](https://help.elvanto.com/hc/en-us/articles/7481235303703-People-Categories), [Category Layouts](https://help.elvanto.com/hc/en-us/articles/7596420353559-Using-and-Customizing-People-Category-Layouts), [People Settings](https://help.elvanto.com/hc/en-us/articles/7499823513495-People-Settings), [Custom Fields](https://help.elvanto.com/hc/en-us/articles/7596515603095-Creating-and-Editing-Custom-Fields-in-Elvanto), [Merging Duplicate People](https://help.elvanto.com/hc/en-us/articles/7597336832151-How-to-merge-Duplicate-People-in-Elvanto).



## Dashboard — direct demo inspection

- Dashboard widgets can be individually edited, removed, and reordered while in Edit Dashboard. Add Widget dialog lists Profile, Service Statistics, Notifications, Songs to Learn, Comments, Upcoming Events, My Groups and Upcoming Roster. The dashboard also has Finish Editing; widgets with data can expose their own controls (for example, Notifications has Filters and pending group requests link to a full list). Demo sample notifications/data were not recorded here.
- The current sample dashboard included notification, attendance, people-category and service-statistics cards, Upcoming Events, Comments, Profile and Songs to Learn. No widget was added, edited or removed; Edit Dashboard was only opened to inspect available controls.
- Source: [Dashboard in the public demo](https://demo.elvanto.com/admin/).



## Member Area — direct page and navigation inspection

- Public Member Area menu in the demo: Home, Roster, Group Finder, My Groups, My Giving, Needs, Calendar, Member Directory, Links dropdown, Unavailability and Get Help. Profile sidebar sections are Edit Profile, Profile Picture, Privacy Settings, Giving, Family, Groups, Needs, Communication Preferences, Roster, Unavailability, Google social login linking and Two Factor Authentication. Menu visibility can vary by permission/layout.
- Roster page has an upcoming-service date/service list, Change control for the service selection, Subscribe, Edit and LIVE links where allowed, Print, Volunteers and Plan tabs, and Other Times for rehearsal/service times. Sample schedule/person data was not copied. No volunteer action was taken.
- Group Finder shows map and group cards, a page-size selector (12/24/48/108/500), count/range, and a Filters panel with searchable filters; the visible demo offered demographics and locations. Map controls include fullscreen, zoom and map-camera controls. Filters were inspected without selecting/saving them; sample group names and member data were not recorded.
- Member Calendar offers Subscribe, View Admin Calendar, previous/next and Today navigation, and Day/Week/Month views on a time-grid calendar; entries link to service/group events.
- Member Needs page has Assigned to Me, Unassigned and Completed views; need cards display type, due date, location and status. No need was opened, accepted or completed.
- Source: [Member Area in the public demo](https://demo.elvanto.com/).

## Member profile preferences and unavailability — direct demo inspection

- The Member Area Unavailability page provides a request form with start and end dates, time selection (All Day, Start Of Day and hourly choices through 23:00, including Noon), repeat options (Do Not Repeat, Daily, Weekly, Monthly by day, Monthly by week, Yearly), location selection, a reason field, Add and Submit controls, and a list area for existing entries. This was observed only; no request was added or submitted.
- Communication Preferences includes a custom Email Signature rich-text editor (bold/italic, alignment, numbered/bulleted lists, indent, quote, link/unlink, image, font/size/format/color, underline/strike, table, external media, special characters, paste modes, remove formatting, spellcheck, maximize, undo/redo, source). Email opt-outs separately cover general and service-scheduling emails; SMS opt-outs separately cover general and service-scheduling SMS. A Save button is present; no preference was changed or saved.
- Privacy Settings explains that each field can be toggled visible/hidden for Member Directory and Groups; visibility states are described as green (shown) and gray (hidden). No privacy control was toggled.
- Source: [Member profile and unavailability in the public demo](https://demo.elvanto.com/profile/unavailability/).
## Demo access roles and settings catalog — direct demo inspection

- After logging out, the demo login page offers Super Admin, Group Leader and Member / Volunteer entry buttons. Selecting Super Admin returns to the Admin dashboard. The session used for inspection was switched this way at the user's direction; no account data was changed.
- Settings landing page has a searchable catalog grouped as follows:
  - General: Account; Legal & Compliance; Communication (with Occasion Messages and Sending Domains subpages); Scheduled Email & SMS.
  - Users: Super Admins; Access Permissions; Passwords & Security.
  - Customization: Formatting; Built-in Contact Templates; Layouts; Sidebars.
  - Features: People; Groups; Group Finder; Services (with Volunteers and Roster subpages); Songs; Check-in (with Label Printing and Styles); Events; Calendar; Financial (with Giving Statement Templates); Posts; Member Directory (with Layout); Departments; Demographics; Locations; Assets (with Asset Categories); Note Categories; Needs (with Need Types).
  - Developers: Integrations.
- Legal & Compliance URL was listed in Settings but displayed “You do not have access to this item” in the Super Admin demo session; functionality remains unverified. No compliance setting was changed.
- Source: [Settings in the public demo](https://demo.elvanto.com/admin/settings/).

## People index and create flows — direct Super Admin demo inspection

- People index has Add Person, Add Family, Contact People and Export actions; global search; Advanced Search; View All People and Filters / Views; page-size selector, result count and page navigation. The index's visible columns include Full Name, Email Address, Mobile Number, Phone Number, People Category and Locations. Row-level shortcuts include the profile, Activity, Notes, Family, and Account & Volunteering. No rows were opened or exported.
- Add Person first asks the administrator to choose a People Category, then presents a category-specific form. The observed form sections include Personal Information (name, email/phone, email/SMS communication opt-outs, gender, birth date, allergies, school grade, marital status, anniversary, receipt name, giving number, check-in security code, baptism date and Access Permissions); Home Address and Mailing Address with Copy to Mailing Address; Locations; Demographics; Background Checks; Volunteer status/account credentials/login email; Reports To and Departments; Add to Group and Add to People Flow. The person form's Save action was not used.
- Add Family also begins with People Category selection, then uses a multi-step flow. Its first step asks for a family surname and shared contact information and home address, with a Next control; the prompt says individual member contact details can be set in the following step. The flow was not advanced or saved.
- Source: [People in the public demo](https://demo.elvanto.com/admin/people/).
## Groups index and group setup — direct Super Admin demo inspection

- Groups index provides Add Group and Contact Groups; search; saved-view selection; Active status filter; card/list presentation; page-size and result count; sorting/selection controls; and group rows with Edit, Activity, Notes and Reporting shortcuts. Table columns include name, categories, locations, meeting schedule/start date, address and member count. No group was opened, selected or contacted.
- The blank Add Group form includes name, Active/Archived status, rich-text description, categories, department assignments, demographic targeting, location assignment, meeting address, digital meeting link, group start date, start/end times, Weekly/Monthly recurrence, optional group end date, Group Finder Open/Closed status, and member-count limit (0 means unlimited). Save was not used.
- Source: [Groups in the public demo](https://demo.elvanto.com/admin/groups/).

## Access Permissions editor and inaccessible settings — direct Super Admin demo inspection

- Access Permissions index exposes Add Access Permission, View Full List, card/list display, record count, and per-record Print controls.
- The blank permission editor asks for a name and access areas for Admin Area and Member Area. Admin Area section list: People, Groups, Services, Songs, Check-in, Reports, Calendar, Events, Forms, Needs, Financial, Emails & Letters, Files, Posts, Pages, Links, Settings, Billing & Plan, Lockdown Areas, Communication. Member Area list: Roster, Needs, Songs, Links, Unavailability, Pages, Sidebars, Files, Member Directory, Calendar. The page describes selecting areas to grant; module-specific controls appear beneath the sections. The editor was not changed or saved.
- Account, Legal & Compliance, Passwords & Security and Sidebars settings URLs were attempted while in the Super Admin demo session. The demo displayed “You do not have access to this item” (Account and Legal/Security) or returned to Dashboard (Sidebars); their page controls could not be verified. The Settings landing catalog lists each of them, but they remain incomplete demo coverage.
- Sources: [Access Permissions in the public demo](https://demo.elvanto.com/admin/settings/access/), [Settings in the public demo](https://demo.elvanto.com/admin/settings/).
## Member / Volunteer demo role — direct inspection

- The demo login page's Member / Volunteer entry returns to Member Area Home. In this role, the top navigation observed was Home, Roster, Group Finder, My Giving, Needs, Calendar, Member Directory, Links, Unavailability and Get Help. The admin-session navigation also exposed My Groups; navigation varies with the selected role/account.
- Home renders Member Area Posts and an Upcoming Events panel with a View Full Calendar link. Personal profile sidebar has Edit Profile, Profile Picture, Privacy Settings, Giving, Family, Needs and Communication Preferences; volunteering links are Roster and Unavailability; separate sections link Google login and Two Factor Authentication.
- Edit Profile sections shown to the signed-in user include Your Information, Home Address, Mailing Address (Copy to/from Home Address controls), Country and Timezone, and Log In Details, with Save. No profile values were recorded or changed.
- Member / Volunteer Roster exposes Subscribe; Upcoming Services list and service links; service detail with Volunteers and Plan tabs; and Other Times. No accept/decline control was visible on the inspected roster screen. No roster action was taken.
- Source: [Member / Volunteer area in the public demo](https://demo.elvanto.com/).
## Needs administration — direct Super Admin demo inspection

- Admin All Needs page has an Add action, a status filter, cards showing need type/date/location/status/assigned member, page-size choices 10/20/50/100/500, result count and pagination.
- The blank Add New Need drawer contains Need Name, Type, rich-text Description, Due Date, Location, Status and Assigned Member, with Save and Cancel. No need was created or changed.
- Source: [Needs administration in the public demo](https://demo.elvanto.com/admin/needs/).

## Events — direct demo inspection limits

- Events index exposes Add Event, search, saved-view selection and Filter controls, initially on Upcoming (4 Months). The Add Event route returned an Internal Server Error, so its fields and create workflow remain unverified in the demo. No event was created.
- Source: [Events in the public demo](https://demo.elvanto.com/admin/events/).
## Service creation and service list — direct Super Admin demo inspection

- Services list is initially on Upcoming Services, with Add, Edit Multiple, Search View, saved-view selection, Published filter, page-size control, card/list switch, date/location/service-type columns, and row links to service detail, Plan, Volunteers, Reporting, Check-in, Live and Print.
- Add Service form begins with Location and a predefined Service Type (which fills name and times) or None; Name and Date(s) supports publish yes/no, date-row add/remove and Bulk Add. Times allow a named service time and start/end time with add/remove. Other Times allow a name, Rehearsal/Other type, start/end time, and Same Day/Days Before/Days After relative to service. Save and Save & Edit are available; no service was created.
- Source: [Services in the public demo](https://demo.elvanto.com/admin/services/).

## Song creation and library — direct Super Admin demo inspection

- Songs library provides Add Song, Export, CCLI Reporting, search, Published filter, page size, card/list switch and pagination.
- Add Song fields include name, CCLI number, artist, album, Published/Archived status, Song/Item type, Song To Learn, Allow Downloads, categories, locations, and arrangement details. Arrangement fields include name, length (minutes/seconds), BPM, starting key and Major/Minor mode, plus ending key and Major/Minor mode. The page showed a SongSelect integration notice and setup/help links. No song was saved or exported.
- Source: [Songs in the public demo](https://demo.elvanto.com/admin/songs/).

## Check-in station — direct Super Admin demo inspection

- Check-in page exposes Add Person or Family, Self Check-In, Start Print Station and Print Test Label. Settings include service/room selectors and a Rooms panel with Edit and room links. Check-in Activity includes Search by Name, a search box, Filter, Last Name ordering, A–Z letter shortcuts and a Confirm control. No person was checked in, no station launched and no labels printed.
- Source: [Check-in in the public demo](https://demo.elvanto.com/admin/checkin/).
## Admin Calendar — direct Super Admin demo inspection

- Calendar view has Add Event, Add Calendar, Subscribe and Embed. Calendar selector has Select All/Deselect All; managed calendars have per-calendar visibility, Edit and Delete controls. Other Calendars include People Notes, Group Notes, Services and Groups.
- Calendar grid has previous/next and Today navigation, Day/Week/Month modes, and an all-day plus hourly time grid. Filters cover event status (Public/Private/Draft), Locations and Assets, with Clear Filters and Apply. Filters were viewed but not applied.
- Add Calendar dialog includes name, status, hexadecimal color, whether to show it in Member Area Calendar, optional Google Calendar ID integration, and location/department lockdowns. No calendar was saved.
- Embed dialog lets an admin select calendars and built-in Services/Groups calendars, choose output type (Calendar or Upcoming Events List), display mode (Day/Week/Month), start day (Sunday/Monday), and locations. It generates a share link, JavaScript snippet or iframe code. No embed was copied or published.
- Source: [Calendar in the public demo](https://demo.elvanto.com/admin/calendar/).

## Additional check-in session settings — direct demo details

- Check-in Settings include population scope (Children Only / Volunteers Only / All People), whether Archived people are included in searches (Yes/No), and Label Printer Software (Account Default, DYMO Label App or Dymo Connect). No settings were changed.
- Source: [Check-in in the public demo](https://demo.elvanto.com/admin/checkin/).
## Files library, upload and folder controls — direct Super Admin demo inspection

- Files library exposes Add File, Add Folder, search, saved-view selection, Published filter, storage usage/quota meter, page-size, card/list switch and pagination. Table columns include name, date added, file sizes/version sizes, total size and file access. Each row can expose Open File and Versions. No file was opened, downloaded or changed.
- Add File form supports up to 50 files at a time and displays a 40 MB maximum file size. Details include Published/Draft status, notes and expiration date/time; folder placement; audience access choices (specified people, lockdown-based, Members & guests, members only, guests only); and lockdown dimensions for departments, locations, demographics, groups and Access Permissions. Upload was not started and no file was selected.
- Add Folder form includes name, audience access choices matching files, and the same lockdown dimensions. Folder restrictions apply to files inside it; an unrestricted folder makes contents visible to everyone who has its link. No folder was saved.
- Source: [Files in the public demo](https://demo.elvanto.com/admin/files/).
## Asset bookings and asset categories — direct Super Admin demo inspection

- Asset setup fields include name, archive option, one or more categories, locations, administrators to notify, notification/approval mode (No, Yes, or Yes with approval required), required time between bookings before/after, and custom approval/decline email messages. No asset was created.
- Asset Categories page supports Add, Change Order, opening/editing a category and Delete. Add Category form contains a name field and Save. No category was created, reordered or deleted.
- Source: [Assets settings in the public demo](https://demo.elvanto.com/admin/settings/assets/).

## Integrations page — direct demo limitation

- Integrations Settings shows no integrations configured and a notice that some settings cannot be saved in the demo account. The Add control opened a loading dialog and then an Internal Server Error, so integration types and setup fields could not be verified. No integration was created.
- Source: [Integrations settings in the public demo](https://demo.elvanto.com/admin/settings/integrations/).
## Contact People and bulk letter composers — direct Super Admin demo inspection

- Contact People dialog offers separate Send Email or SMS and Send a Letter workflows. Email/SMS mode provides Both Email & SMS, Email Only and SMS Only choices; a recipient search/add field, eligible-recipient list with channel-availability icons, pagination/count, Cancel and Send. The composer initially showed eligible recipients based on the People index; no message was sent and no recipient details were copied.
- Letter mode provides template selection, Print a letter for selection, a rich-text message editor with merge-field controls, Insert File from Files Area, an eligible-recipient list/search/add/pagination and Generate Letter / Generate Address Labels. No letter or labels were generated.
- Source: [People contact workflow in the public demo](https://demo.elvanto.com/admin/people/).
## Member Giving and Family profile pages — direct Member / Volunteer demo inspection

- Member Giving opens from the Member Area navigation/profile sidebar. The demo account's page showed a Giving heading but no visible statement, contribution or transaction controls, so member giving actions could not be verified in this account. No balances, donation amounts, dates or transactions were inspected or recorded.
- Family profile opens from the profile sidebar. In the inspected Member / Volunteer account it showed a Family heading but no visible form controls or actions. Family data was not opened or copied.
- Source: [Member profile in the public demo](https://demo.elvanto.com/profile/giving/).
## Member Family add flow and Need Types/Reminders settings — direct demo inspection

- Member Family page provides Add Family Member. The blank first step is New Family Member Details with two text fields, a role/category selector defaulted to Member / Volunteer, and Next. No family member was entered or added.
- Admin Needs settings has Reminders and Need Types tabs. Reminders page exposes a Send Email Reminders? control and Save. Need Types page lists name/description rows with edit/delete controls and Add a Need Type; add opens an inline row with name and description fields and save/cancel controls. No reminder setting or need type was changed.
- Super Admins settings URL was attempted from the Super Admin demo session but returned to Dashboard with an access error; its controls remain unverified.
- Sources: [Family in the public demo](https://demo.elvanto.com/profile/family/), [Needs settings in the public demo](https://demo.elvanto.com/admin/settings/needs/).
## Layouts and Member Area Menu Editor — direct Super Admin demo inspection

- Layouts index supports Add and per-layout Menu Editor. The demo states layout changes cannot be saved. Add Layout fields include internal layout name, Site Name, department assignment for limiting content to unauthenticated viewers, custom Elvanto subdomain and optional custom domain.
- Member Area appearance settings include logo, header background image, background repeat mode (none/repeat/horizontal/vertical), header color, header height (minimum 80 px), navigation background/text colors; Admin Area logo/color; login-page style (Custom / Same as Member Area / Same as Admin Area), logo/color; post-logout redirect URL; and iOS home-screen PNG icon. No images were uploaded and no layout saved.
- Menu Editor has Built-in navigation items including Home, Roster, Songs, Calendar, Member Directory, Group Finder, My Groups, My Giving, Links, Unavailability, Volunteer Preferences and Needs; addable categories include Custom Links, Pages, Post Categories and Links. Custom Links use URL plus Label fields. Structure shows existing menu rows with reorder handles and per-row controls, Add to Menu and Save. No menu structure was changed or saved.
- Source: [Layouts and Menu Editor in the public demo](https://demo.elvanto.com/admin/settings/customize/).

## Remaining Menu Editor link source — direct Super Admin demo inspection

- The Menu Editor's separate Links source lists the Elvanto and Google link providers, each addable as a menu item. No link was added and the menu was not saved.
- Source: [Menu Editor in the public demo](https://demo.elvanto.com/admin/settings/customize/layout-menu/).

## Reports — standard and comprehensive custom report builders — direct Super Admin demo inspection

- Reports index has Add Standard Report and Add Comprehensive Report, search, All Reports view selector, page-size control, card/list presentation, selectable rows, and a table showing name/category/description/created/modified metadata. Per-report actions include Edit, Sharing, Email, Duplicate and Export; these actions were observed without opening/sending/exporting existing reports.
- Standard report editor asks for name, description and category and lets the report serve as a Report, a People View or both. Filter criteria can display Individuals or Families; combine rules by All, Any or Advanced custom logic; and add/remove field-based filter rows. The default builder has an available-field catalog organized into people/contact/assets/groups/account/address/family/children/financial/custom-field areas, with search and add controls.
- Selected display fields can be added, reordered and removed separately for Report results and People View results; each output has up to two sort-field/direction controls. Actions are Save or Save & Generate. Nothing was saved or generated.
- Comprehensive report setup asks for name, description and category, then offers Save. Its composition editor did not expose further controls until a report is created, so content-block options remain unverified directly in this demo.
- Source: [Reports in the public demo](https://demo.elvanto.com/admin/reports/).

## Financial — batches, transactions and pledges — direct Super Admin demo inspection

- The Financial area has three views: Batches, Transactions and Pledges, plus search, date-range filter, total summary, 20-row page-size control, card/list presentation and paginated selectable tables. Batch records offer Open and Edit controls; data rows contain financial details, which were not copied into this inventory.
- Add Batch opens a form with name, Open/Closed status, date and a Transferred? checkbox, with Cancel and Save. It was left blank and closed without saving.
- Add Transaction form includes batch selection (including create-new-batch), transaction date, person search by name or giving number, option to create a new person, transaction method, account/subaccount and amount lines, pledge selection, memo and tax-deductible flag. It was not filled or saved.
- Transactions table columns are person, amount, paid-by method, date and batch. Pledges table columns are person(s), amount, start/end dates and account/subaccount. The demo's records contain identifiable and financial information, so individual names, amounts, dates and entries are intentionally omitted.
- The Add Pledge form was not inspected yet. No financial record was created, edited, deleted or exported.
- Source: [Financial in the public demo](https://demo.elvanto.com/admin/financial/).

## Volunteer Preferences — official Help Center workflow details

- Members can set how many services they can serve per month and per day and how often they wish to serve by department. Administrators can edit preferences from a person's profile. Service scheduling uses preferences alongside unavailability when flagging suitability; administrators retain discretion to schedule volunteers outside a preference.
- Service settings can determine whether each service time counts as a separate service for preference limits. The demo Menu Editor exposes Volunteer Preferences as a built-in Member Area item; the preference form itself was not opened in the current demo audit.
- Sources: [Scheduling Preferences](https://help.elvanto.com/hc/en-us/articles/7627032523415-Scheduling-Preferences), [Schedule Volunteers Onto a Single Service](https://help.elvanto.com/hc/en-us/articles/7604005299863-How-to-Schedule-Volunteers-Onto-a-Single-Service).

## Financial pledge setup — direct Super Admin demo inspection

- Add Pledge form supports selecting/adding a person, start date, amount, frequency (one time, weekly, monthly, yearly), occurrence count, account/subaccount, computed end date and total, with Save and Save & Add Another. It notes that people marked as a contact are activated for pledges dated within the prior 30 days. The form was left blank and closed.
- Source: [Financial in the public demo](https://demo.elvanto.com/admin/financial/).

## Occasion Messages, sending domains and scheduled communications — direct Settings demo inspection

- Occasion Messages settings separately configure birthday and anniversary messages: target People Categories, target demographics (search plus multi-select list), whether Contacts receive them, and message channels (email, SMS, and an option to send SMS only when no email is present). Save is available. No settings were changed.
- Sending Domains page configures email to send from a church's own domain, with domain-verification instructions using three CNAME records and a linked help guide; the demo displayed existing domain-verification status as loading, so record-level status/actions could not be verified.
- Scheduled Email & SMS page loaded an empty “No Results Found” state; scheduling list controls or messages were not available in this demo session.
- The parent Communication Settings page returned Internal Server Error.
- Sources: [Occasion messages](https://demo.elvanto.com/admin/settings/communication/occasions/), [Sending domains](https://demo.elvanto.com/admin/settings/communication/sending-domains/), [Scheduled Email & SMS](https://demo.elvanto.com/admin/settings/scheduled/).

## Formatting settings — direct Super Admin demo inspection

- Account-wide formatting covers date format, 12/24-hour time format, default currency, custom address format using available address placeholders, and an example default format.
- Exporting/printing options include PDF/XLS paper size (A4 or Letter) and font choices, including a Unicode font and Khmer font. Labels settings choose an Avery layout, and support adding Address Label Templates and Name Tag Label Templates. Save is available. No format was changed and no template was added.
- Source: [Formatting settings](https://demo.elvanto.com/admin/settings/formatting).

## Built-in Contact Templates — direct Super Admin demo inspection

- The template library groups automatic email/SMS templates under People, Groups, Notes, SMS, Services & Volunteers, Needs, Forms, Events, Event Registration, Reports and Assets. Visible template purposes include account/login and password flows, family and directory approvals, birthday/anniversary messages, people-flow notices/reminders, group notifications/attendance reminders/join requests, note lifecycle notices, SMS reply handling, volunteer contact/schedule/response/swap/replacement notifications, need reminders, form submission notifications, event invitations, registration invoices/tickets, scheduled report email, and asset booking/approval/decline notifications.
- A template editor exposes subject and rich-text message editor, Insert File, available merge/template fields, Save and Restore Default Template. The inspected login-details template was not modified, saved or restored. No other template content was opened.
- Sources: [Built-in Contact Templates](https://demo.elvanto.com/admin/settings/contact-templates/), [Example template editor](https://demo.elvanto.com/admin/settings/contact-templates/contact-template/).

## People settings — direct Super Admin demo inspection

- Default settings select a default People Category and default address state/country. Name Formatting controls displayed name (including preferred-name variants), email/SMS merge-field first name, sorting order, full legal name format and middle-name initial display.
- Profile controls determine whether members can remove the year from birth/anniversary dates; whether completed People Flows show in member sidebars; whether guests can create accounts and which Access Permission new users receive; required Locations/Departments on registration; and whether guests may view Posts and Pages.
- Email settings set registration and unsubscribe notification recipients and enable/disable scheduled-note email notifications. Viewing/Search settings choose whether archived people appear in global search and configure default people-list fields using a searchable, categorized, reorderable field chooser.
- Family settings configure administrators for duplicate-family-member approval (including location-specific assignment), which details appear in the Family Contact Details report field, whether changing a person's category updates their family by default, and whether members may edit family details or add family members themselves.
- School Grades settings allow renaming grade labels, adding grade rows and choosing the yearly date that advances grade levels. Demographic progression can be disabled on new-person creation or existing-person edits. Archiving settings choose whether a reason is required. Save is available; no setting was changed.
- Source: [People settings](https://demo.elvanto.com/admin/settings/people).

## Groups and Group Finder settings — direct Super Admin demo inspection

- Group settings enable/disable email notifications for scheduled group notes. Group Reminder to Attend provides email/SMS channel switches and configurable reminders 1–28 days before a meeting, with Add Reminder. Reporting settings support building group reporting forms by dragging in Heading, Reporting, Notes and Separator fields; another option determines whether leaders must log in to submit attendance reports. Save is available.
- Group Finder settings enable/disable the finder, control automatic email/SMS contact responses to join requests, and show a public embed iframe. Map settings either show the map by default or hide it until a visitor selects the location button. Public filters can be enabled independently for Categories, Departments, Demographics and Locations. Visibility restrictions can independently limit available groups by those same dimensions, with All/None controls and selection lists. Save is available. No settings or filters were changed.
- Sources: [Groups settings](https://demo.elvanto.com/admin/settings/groups), [Group Finder settings](https://demo.elvanto.com/admin/settings/groups/sign-up/).

## Service, volunteer and roster settings — direct Super Admin demo inspection

- Service Reporting settings build service reports by adding/reordering/removing Heading, Reporting, Notes and Separator elements and define reporting fields to assign by Service Type. Print Presets are reorderable/removable; the demo had none. Save is available.
- Volunteer notification settings define when a Reports To person is notified (on confirm/decline or decline only); automatic email/SMS contact when scheduling or unscheduling volunteers; email/SMS follow-up for unconfirmed volunteers after a configured number of days; and multiple email/SMS reminders 1–28 days before a service. Save is available.
- Roster settings define a default volunteer status (confirmed/unconfirmed), how far ahead services appear (count plus weeks/months), default service detail tab (Volunteers/Plan), and visibility rules for unconfirmed volunteers, family rosters, services, and departments. Unavailability controls include minimum submission notice, required reason, whether requests are allowed on already scheduled dates, and whether a primary/spouse/partner can submit for a whole family. Swap/replace settings define the request deadline, automatic cancellation of pending requests, whether a volunteer may decline when swap/replace is available, and per-department rules (disallow, swap only, replace only, both). A conflict-time interval triggers a scheduling warning. Preferences can count each assigned service time separately or count the whole service as one. No setting was changed.
- Sources: [Services settings](https://demo.elvanto.com/admin/settings/services/), [Volunteer settings](https://demo.elvanto.com/admin/settings/services/volunteers/), [Roster settings](https://demo.elvanto.com/admin/settings/services/roster/).

## Song settings — direct Super Admin demo inspection

- Song access can be limited to selected departments for users with Member Area Songs permission. CCLI defaults configure Print, Digital, Translation and Recording values, plus Music Reproduction Licence number. Arrangement defaults configure length, portrait/landscape orientation, one/two columns, font, chord color and text size. Save is available. No setting was changed.
- Source: [Song settings](https://demo.elvanto.com/admin/settings/songs/).

## Check-in settings and label printing — direct Super Admin demo inspection

- General Check-in settings choose default population (children, volunteers, all people) and whether to show People Categories. Children check-in includes a default parent SMS template with child/name/code/room placeholders. Security-code settings control unique/shared codes within families; random-on-first-check-in, new-random-each-session or manually added codes; code length, letters/numbers, and optional prefix/suffix; and optional session-specific codes.
- Self Check-in settings choose searchable phone, last name and security-code fields; show/hide codes; session timeout; enable/disable Check-in All; and enable/disable checkout. Save is available.
- Label Printing chooses DYMO Label Software or DYMO Connect. Separate Children Only, Volunteers Only and All People workflows can auto-print at completion or require manual printing. Child labels can include/exclude parent labels and use one combined parent label or one per child. Label design sets size and drag/drop content for child, parent, volunteer and all-people labels; field search includes child-specific information plus general person, contact, department, groups, flows, account, address, family, parent/child relationship, attendance, financial and custom fields. Each label has a sample preview. Logos can be uploaded separately for children, volunteers and all people. Self Check-in can disable Print All Labels and set a per-person limit. Named Label Print Stations are configurable with add/remove controls. Label Printing can also be disabled entirely. No logo was uploaded, no print settings were changed, and no labels printed.
- Check-in Styles index was empty and offered Add Style. The blank style editor supports name, header text/background colors, header logo, content background color/image, footer background color, Cancel and Save. It was left blank and closed.
- Sources: [Check-in settings](https://demo.elvanto.com/admin/settings/checkin/), [Label Printing settings](https://demo.elvanto.com/admin/settings/checkin/label-printing/), [Check-in Styles](https://demo.elvanto.com/admin/settings/checkin/styles/).

## Event registration settings — direct Super Admin demo inspection

- Event defaults control map visibility, hide/show a price column for free events, and hide/show remaining ticket count. Tax settings enable tax, percentage, include/exclude tax and label; events can override defaults. Payment methods are configurable with add/reorder/remove controls. Part payments can be allowed or disallowed.
- Invoice defaults configure an uploaded logo, minimum invoice-number length, prefix/suffix, rich-text header/footer and placeholders for payment instructions and invoice number. Free event registrations can enable/disable invoices and tickets. Ticket barcodes can be None, standard barcode or QR Code. Save is available; no settings were changed or files uploaded.
- Source: [Event settings](https://demo.elvanto.com/admin/settings/events).

## Calendar settings — direct Super Admin demo inspection

- Calendar defaults set the initial Week or Month view and first day of week (Sunday/Monday). Built-in colors can be set separately for People Notes, Group Notes, Groups and Services. Guest access to the Member Area Calendar can be enabled/disabled. Save is available; no values were changed.
- Source: [Calendar settings](https://demo.elvanto.com/admin/settings/calendar/).

## Financial settings and giving statement templates — direct Super Admin demo inspection

- Financial settings configure fiscal year end (day/month), currency symbol, default tax-deductible behavior versus Chart of Accounts, automatic or manual giving-number creation and minimum length. A bulk “Add Giving Numbers to All People” action exists; it was not activated.
- Member Area settings provide a giving link URL and configure whether Pledges and Transactions display in My Profile, with separate Include Family switches. Giving statement settings define a general message and additional location-specific messages using statement placeholders for church, page number, date range, generation date/year, sender/recipient addresses and receipt names.
- Giving Statement Templates index has Basic and legacy Default templates, each with Duplicate. The Basic template editor has editable title/description, logo control and a multi-page print preview with giving rows and summaries. Its sample preview is synthetic; no giving data was recorded. No template was edited, duplicated or saved.
- Sources: [Financial settings](https://demo.elvanto.com/admin/settings/financial/), [Giving Statement Templates](https://demo.elvanto.com/admin/settings/financial/giving-statements/).

## Posts settings — direct Super Admin demo inspection

- Comment controls enable/disable comments, require login or allow guest comments, and set approval mode (none, all, or guests only). Posts per page is configurable. Save is available; no setting was changed.
- Source: [Posts settings](https://demo.elvanto.com/admin/settings/posts/).

## Member Directory settings and layout — direct Super Admin demo inspection

- Directory settings enable/disable the directory and set an optional display name. Display can include individuals, families or both; default view can be individuals or families; individual sorting can use first/last name; preferred-name display has four formats.
- Exclusions can target People Categories and demographics. “Always Include” can list specific people/leaders regardless of lockdowns. Other controls automatically add new people, require opt-in for additions, and list all members on initial load. No people were added or settings changed.
- Layout editor supports drag/drop rows and elements with edit/delete controls, and an Edit Layout panel that adds rows, headings and fields from person, contact, asset, group, account, address, family, children, financial and custom-field categories. The visible layout includes a General Information section, editable field groupings, and a separate Individuals Columns to Display selector; family address can be included. Documentation notes the card layout is the mobile-app display. No layout edit was saved.
- Sources: [Member Directory settings](https://demo.elvanto.com/admin/settings/member-directory/), [Member Directory layout](https://demo.elvanto.com/admin/settings/member-directory/layout/).

## Departments and service reporting structure — direct Super Admin demo inspection

- Departments index has Add, Merge, Change Order and per-department open/delete controls. Add Department includes name, self-assign enable/disable, non-conflicting departments/sub-departments/positions, default scheduled-volunteer status (account default/confirmed/unconfirmed), whether notification preparation is required, plus Add Sub-department and Add Position. The blank department editor was only used to reveal nested blank name fields; nothing was entered or saved.
- Sources: [Departments](https://demo.elvanto.com/admin/settings/departments), [Add Department](https://demo.elvanto.com/admin/settings/departments/add).

## Demographics and demographic progression — direct Super Admin demo inspection

- Demographics index supports Add, Assign Demographic Progression, Change Order and per-demographic open/delete. Add form contains a name, an enable/disable progression control, and sub-demographic rows that can be named, removed and individually configured for progression. Assign Progression page explains that configured progression can be applied across existing people; its action was not run.
- Source: [Demographics settings](https://demo.elvanto.com/admin/settings/demographics).

## Locations — direct Super Admin demo inspection

- Locations index supports Add, Change Order, open/edit and delete. Add Location asks for name; country/timezone may inherit account defaults; Meeting Address includes address, city, state, postal code and country; Mailing Address can use the meeting address; Financial notes can appear on statements for people at the location. Save is available; no location was added.
- Source: [Locations settings](https://demo.elvanto.com/admin/settings/locations).

## Note Categories — direct Super Admin demo inspection

- Note Categories index supports Add and Sort; each category can be opened or deleted and may be marked Private. The blank editor includes category name, default-private checkbox for new notes, hexadecimal color, and optional Access Permissions checkboxes controlling who can view category notes. Save was not used.
- Source: [Note Categories settings](https://demo.elvanto.com/admin/settings/note-categories/).


## People submodules — direct Super Admin demo inspection (21 November 2026)

### People Map
- Dedicated People Map screen displays the member distribution on a Google map with a Filters control, current filter status, map marker clusters/counts, fullscreen toggle, keyboard shortcuts, zoom in/out, camera controls, and open-area-in-Google-Maps link.
- The demo map rendered 65 markers in its initial view. The visible Filters button did not expose its options in the accessibility tree during this pass, so filter dimensions remain unverified here.
- Source: [People Map](https://demo.elvanto.com/admin/people/map/).

### People Flows
- Flows index has Add Flow, Filter, Active/Pending status choices, location and demographic filters, Clear Filters, and Apply. Flow cards expose a title, Edit action, and an additional unlabeled action.
- Flow detail exposes Steps and Edit tabs, Print, Add Step, and draggable/reorderable/nestable steps (drag horizontally to nest under another step). Each step shows description, notifications state, due delay, and Edit.
- Step detail has Due Now view selector, Step selector, Edit, Add Person, Contact, step description, and people assigned/due listing. The demo step currently had no results. No records were added or changed.
- Source: [People Flows](https://demo.elvanto.com/admin/people/flows/).

### People Categories
- Categories index supports Add Category, Sort, opening a category, viewing active/contact/archived/total counts, choosing a member profile layout, and an additional unlabeled category action.
- Category detail supports View People, Copy Layout, Duplicate Layout, Edit, and the category's profile-layout link. Category fields include name and optional hexadecimal highlight color. Its category-specific person form is organized as drag-reorderable sections, headings, and fields; section/field controls expose edit and delete, and fields can be added from an Available Fields catalog.
- Layout editor exposes Add Row, Headings, Fields, Custom Fields, field search, display-field management, Add buttons for available fields, and a Save control. No layout changes were made.
- The observed Available Fields catalog is grouped as Person Details, Contact Details, Assets, Groups, Account Details, Address, Family, Children, Financial, and Custom Fields. Fields include person IDs/names/category/status/photo/DOB/age/marital status/anniversary/notes/directory; email/phone/mobile and communication preferences; permissions/departments/positions/demographics/locations/service types; group and volunteer/account status/login/reports-to; full and component mailing/home address; family members/names/relationships/contact details; child grade/development/special-needs/security code; receipt/giving number/transaction amount; and configured custom fields.
- Source: [People Categories](https://demo.elvanto.com/admin/people/categories/) and [category layout](https://demo.elvanto.com/admin/people/category/?id=34bc35a8-f828-11e4-bd65-06e37142e2e1).

### People list views and import
- Saved view choices on the People list are All People, Volunteers, Contacts, Categories, Groups, and Custom. The filter panel groups filters by Status (Active, Contacts, Suspended, Archived), Locations, Demographics, Departments, and Access Permissions; it has Clear, Cancel, and Save controls. Selecting or saving a view/filter was not completed.
- People Import starts with links to preparation/import help and controls for choosing a file, choosing People or Notes import type, choosing dd/mm/yyyy or mm/dd/yyyy date format, and Continue. The demo explicitly says imports cannot be committed to this account, but its upload/sample-file workflow can be previewed. No file was selected and Continue was not pressed.
- Source: [People list](https://demo.elvanto.com/admin/people/) and [People Import](https://demo.elvanto.com/admin/people/import/).



## Groups — list views and group detail (direct Super Admin demo inspection, 21 November 2026)

- Group list view selector includes built-in All Groups, My Groups, All My Groups, Groups I'm In, Groups I Lead, Groups I Administer, plus Categories and demo categories. The list supports search, Add Group, Contact Groups, Active filtering, page-size selection, card/list switching, and rows with Edit, Activity, Notes, and Reporting shortcuts.
- Group detail provides People, Edit, Activity, Notes, Reporting, and Join Requests sections, with Previous/Next navigation. Header actions include Submit Report, Contact, Add People, and a group-picture Edit link.
- Detail sidebar shows meeting frequency, start date, time, and location/map; it includes Print Checklist, Delete Group, Duplicate Group, leader status, and upcoming Events with Add. Member rows expose person shortcuts, position, contact fields, and per-row Edit.
- Group Reporting shows attendance report rows by report date, people in group, members, guests, absent, and total attendance. A period selector (default Last 3 months) controls the reporting window; Submit Report is also available. No report was submitted.
- Group Notes supports Write Note, All Notes view, and Filter. Note filters expose categories, private status markers, per-category counts, Clear Filters, and Apply. Existing notes show author, timestamp, body, and a per-note overflow menu. Note creation or menu actions were not used.
- Source: [Groups list](https://demo.elvanto.com/admin/groups/#v:all), [group detail](https://demo.elvanto.com/admin/groups/group/?id=dc616eaf-0595-11e5-bd65-06e37142e2e1), [group reporting](https://demo.elvanto.com/admin/groups/group_reporting/?id=dc616eaf-0595-11e5-bd65-06e37142e2e1), and [group notes](https://demo.elvanto.com/admin/groups/group_notes/?id=dc616eaf-0595-11e5-bd65-06e37142e2e1).



## Groups — editing, activity, and join requests (direct Super Admin demo inspection, 21 November 2026)

- Group edit fields include name, Active/Archived status, rich-text description, one or more categories, searchable department and demographic checklists, and location assignments.
- Meeting details include address, city, state, ZIP/postcode, country selector, digital meeting link, group start date, start/end times, weekly or monthly frequency, repeat interval and day-of-week choices, and optional end-date setting.
- Group Finder settings include Open/Closed status and member-count limit (0 means unlimited). Save is present; no edits were saved.
- Group activity is a chronological audit trail that can show people added/removed and role-position changes, group-field changes, demographic/location changes, and group creation.
- Group Join Requests page lists pending requests with request description, optional family/friend co-applicants, and Accept Request / Decline Request actions. Neither action was taken; personal demo request details are omitted.
- Source: [group edit](https://demo.elvanto.com/admin/groups/group_edit/?id=dc616eaf-0595-11e5-bd65-06e37142e2e1), [group activity](https://demo.elvanto.com/admin/groups/group_activity/?id=dc616eaf-0595-11e5-bd65-06e37142e2e1), and [group join requests](https://demo.elvanto.com/admin/groups/dc616eaf-0595-11e5-bd65-06e37142e2e1/join-requests).

## Services — service editor, plan, volunteers, and reporting (direct Super Admin demo inspection, 21 November 2026)

- Service records expose Published status, service name, type, location, date, created metadata, and previous/next navigation. Edit includes rich-text description, selectable location and service type, plus multiple named service meeting times.
- Other Times are attached to a service and can be named and typed (Rehearsal or Other), given start/end times, and scheduled the same day or a number of days before/after. These attached times also appear on the volunteer roster.
- Printed Service Plans support a logo upload and selected department positions highlighted at the top.
- Plan controls include Contact Volunteers, Print, LIVE, previous/next service navigation, delete and duplicate actions. Plan content supports headings, agenda items and songs, duration/timing, reordering, and item-level comments, notes, and attachments.
- Volunteer scheduling supports adding volunteers or teams, automatic scheduling, and team/position slots with requested volunteer counts.
- Service reporting separates built-in attendance statistics and custom statistics; built-ins include individual/family/adult/child/guest totals and demographic breakdowns. Individual attendance supports offline checklist printing, mass-add, and search/add.
- Source: [Services](https://demo.elvanto.com/admin/services/), [service edit](https://demo.elvanto.com/admin/services/service/), [service plan](https://demo.elvanto.com/admin/services/service_plan/), [service volunteers](https://demo.elvanto.com/admin/services/service_volunteers/), and [service reporting](https://demo.elvanto.com/admin/services/service_reporting/). No changes were saved or attendance entered.

## Events — list and detail availability (direct Super Admin demo inspection, 21 November 2026)

- Events can be viewed in Upcoming Events and Past Events views. List search, view selection, status filters (Active, Private, Draft), calendar/location/asset filters, clear/apply controls, page size, card/list layout, and pagination are available.
- Event rows link to registration, invoices & tickets, and guests. Add Event and event details/registration routes were attempted; the demo returned an internal server error for those pages during this inspection, so the page-level fields could not be verified.
- Source: [Events](https://demo.elvanto.com/admin/events/). No event or registration was created.

## Songs — catalog, arrangement, charts, lyrics, and files (direct Super Admin demo inspection, 21 November 2026)

- Song catalog supports add, export, CCLI reporting, search, Published filtering, card/list display, pagination and page-size selection; rows show arrangements, artist, and album.
- A song record includes Published/Archived status, Song/Item type, CCLI number, artist, album, “Song to Learn,” download permission, categories, locations, rich-text volunteer notes, arrangement management, attached files, and service schedule history. It links to the member-area song page.
- Arrangements support name, duration, BPM, meter, copyright text for chart/lyric PDFs, male and female keys with major/minor mode, and a reorderable sequence of Verse, Chorus, Bridge, Pre-Chorus, Instrumental, Intro, Outro, Vamp, Tag, Breakdown, and Misc sections.
- Arrangement subpages manage keys and downloadable chord charts; lyrics and chords with original key, PDF-download permission, PDF orientation/columns, chord color, text size/font, and a preview with transpose control; and arrangement-specific files. Song records also support song-level files.
- Source: [Songs](https://demo.elvanto.com/admin/songs/), [song records](https://demo.elvanto.com/admin/songs/song/), arrangement editor ([details](https://demo.elvanto.com/admin/songs/song_arrangement/), [keys & charts](https://demo.elvanto.com/admin/songs/song_arrangement_keys/), [lyrics & chords](https://demo.elvanto.com/admin/songs/song_arrangement_lyrics/), [files](https://demo.elvanto.com/admin/songs/song_arrangement_files/)). No song or arrangement was changed or exported.

## Check-in — operator controls and rooms (direct Super Admin demo inspection, 21 November 2026)

- Check-in start page offers Add Person or Family, Self Check-In, and Start Print Station.
- Operator settings select the search population (Children Only, Volunteers Only, All People), whether archived people appear in searches, and label-printer software (Account Default, DYMO Label App, Dymo Connect). Print Test Label is available.
- The workspace provides name search, filtering, last-name sorting, room navigation/editing, upcoming service display, and Check-in Activity. Room pages show room-specific check-ins and a Finish action.
- Source: [Check-in](https://demo.elvanto.com/admin/checkin/) and [room setup](https://demo.elvanto.com/admin/checkin/rooms/). No person was checked in and no label printed.

## Needs — assistance requests and assignment (direct Super Admin demo inspection, 21 November 2026)

- Needs index provides Add, search, status filtering, page-size selection and pagination. Need cards show request type, date, location, status, and assigned member; the displayed example type is pickup/drop-off. Personal sample request data is omitted.
- Source: [Needs](https://demo.elvanto.com/admin/needs/). No need was added or assigned.

## Reports — custom and comprehensive reports (direct Super Admin demo inspection, 21 November 2026)

- Reports index supports search and report views, with separate Add Standard Report and Add Comprehensive Report entry points.
- Rows provide category/description and created/modified metadata plus Edit, Sharing, Email, Duplicate and Export actions. The demo contains 15 custom reports and includes both standard and comprehensive report records.
- Source: [Reports](https://demo.elvanto.com/admin/reports/). No report was shared, emailed, duplicated or exported.

## Financial — batches, transactions, and pledges (direct Super Admin demo inspection, 21 November 2026)

- Financial landing view defaults to Batches and has Add Batch, Add Transaction, and Add Pledge actions, search, filtering, totals, page size, card/list layout and pagination.
- View selector exposes Batches, Transactions and Pledges. Batch table includes a batch number, name, amount, date, transfer status and edit link.
- Source: [Financial](https://demo.elvanto.com/admin/financial/). Financial records and donor details were not opened or changed.

## Forms — form list and editor (direct Super Admin demo inspection, 21 November 2026)

- Forms list supports Create Form, search, views, Published/Unpublished/Standard/Event Registration filters, page size, card/list display, pagination, and row actions Edit, Duplicate and View. Form detail provides Submissions, Edit, View, Export and Embed entry points.
- Form editor settings include name, Published/Unpublished/Archived status, category, multi-person submissions, prefill for logged-in users, optional event attendance, and a drag-and-drop field layout with per-field edit/remove controls and a custom “Add Another Person” label.
- Submission handling includes submission limits, database matching that can add/update people immediately or require admin approval, keep/delete existing data when matching submitted fields are blank, and add new people as contacts.
- Additional options include post-submission actions, default/custom success message or redirect URL, form admins and email notifications, custom header, preset/custom colors, preview, JavaScript embed, and export.
- Source: [Forms](https://demo.elvanto.com/admin/forms/) and [form editor](https://demo.elvanto.com/admin/forms/form_edit/). The form was inspected without saving changes; submissions and personal response data were not opened.

## Calendar — views, calendar management, and sharing (direct Super Admin demo inspection, 21 November 2026)

- Calendar offers Add Event and Add Calendar actions, calendar selection/filtering, previous/next navigation, a Today control, and Day, Week and Month views.
- Subscribe and Embed controls provide calendar-sharing options.
- The calendar displays all-day and time-slotted event/group/service entries with links to their records.
- Source: [Calendar](https://demo.elvanto.com/admin/calendar/). No event or calendar was created.

## Settings — People (direct Super Admin demo inspection, 21 November 2026)

- People settings configure default people category and address, name display/order and email/SMS name tokens, whether members may remove the year from birthdates/anniversaries, completed People Flow visibility, guest registration and guest content access, new-account access permission, and location/department requirements.
- Admins can choose archived-person search inclusion and default people-list fields across person/contact details, assets, departments, demographics, groups, access/account data, addresses, family, children, financial fields and custom fields.
- Family settings cover approval administrators (including by location), family contact-detail fields, default family category propagation, and whether members can add/edit family members from My Profile.
- School-grade settings define grade labels and annual progression date. Demographic settings control automatic progression on add/edit; a separate Assign Demographic Progression page runs progression across people. Archiving can require a reason.
- Source: [People settings](https://demo.elvanto.com/admin/settings/people). Settings were inspected without changes; no demographic assignment was run.

## Settings — Check-in controls, labels, and styles (direct Super Admin demo inspection, 21 November 2026)

- Check-in settings select the default check-in population and show/hide people categories. For child check-ins they configure default parent SMS text and supported child/security-code/room placeholders.
- Security codes can be unique per family member or shared; auto-generated once, regenerated each session, or manually added; configured by length, letters/numbers, and start/end characters. Session codes can be enabled separately.
- Self Check-in can search by phone, last name and/or security code; choose security-code visibility, idle timeout, Check-in All availability, and check-out availability.
- Label Printing chooses DYMO Label Software or DYMO Connect. Printing rules are configured separately for Children Only, Volunteers Only and All People, including automatic versus manual printing and parent-label rules.
- Label designs support multiple physical sizes and drag/drop fields for child, parent and adult labels, with sample-data preview and formatting tokens. Check-in Styles has an Add Style action; the inspected demo account had no styles.
- Source: [Check-in settings](https://demo.elvanto.com/admin/settings/checkin/), [label printing](https://demo.elvanto.com/admin/settings/checkin/label-printing/), and [styles](https://demo.elvanto.com/admin/settings/checkin/styles/). No setting was saved and no label was printed.

## Settings — events and payments (direct Super Admin demo inspection, 21 November 2026)

- Event defaults configure map display, whether free-event prices and remaining ticket counts appear, tax enablement/percentage/included-versus-excluded label, and payment methods (built-ins plus custom methods).
- Event registration can allow part payments. Invoice settings include logo upload, number length/prefix/suffix, rich-text header/footer templates, and payment-instructions/invoice-number placeholders.
- Free-event invoice/ticket issuance can be enabled/disabled, and tickets may display no barcode, a standard barcode or a QR code. Per-event overrides are supported for several defaults.
- Source: [Event settings](https://demo.elvanto.com/admin/settings/events). No settings or payment details were changed.

## Settings — organizational configuration (direct Super Admin demo inspection, 21 November 2026)

- Departments support add, merge, change order and delete; departments contain sub-departments and volunteer positions.
- Locations support add, change order and delete; the help text describes their use for distinct church campuses.
- Demographics support add, change order, delete and demographic progression assignment.
- Assets have add and category-management functions; assets/rooms can be linked to events and bookings.
- Need Types has a dedicated list with Add a Need Type; Needs settings expose a separate Reminders area.
- Note Categories support creation and access restrictions.
- Source: [Departments](https://demo.elvanto.com/admin/settings/departments), [Locations](https://demo.elvanto.com/admin/settings/locations), [Demographics](https://demo.elvanto.com/admin/settings/demographics), [Assets](https://demo.elvanto.com/admin/settings/assets/), [Need Types](https://demo.elvanto.com/admin/settings/needs/types/), and [Note Categories](https://demo.elvanto.com/admin/settings/note-categories/). No settings records were added, changed, reordered or deleted.

## Settings — navigation inventory and unavailable route (direct Super Admin demo inspection, 21 November 2026)

- Settings navigation is grouped into General (account, legal/compliance, communication, occasion messages, sending domains, scheduled email/SMS), Users (Super Admins, access permissions, passwords/security), Customization (formatting, built-in contact templates, layouts, sidebars), Features (People, Groups/Group Finder, Services/Volunteers/Roster, Songs, Check-in/label printing/styles, Events, Calendar, Financial/giving statements, Posts, Member Directory/layout, Departments, Demographics, Locations, Assets/categories, Note Categories, Needs/types), and Developers (Integrations).
- Access Permissions have add and full-list functions. Permission records can grant Admin Area module access and separately toggle Member Area areas; each module exposes further controls. Print is available for a permission record.
- The main Communication settings route returned Internal Server Error in the demo. Occasion Messages, Sending Domains and Scheduled Email & SMS are listed in settings navigation but were not inspected in this batch.
- Source: [Settings](https://demo.elvanto.com/admin/settings/) and [Access Permissions](https://demo.elvanto.com/admin/settings/access/). No access permissions were edited.

## Emails & Letters — standard and design templates (direct Super Admin demo inspection, 21 November 2026)

- Emails & Letters index exposes Add Design Template and Add Standard Template, plus search and filtering.
- Standard template editor includes name/status, sender-address rule (admin, sending user or custom), subject, rich-text email body, optional file attachment from Files, and a printable-letter body with font, size and page margins.
- Templates can be restricted by department, location, demographic and group. Blank lockdown means available to anyone with email/letter access.
- Design Template flow begins with a template chooser (including Blank) and a Next step. No template was created or sent.
- Source: [Emails & Letters](https://demo.elvanto.com/admin/emails/) and [design templates](https://demo.elvanto.com/admin/emails/templates).

## Posts — publishing and access controls (direct Super Admin demo inspection, 21 November 2026)

- Post editor includes title, editable permalink, rich-text content with image/link/anchor/embed/table and “More” break controls, Files attachments, publication date/time and Published/Draft status, category, author, tags, comment permission, expiry date/time, and lockdown by department, location, demographic, group and other criteria.
- Source: [Posts](https://demo.elvanto.com/admin/posts/) and [post editor](https://demo.elvanto.com/admin/posts/post/). The form was inspected without saving or publishing.

## Pages — Member Area content (direct Super Admin demo inspection, 21 November 2026)

- Page editor includes title/permalink and rich-text content with image, link, anchor and external-media embedding, plus file attachments.
- Pages can be Published or Draft, appear in Member Area navigation or on the Member Area home page, have an expiry date/time, and be restricted by audience criteria (including department, location and demographic).
- Source: [Pages](https://demo.elvanto.com/admin/pages/) and [page editor](https://demo.elvanto.com/admin/pages/page/). The form was inspected without saving or publishing.

## Member Area — roster, profile, needs, calendar, and directory (direct Super Admin demo inspection, 21 November 2026)

- Member Area navigation includes Home, Roster, Group Finder, My Groups, My Giving, Needs, Calendar, Member Directory, Links, Unavailability and Help.
- Roster offers service-date navigation, a service list, Subscribe, and per-service Volunteers/Plan views, with service edit, LIVE and Print links where permitted.
- Members can submit unavailability with start/end dates, all-day or time range, recurrence (daily, weekly, monthly by day/week, yearly), location and reason.
- Member Needs are separated into Assigned to Me, Unassigned and Completed.
- Member Directory has search, person/family view, card/list modes and pagination. Personal directory records were not copied into this inventory.
- My Profile navigation exposes profile editing, profile picture, privacy settings, giving, family, groups, needs, communication preferences, volunteering roster/unavailability, social login and two-factor authentication. My Giving and private profile details were not opened.
- Member Calendar supports Subscribe and links to the Admin Calendar, with Day/Week/Month views and date navigation.
- Source: [Member Area](https://demo.elvanto.com/), [roster](https://demo.elvanto.com/roster/), [unavailability](https://demo.elvanto.com/profile/unavailability/), [member needs](https://demo.elvanto.com/needs/), [directory](https://demo.elvanto.com/directory/), and [member calendar](https://demo.elvanto.com/calendar/).

## Settings — occasion messages and email domains (direct Super Admin demo inspection, 21 November 2026)

- Occasion Messages configure birthday and anniversary email/SMS sends by people category and demographic, whether contacts receive them, and whether SMS is used only when no email exists. Message content is customized through Built-in Contact Templates.
- Sending Domains configures verification of domains for sending email on behalf of the account.
- Scheduled Email & SMS has a dedicated settings route, but its content remained in a loading state during this inspection. The primary Communication settings route returned Internal Server Error.
- Source: [Occasion Messages](https://demo.elvanto.com/admin/settings/communication/occasions/), [Sending Domains](https://demo.elvanto.com/admin/settings/communication/sending-domains/), and [Scheduled Email & SMS](https://demo.elvanto.com/admin/settings/scheduled/). No messages were scheduled or sent.

## Settings — formatting and account access boundary (direct Super Admin demo inspection, 21 November 2026)

- Formatting settings configure date and time formats, account currency, address template/placeholders, PDF/XLS paper size and font, address-label sheet format, and address/name-tag label templates.
- The Settings menu linked an Account page described as account information, location and language; that page displayed “You do not have access to this item” in the demo. This is a demo permission limitation and the route was not explored further.
- Source: [Formatting](https://demo.elvanto.com/admin/settings/formatting) and [Settings](https://demo.elvanto.com/admin/settings/). No formatting changes were saved.

## Built-in Contact Templates — automated notification catalog (direct Super Admin demo inspection, 21 November 2026)

- Template catalog is grouped by product area and each template is selectable for editing. Observed areas: People, Groups, Notes, SMS, Services & Volunteers, Needs, Forms, Events, Event Registration, Reports and Assets.
- People templates cover login details (including social login), password reset, new-account and family approval notices, People Flow assignment/reminders, unsubscribe, Member Directory opt-in, birthdays and anniversaries.
- Group templates cover adding people, report submission, attendance/meeting reminders, unread messages, join request notices/responses, and accepted/declined requests.
- Notes templates include scheduled and completed note notices. SMS templates handle replies, failed reply routing, and cases where the original recipient lacks an email address.
- Services & Volunteers templates cover contacting volunteers for one/multiple services; confirmed/declined responses; scheduled/unscheduled notices; follow-up for unconfirmed volunteers; schedule reminders; and swap/replacement request, completion, cancellation, failure and participant notifications.
- Needs templates cover reminders and new-need notices. Forms templates cover ordinary and approval-required submissions. Event templates include manual/automated invitations; Event Registration templates send invoices and tickets. Reports include scheduled report emails. Assets include booking, approval-required, approved and declined notices.
- Templates support Email and, where applicable, Email & SMS. Source: [Built-in Contact Templates](https://demo.elvanto.com/admin/settings/contact-templates/). No template was edited or sent.

## Member Directory — visibility and layout configuration (direct Super Admin demo inspection, 21 November 2026)

- Directory settings can enable/disable it, set a custom name, show individuals/families/both, choose the default view, sort individuals by first or last name, and configure preferred-name display.
- Audience rules can exclude people categories and demographics; selected people can be always included regardless of lockdown. Other options govern automatically including new people, requiring opt-in, and initially listing all members.
- Directory layout editor supports drag-and-drop sections/rows, headings and fields, plus custom columns for individuals and families. Available fields span person/contact details, assets, groups, account details, addresses, family, children, financial data and custom fields.
- Source: [Member Directory settings](https://demo.elvanto.com/admin/settings/member-directory/) and [layout](https://demo.elvanto.com/admin/settings/member-directory/layout/). No settings were saved.

## Files and Folders — upload, audience access, and restrictions (direct Super Admin demo inspection, 21 November 2026)

- Add File supports up to 50 files at once, Published/Draft status, notes, expiry date/time and folder assignment.
- File access options include specific people/lockdown audiences, Members & Guests, Members only, or Guests only. Lockdown selectors support departments, locations, demographics, groups and access permissions.
- Add Folder has a name and the same audience choices/lockdown selectors; folder lockdown is inherited by its contents. Files index provides Add File, Add Folder, search, views, filters and storage usage.
- Source: [Files](https://demo.elvanto.com/admin/files/), [Add File](https://demo.elvanto.com/admin/files/add_file/), and [Add Folder](https://demo.elvanto.com/admin/files/folder/). No file was uploaded or folder created.

## Links — Member Area link directory (direct Super Admin demo inspection, 21 November 2026)

- Add Link includes name, Published/Hidden status, URL and category. Without a category it appears directly under the Member Area Links menu; a category creates a submenu.
- Source: [Links](https://demo.elvanto.com/admin/links/) and [Add Link](https://demo.elvanto.com/admin/links/link/). No link was created.

## Integrations and restricted customization routes (direct Super Admin demo inspection, 21 November 2026)

- Integrations has an Add action, but the demo page displayed a notice that some settings cannot be saved in the demo and remained on “Please wait while we retrieve your apps…” during inspection.
- Sidebars and the Account settings routes were linked from Settings but returned a “You do not have access to this item” message in the demo. Their internal settings were therefore not verifiable.
- Source: [Integrations](https://demo.elvanto.com/admin/settings/integrations/), [Sidebars](https://demo.elvanto.com/admin/settings/customize/sidebars/), and [Account settings](https://demo.elvanto.com/admin/settings/account/). No integration was added.

## Settings — Group Finder and group reporting (direct Super Admin demo inspection, 21 November 2026)

- Group Finder settings enable/disable the feature, configure automated Email/SMS responses to join requests, choose default interactive-map visibility, and expose an iframe embed.
- Member-facing Group Finder filters can be configured independently for categories, departments, demographics and locations. Separate restrictions limit which group records appear based on those same attributes.
- Group settings enable/disable email notices for scheduled group notes, configure multiple email/SMS attendance reminders by days before a meeting, and define custom reporting layouts from Heading, Reporting, Notes and Separator components. Group report links can require or not require login.
- Source: [Group Finder settings](https://demo.elvanto.com/admin/settings/groups/sign-up) and [Group settings](https://demo.elvanto.com/admin/settings/groups/). No settings were changed.

## Settings — Service reporting, volunteer notices, and roster rules (direct Super Admin demo inspection, 21 November 2026)

- Service reporting settings let admins build custom reporting layouts from Heading, Reporting, Notes and Separator fields and configure print presets.
- Volunteer notice settings configure when “Reports To” people are notified of volunteer responses, automatic Email/SMS contact on scheduling or unscheduling, follow-up for unconfirmed volunteers after a set delay, and multiple email/SMS reminders before services.
- Roster settings select the default volunteer confirmation state, future planning horizon, default Volunteers/Plan tab, visibility of unconfirmed volunteers, family rosters, other service rosters and other departments.
- Roster rules also govern volunteer declining after confirmation (including deadline-based blocking), notice required for unavailability, reason requirement, unavailability while scheduled, family-wide unavailability, swap/replace request deadlines and cancellation timing, whether declining is allowed while swap/replace is available, swap/replace options per department, conflict alerts for close service times, and how service times count toward volunteer scheduling preferences.
- Source: [Service settings](https://demo.elvanto.com/admin/settings/services/), [volunteer notices](https://demo.elvanto.com/admin/settings/services/volunteers/), and [roster settings](https://demo.elvanto.com/admin/settings/services/roster/). No settings were saved.

## Reports — additional catalog and builder findings (read-only, 21 November 2026)

### Report catalog and common controls

- Built-in report catalogs are grouped by People, Groups, Services, Check-in, and Financial. The catalog provides search, a category/view selector, page-size control, list/grid switching, and per-report Generate and Email actions.
- People built-ins observed: No Notes Report; People Activity; People Category History; People Flow Steps Detail; People Notes; SMS Text Messages; Unsubscribes.
- Group built-ins observed: Group Attendance Summary; Group Details; Group Individual Attendance; Group Notes; Group People; Group People History; Group Reporting (Detailed); Group Reporting (Statistics).
- Service built-ins observed: CCLI Reporting; Service Details; Service Individual Attendance; Service Reporting (Detailed); Service Reporting (Statistics); Volunteer Positions.
- Check-in built-ins observed: Absentees; Overall Check-in Attendance; Room Attendance.
- Financial built-ins observed: Batches; Batch Summaries; Donors by Method; Donors by Number of Gifts Given; Giving Statements; New Givers; Pledge & Transaction Amounts; Top Givers; Transactions.
- Report purposes shown in the catalog include activity and notes history, attendance summaries and individual attendance, group/service reporting, CCLI usage, volunteer positions, absentees, room load, batch/transaction summaries, giving statements, new/first-time givers, pledges and top donors. Built-in People reports also include communication/SMS activity and unsubscribes. Reports can be generated or emailed from the catalog.
- A financial report's generator exposes custom date ranges and presets (today/yesterday; recent weeks/months; current/previous calendar week, month, year and quarters; prior years), include/exclude archived people, individual/family grouping, account/subaccount filtering, people category/demographic/location filters, selectable additional people columns and transaction columns, sort field and direction, and output as Web, XLSX, CSV, PDF, or Save Snapshot. It has Cancel and Generate actions. The generator was inspected but not run; no financial results were opened.

### Standard report builder

- Standard report setup has name, description, category, a choice to use it as a report and People View, only a report, or only a People View.
- Filter criteria support Individuals or Families, matching all criteria, any criteria, or custom advanced filter logic. Criteria rows expose a field selector, operator selector and value control, with add/delete criterion controls.
- Available person fields are organized into Person Details, Contact Details, Assets, Groups, Account Details, Address, Family, Children, Financial, and Custom Fields. They include profile, contact preference, department, demographic, service type, group, status, login, address/family, child safety and financial attributes, and organization-specific custom fields.
- Separate field lists can be configured for report output and People View output. Each list supports ordering/removing fields and two sort levels with ascending/descending direction.
- Save and Save & Generate actions are shown. The form was inspected without saving or generating.

### Comprehensive report setup

- The “Add Comprehensive Report” page exposed name, description, category, and Save only in this demo session; it did not expose report criteria or output-field controls on the form. No report was saved. This may be a demo limitation or incomplete page rather than the full product capability.

### Financial statement template editor

- The Basic giving-statement template editor exposes editable title and description, an Insert logo control, a rendered multi-page preview, and Save.
- The preview represents a statement with church/person heading, statement date range and as-of date, transaction date/method/account/amount table, tax-deductible account totals and total amount, and sender/recipient blocks. Preview content was demo data only; no donor records were opened and no template changes were saved.
- Source pages: [People reports](https://demo.elvanto.com/admin/reports/#existing:people), [Group reports](https://demo.elvanto.com/admin/reports/#existing:groups), [Service reports](https://demo.elvanto.com/admin/reports/#existing:services), [Check-in reports](https://demo.elvanto.com/admin/reports/#existing:checkin), [Financial reports](https://demo.elvanto.com/admin/reports/#existing:financial), [Standard report builder](https://demo.elvanto.com/admin/reports/report/), [Comprehensive report setup](https://demo.elvanto.com/admin/reports/report_comprehensive/), and [giving statement template](https://demo.elvanto.com/admin/settings/financial/giving-statement-templates/basic).
## Occasion messages and dashboard customization (read-only, 21 November 2026)

### Automatic birthday and anniversary messages

- Communication > Occasions configures automatic birthday messages and anniversary messages separately.
- Each message type can target selected People Categories and Demographics, with searchable demographic selection.
- Contacts can be separately included or excluded for each occasion type.
- Email and SMS message types can be enabled independently; SMS can be limited to people without an email address.
- Message content is customized through Built-in Contact Templates. The settings page has a Save action; no settings were changed.
- Source: [Occasion Messages settings](https://demo.elvanto.com/admin/settings/communication/occasions/).

### Admin dashboard

- The dashboard has an Edit Dashboard mode with add-widget, edit-widget, remove-widget, drag/reorder controls, a layout preview and Finish Editing.
- Available widget types shown: Profile, Service Statistics, Notifications, Songs To Learn, Comments, Upcoming Events, My Groups, and Upcoming Roster.
- Existing dashboard widgets observed: Notifications, attendance over last 3 months, upcoming events, attendance last month, people categories, quick service statistics, comments, profile, and songs to learn. The notifications widget includes filters and a link to pending group requests; the upcoming events widget links to the full calendar. No notification action, member record or event detail was opened.
- Adding a widget opens a setup dialog with widget selection, title, title color (hexadecimal), dashboard column count, and Cancel/Save. The picker was closed without selecting or saving a widget.
- Source: [Admin dashboard](https://demo.elvanto.com/admin/).

### Settings pages blocked in the demo

- The settings index lists Account information/location/language, Legal & Compliance requirements, Super Admin management, and Passwords & Security requirements.
- Direct attempts to open Passwords & Security and Legal & Compliance redirected to the dashboard with “You do not have access to this item.” Their controls could not be inspected in this demo session.
- No account or Super Admin page was opened.
### Demo login roles and rechecked settings access

- Logging out returns to a demo role chooser with Super Admin, Group Leader, and Member / Volunteer entries. I used the explicitly authorized Super Admin entry and rechecked account and Super Admin settings; both still redirect to the dashboard with “You do not have access to this item.” Legal & Compliance and Passwords & Security had the same result. Thus these pages remain uninspectable in this public demo even after selecting Super Admin.
- Source: [Demo login](https://demo.elvanto.com/login) (role chooser is shown after logout).
## Events — Super Admin list, event overview, guest filters, and route limits (21 November 2026)

- Events index now loads under the explicit Super Admin demo entry. It offers Upcoming Events and Past Events views; search; Active/Private/Draft status filters; a month-range stepper; Calendar, Location and Asset filters; Apply/Clear Filters; page size, list/card switching, pagination, and a multi-column list of event name, start/end, calendar, locations, assets and venue.
- Event rows can be repeating and expose Registration, Invoices & Tickets and Guests shortcuts. The event Add Event page and the event-details Edit/Registration routes still return an Internal Server Error.
- The Invoices & Tickets route opens an event overview with previous/next occurrence navigation, event date/time, venue/map, organizer, Export, Invite Guests, Record Attendance and View in Member Area. The event Actions panel offers Contact Guests, Export Guest List, Duplicate Event and Delete Event. These actions were inventoried only; none were used.
- Invoices view has search, an Invoices selector, and Paid/Unpaid/Part Paid status filtering; the observed example had no results.
- Guests view has search and filters for Attended, Attending, Maybe, Guest List and Declined; the observed example had no results.
- Record Attendance opens a guest-name-or-ticket-number search, an Attendees section and a Check In control that remains disabled until a guest is chosen. The guest list stayed loading during inspection and no check-in was submitted.
- Source pages: [Events index](https://demo.elvanto.com/admin/events/), [event overview](https://demo.elvanto.com/admin/events/event-invoices/), [event guests](https://demo.elvanto.com/admin/events/event-guests/).
- The event overview’s “View in Member Area” link also returned an Internal Server Error for the sampled occurrence; member-facing event details were therefore not inspectable.
## Communication and integrations settings after Super Admin entry (21 November 2026)

- Communication settings still return an Internal Server Error under the selected Super Admin role. Occasion Messages and Sending Domains remain separately accessible.
- Integrations settings now render an empty-state (“no integrations”) plus an Add control and a warning that some settings cannot be saved in the demo. Clicking Add returns an Internal Server Error; no integration was created.
- Source pages: [Communication settings](https://demo.elvanto.com/admin/settings/communication/) and [Integrations settings](https://demo.elvanto.com/admin/settings/integrations/).
### Event guest invitation selector

- Invite Guests opens a chooser with Individuals, Groups, and People Views tabs; search; a filter control for individual selection; Select People/Groups/People Views sections; an Invite All option for group and saved-view selections; and a Pending Invites area.
- Individuals are not loaded until searched or filtered. The groups and saved-view lists load selectable targets. No recipient was selected and no invitation was sent. The UI contained demo names, which are intentionally not reproduced.
- The Sidebars settings route also redirects to the dashboard with “You do not have access to this item” after selecting Super Admin.
## Event invitation filter dimensions — Super Admin demo

Expanded the Individuals tab's Filter control without selecting any filter values or loading/copying people records. The available filter groups shown were:

- **Locations:** selectable locations.
- **People Categories:** selectable categories.
- **Demographics:** selectable demographic values.
- **Departments:** hierarchical department/team/position selections, including nested teams and roles.
- **Filter controls:** expand/collapse Filter, Clear Filters, and Apply. The modal also exposes Search, Select People, and Pending Invites panels; the Individuals panel prompts the user to search or apply filters to load people. No recipient was selected and no invitation was sent.

This confirms that event invitations can target individuals through combinations of people record dimensions, including organizational assignments. The demo's filter list is populated from its own configuration; the exact demo labels are not treated as universal Elvanto defaults.
## Event detail export dialog — Super Admin demo

The event-detail **Export** dialog exposes a choice of export data (**Billing Contacts** or **Ticket List**) and file format (**XLSX** or **CSV**), with Cancel and Export controls. The demo showed Billing Contacts and XLSX selected by default. No export was run, so no contact or ticket data was downloaded.
## Event index — card view, sorting, pagination, and filters

Further inspection of the Super Admin event index established the exact view and list controls:

- Switch between **Table** and **card/list** presentation. Cards show event name, repeating status where applicable, start/end date and time, calendar, locations, assets, venue, and shortcuts to Registration, Invoices & Tickets, and Guests.
- Each card has an **Invite** action and a separate per-card menu with **Delete**. Neither action was executed.
- Sort by **Name, Start, End, Calendar, Locations, Assets,** or **Where**.
- Set page size to **10, 20, 50, 100, or 500**; paginate through results.
- Filter by a **timeframe in months**, **Active / Private / Draft** status, **Calendars**, **Locations**, and **Assets**. The filter menu provides **Clear Filters** and **Apply**.
- The current demo list contained 23 upcoming instances across a four-month timeframe. This count is sample data, not a product limit.

No filter values were changed or applied.
## Shared header tools — global search and notifications

Observed from the Admin header while signed in as Super Admin:

- **Global search** opens a text search field and a **Filters** menu. Search scope filters are **People, Groups, Services,** and **Songs**.
- **Notifications** opens a notifications panel with its own **Filters** menu. Filter categories shown are **Asset, Group Note, Group Join Requests, People Flow, People Note,** and **Volunteering Request**.
- The panel can surface group join request notices and links to **View All Pending Group Requests**; it also presents an empty-current-notifications message when none are active.
- No global search was submitted and no notification was acted on. Sample request names and personal details were excluded.
## Group Finder — pending join request review page

Following the notification panel's visible **View All Pending Group Requests** link opens the Member Area **Pending Requests** page. Requests are grouped under their target group. A request can include:

- The applicant's submitted message/description.
- Applicant contact details (email and phone are displayed).
- A **Family or Friends** section that either states no additional people are requesting to join or lists extra applicants with their own contact information.
- **Accept Request** and **Decline Request** controls for each application.

No request was accepted or declined, and demo names, messages, email addresses, and phone numbers were not copied into this inventory.
## Member Area — Group Finder and public group detail

The Member Area **Group Finder** was inspected from its navigation:

- Displays group cards with group name and meeting-location summary, result count, and selectable page sizes (12, 24, 48, 108, or 500).
- Displays the groups on a Google map with map expand/fullscreen, pan, and zoom controls; a map-pin button toggles the map presentation.
- The filter panel includes **Views**, a search field, **Demographics**, and **Locations** filter groups, with **Clear**, **Save**, and **Cancel** controls. Filters were not changed or saved.
- Opening a group card shows a public detail page with the group image/banner, leader section, group address, and an **Upcoming Meetings/Events** list with each meeting's date and start/end time.
- This demo's current account did not show a join/request control on this group detail page. Admin/group leader workflows and Group Finder join applications are documented elsewhere in the inventory.

No group data or filter changes were submitted.
## Group Finder verification note — map and filter rendering

A follow-up check exposed the Group Finder map controls in the accessibility tree: **Keyboard shortcuts**, a fullscreen toggle, **Map camera controls** with Move up/left/right/down, **Zoom in/out**, and an **Open this area in Google Maps** link. These map controls are rendered and operable in the demo.

The **Views / Filters / Demographics / Locations / Save / Cancel** controls also appeared in the accessibility tree after activating the filter button, but the corresponding filter panel did not visibly render in the screenshot. Treat those filter controls as accessibility-tree observations with incomplete visual verification.
## Member Area — My Groups member detail and privacy

An individual group reached from **My Groups** exposes:

- **Messages** and **Members** tabs.
- A group-message composer with a send control; the demo showed an empty message history. No message was sent.
- A **Notifications** control on the group detail page.
- **Edit My Privacy** for group visibility and **Submit Report** for the group.
- The **Members** tab shows the viewer's visibility status (including a notice if they are hidden from the group) and member cards with contact fields for email address, phone number, and mobile number. Leaders are identified in the group details; contacts may be absent for some entries.

Demo member names and contact information were not copied. The privacy setting was not changed, and no report was submitted.
## Member Area — profile privacy controls

The member **Privacy Settings** page has collapsible **Member Directory** and **Groups** sections. It explains that clicking a field changes its setting, with green fields visible and gray fields hidden.

- **Member Directory:** a **Show my profile** toggle plus field-level visibility controls for **Photo, Last Name, Mobile Number, Email Address, Age, Marital Status, Groups, Preferred Name, Phone Number, Date of Birth, Anniversary, Locations,** and **Departments**.
- **Groups:** an individual **Show my profile** checkbox for each group membership.

The page displayed current demo settings only; no visibility control was changed.
## Member Area — Communication Preferences and personal email signature

The **Communication Preferences** page provides:

- A personal **Email Signature** rich-text editor and **Save** button. Toolbar functions observed: bold, italic, underline, strikethrough, left/center/right/justify alignment, numbered and bulleted lists, decrease/increase indent, block quote, link/unlink, image, font size, font family, paragraph format, text color, table, embed media from external sites, special characters, paste as plain text, paste from Word, remove format, spell-check while typing, maximize editor, source view, undo, and redo.
- Font-size choices include Default and common point sizes from 8 through 72; font-family choices include Default, Arial, Comic Sans MS, Courier New, Georgia, Lucida Sans Unicode, Tahoma, Times New Roman, Trebuchet MS, and Verdana. Paragraph formatting includes Normal and heading styles.
- **Email Communications** checkboxes for **Receive general emails** and **Receive scheduling emails**.
- **SMS Communications** checkboxes for **Receive general SMS** and **Receive scheduling SMS**.

No signature or subscription setting was changed or saved.
## Member Area — Family and Needs workflows

### Family

The member **Family** page lists family members attached to the profile and offers **Add Family Member**. The first step requests first name, last name, and a **Relationship** selected from Primary Contact, Spouse, Child, Sibling, Grandfather, Grandmother, Partner, or Other; it then provides a **Next** control. The demo profile had no family members. No entry was added and the wizard was not submitted.

### Needs

The Member Area **Needs** page separates records into **Assigned to Me**, **Unassigned**, and **Completed** lists. Need cards show the need title, type, due date, and location; completed cards also show completed date. Opening a need shows name, due date, type, description, status, and available workflow actions:

- For an unassigned need, **Assign to me**.
- For an assigned need, change status to **In Progress** or **Completed**.

No need was claimed or moved to another status, and demo request names/details were not copied.
## Member Area — My Giving and two-factor authentication

- **My Giving** displays a member's giving history when available. The current demo profile shows an empty state (“You do not currently have any giving recorded”), so no transaction, statement, or giving-management controls were visible for this account.
- **Two Factor Authentication** explains that each sign-in requires a password and verification code from an authenticator app; a **Get Started** control begins enrollment. Enrollment was not started.

These are demo-account observations; the empty giving state is not a product limitation.
## Member Area — Member Directory views and pagination

The Member Directory page exposes:

- Text **Search**.
- A **View Individuals / View Families** selector.
- Switch between **Card** and **List** presentations.
- **Previous / Next** pagination.
- Page sizes of **16, 32, 48, or 64** in card view, and **10, 20, 50, or 100** in list view.
- Individual directory entries display a profile name and the contact/profile fields permitted by that person's privacy settings (the demo showed mobile, email, age, marital status, and groups in the list view).
- Family cards show family name, member display names, and family address when those fields are populated and visible.

No search was run and no demo contact or address data was copied.
## Member Area — Roster and service-plan views

The member **Roster** page includes:

- A list of upcoming services by date with links to the individual services.
- A **Change** selector between **Upcoming Services** and **All Services**.
- A **Subscribe** control for roster subscription (not activated).
- A service detail with date, service time/name/location, **Volunteers** and **Plan** tabs, a **Print** action, and a **LIVE** link.
- The Volunteers tab reports scheduled volunteer assignments (the inspected service had none).
- The Plan tab displays service-plan sections and ordered items, with item start time, duration, and **Comments** controls; the service total start time and total duration are shown.
- An **Other Times** section can list additional service times such as rehearsal.

No roster was subscribed to, printed, edited, or changed.
## Member Area — Unavailability submission

The member **Unavailability** page includes a submission form with:

- Start Date and End Date fields (day / month / year).
- Time choices: **All Day**, **Start Of Day**, each hour from **01:00 to 11:00**, **Noon**, and **13:00 to 23:00**.
- Repeat choices: **Do Not Repeat, Daily, Weekly, Monthly (By Day), Monthly (By Week),** and **Yearly**.
- Location choice: **All Locations** or a configured location.
- A **Reason** text field.
- **Add** and **Submit** controls, plus a list of existing entries (the demo showed “Nothing To Display”).

No entry was added or submitted.
## Member Area — Edit Profile fields and account details

The member **Edit Profile** page shows a demo warning that changes to this profile cannot be saved. Editable profile sections include:

- **Your Information:** required first and last name; preferred and middle name; email, phone, and mobile; gender; date of birth; marital status; and anniversary.
- **Home Address** and **Mailing Address:** address lines 1/2, city, state, ZIP/postcode, and country. Each address section has a **Copy to Mailing Address** or **Copy to Home Address** control.
- **Country and Timezone:** country and time zone selectors.
- **Log In Details:** current-password field plus username and password fields; the page states that the current password is required to edit login details.
- **Save** control.

No personal information was edited or saved, and no credential values were inspected or entered.
## Member Area — Calendar views and navigation

The member-facing **Calendar** provides:

- **Day, Week,** and **Month** views.
- **Previous / Next** navigation and a **Today** control.
- A time grid with an **all-day** row and hourly rows.
- Event links to associated group meetings, services, and events.
- A **Subscribe** control and **View Admin Calendar** link.

The demo calendar displayed group meetings and service occurrences according to the member view. Subscription was not activated, and no event was changed.
## Member Area — Home page and navigation content

The Member Area **Home** page can display published posts with author, publication date, category, and article content; an **Upcoming Events** list; **View Full Calendar**; and a **Link Google** action. Admin-role access also shows an Edit link on a post. The header navigation includes Links categories when configured.

Only the page structure was recorded; no Google account was linked and no post was edited.
## Member Area — post detail page

Opening a post displays its author, publication date, category, and full post content. An admin role also sees an **Edit** link to the Admin post editor. No comment or share controls were visible on the inspected post.
## Member Area — Getting Help page

The Member Area **Getting Help** page displays a support message and a **contact our team** link to Tithe.ly Help. Admin-role access also exposes an **Edit** link to the Admin Pages editor. No support link was opened.
## Admin — Links

The Admin **Links** index provides **Add Link**, text search, a **Published/Hidden** status filter, category filter, and a two-record list in this demo. Listed entries expose their name, URL, category, published indicator, and a Delete action. An existing entry opens an editor with **Name**, **Status** (Published or Hidden), **URL**, and selectable categories. The editor explains that links appear in the Member Area Links dropdown; links with no category appear directly under Links, while categorized links appear in a submenu. No link was changed or deleted.

In the inspected Member Area navigation, **Links** expands to a **General** category; selecting it points to the current help page in this demo rather than a distinct link landing page.

## Admin — Forms: index, submissions, and builder

The Forms index exposes **Create Form**, text search, saved **Views**, status filters (Published, Unpublished, Archived), type filters (Standard, Event Registration), page size, and list/card presentation. Observed named views include All Forms, Categories, Connection Cards, Events, Small Groups, and Special Events. Each form row provides detail, **Edit**, **Duplicate**, and public **View** actions. The create dialog asks for a name and type (**Standard** or **Registration**); creation was not submitted.

A form's detail/submissions area has **Submissions** and **Edit** tabs, public **View**, **Export**, **Embed**, and **Contact People** actions. Submission rows show submitter, status, submission date, and whether/how many people are linked. Submission statuses can be filtered by Approved, Action Pending, Archived, and Declined. Export offers XLS or CSV; no file was exported, no people were contacted, and no submission status was changed.

The form editor's **Details** section covers name, status (Published/Unpublished/Archived), and category/view. Other sections include **Multi-person Submissions** (enable repeated person sections), **Pre-fill Form** for logged-in users, optional **Event Attendance** registration, draggable form **Layout**, a customizable “Add Another Person” label, **Submission Limit**, database updates (none, add/update, or admin approval first), handling of empty answers against existing populated person data (delete or keep), add new people as contacts, configurable post-submission **Actions**, after-submit behavior (default success message, custom message, or URL redirect), form admins and email notification, **Form Styles** (custom header and Default/Black/Brown/Blue/Red/Green/Custom Style colors), and **Preview**. The inspected layout contained draggable rows and fields, with edit and remove controls; **Edit Layout** provides Add Row, Headings, People Fields, People Custom Fields, Form Custom Fields, and Event Attendance Fields. Existing values were inspected only; no edits or saves were made.

## Admin — Files

The Files library includes **Add File**, **Add Folder**, search, saved Views, status filtering, storage usage, page size, and list/card presentation. The demo notes that files can be shared in pages, posts, or email. Its list can show name, date added/creator, file version sizes, total size, and file access; entries expose **Open File** and **Versions**. Storage usage is shown as used space against the account quota.

A file detail page exposes **View File**, metadata (size, type, date added, creator, folder), a shareable file URL, and a separate image URL for embedding in email or websites. Tabs/actions include **Edit** and **Versions**. The editor has name, Published/Draft status, notes, expiry date and time, folder assignment, and access choices: specified people, people assigned to selected Lockdown areas, Members & Guests, Members only, or Guests only. Lockdown targeting can include Departments, Locations, Demographics, Groups, and Access Permissions, with search fields for the longer lists. A Versions page shows an **Upload New Version** drop/click upload control and a 40 MB maximum. No upload or metadata/access changes were made.

## Admin — Posts

The Posts index provides **Add Post**, search, saved Views, status filters, page size, and list/card presentation. The list can show title, author, categories, comment count, and publication date. A post editor has title and permalink, rich-text content, an **Insert / Attach File from Files Area** control, publish date/time, Published/Draft status, categories, author, tags, comment enablement, and expiry date/time. The Lockdown section can target Departments, Locations, Demographics, Groups, and Access Permissions. The post detail links to **View Comments** and **View in Member Area**. The separate Comments page has search and a View selector; no comments were present for the inspected post. No content or settings were changed.

## Admin — Pages

The Pages index provides **Add Page**, text search, status filtering, page size, and list/card presentation; its list can show title, author, access, and location. The page editor has title/permalink, rich-text content, file attachment from the Files area, Published/Draft status, and **Page Location** options to show the page in Member Area navigation or on the Member Area home page. It also supports expiry date/time and Lockdown targeting by Departments, Locations, Demographics, Groups, and Access Permissions. No page was edited or saved.

## Admin — Emails & Letters

The Emails & Letters index provides **Add Design Template** and **Add Standard Template**, search, Active/Inactive filtering, page size, and sorting. Entries show template type (Standard or Design Email Format), creation metadata, and a **Duplicate** action.

A standard email/letter template has **Name**, Active/Inactive status, sender-address choice (admin email, sender's own email, or custom address), subject, and message rich-text editor. The editor supports formatting, links, images, tables, special characters, spellcheck, source, and **Add a field** merge fields. The observed merge-field menu includes date/sender, name and contact details, category/gender/demographics/location/group/service data, addresses, family and children fields, username, reporting relationship, giving/security fields, and custom/person fields. A separate **Letter** area controls print font, font size, page margins, rich-text letter content, and file attachment. Template Lockdown supports Departments, Locations, Demographics, Groups, and Access Permissions. No template was saved.

The visual **Design Template** editor includes name, Active/Inactive status, sender-address choice, subject, and a visual email canvas. Its visible demo layout contains rows/columns, text, images, dividers, and linked buttons. The canvas has Desktop and Preview controls and a Content/Blocks/Body panel with draggable building blocks including Columns, Button, Divider, Heading, Paragraph, Image, Social, Menu, and HTML. It has rich-text formatting for text elements, plus Lockdown targeting. The editor's Save Template action was not used.

## Admin — Check-in: live console and rooms

The Check-in console offers **Add Person or Family**, **Self Check-In**, **Start Print Station**, and **Print Test Label**. Console settings choose the people scope (Children Only, Volunteers Only, All People), whether archived people appear in searches, and printer software (Account Default, DYMO Label App, Dymo Connect). The page lists Upcoming Services, room links, Check-in Activity, and a person lookup with Search by Name, filters, and last-name alphabet navigation. Print Station selection can use the default station assigned to the room or a named station; the demo warns that the device has no physical label printer attached. No check-in, label, or person record action was performed.

The Rooms index has **Add Room**, sorting, and room cards with capacity, linked demographics and locations, and **View Check-ins**. A room editor supports name, Active/Inactive status, capacity (zero means unlimited), Print Station assignment, Locations, Demographics, and Service Types. Its help text states that linked demographics automatically associate people in those demographics with the room. No room settings were changed.

## Admin — Needs

The Admin **All Needs** page lists need cards with type, due date, location, status, and assigned member, with page size and pagination. A need record editor exposes name, type, rich-text description, due date, location, status, and assigned member. The observed creation types include Sunday Service Pickup & Drop-off, Catering Request, Home Repairs, and Other type; location choices include configured locations and Any; status starts Unassigned and can be Cancelled. No need was added or edited, and no assignment/status was changed.

## Admin — Calendar

The Admin Calendar has **Add Event**, **Add Calendar**, **Subscribe**, and **Embed** actions; a calendar visibility panel with Select All/Deselect All, user calendars with edit/delete controls, and other system calendars (People Notes, Group Notes, Services, Groups); event filters; and Day/Week/Month views with previous/next/Today navigation. Its grid includes all-day and hourly slots.

The Add Calendar dialog configures name, Published/Draft status, hexadecimal color, whether to show the calendar in the Member Area Calendar, optional Google Calendar integration by Calendar ID, and audience lockdowns by Locations and Departments. No calendar was created, subscribed, embedded, or edited.

## Admin Calendar — subscriptions and embed codes

**Subscribe** lists each user calendar and the built-in People Notes, Group Notes, Services, and Groups calendars, with separate iCal/Outlook and Google Calendar links. **Embed** lets admins choose user calendars and built-in Services/Groups, then configure Calendar vs Upcoming Events List, Day/Week/Month display, Sunday/Monday week start, and optional Locations. It generates a direct link, JavaScript snippet, and iframe snippet; the JavaScript help notes that `&jquery=no` excludes automatic jQuery loading. No link was opened and no embed code was copied or installed.

## Admin — Form submission review

A submission detail page provides Previous/Next navigation, Export, linked-person Change/Unlink/Contact Person actions, Pending/Approve/Decline status controls, and editable submitted fields. For fields tied to a person's profile, the page displays the current profile value alongside the submitted value. Dates and custom fields can be reviewed, and changes have a Save action. No person was contacted, linked/unlinked, approved/declined, edited, or exported.

## Settings — Scheduled Email & SMS

The Scheduled Email & SMS settings page is an admin queue for scheduled messages. The inspected demo showed **No Results Found**, with no message row or available per-message controls.

### Settings — Assets and asset categories

The Assets index provides Add, Manage Categories, search, saved Views, Active filtering, sorting, page size, and card/table presentation. Asset cards show category and location; records can be deleted from the list. The editor has name, archive status, categories, locations, booking administrators, and notification choices: no email, email on request, or email with administrator approval required. It supports required time before and after bookings, plus custom email messages for approval and decline. Category management has Add, Change Order, and Delete; category help describes grouping resources (for example, rooms, vehicles, or items in a package). Assets can be linked to events for booking. No asset or category was changed, and no booking was submitted.

### Settings — Need Types and reminders

**Need Types** settings manage named types with descriptions and expose Add a Need Type plus per-type row controls. The Add flow presents inline name and description fields. The **Need Reminders** settings page has a “Send Email Reminders?” option area and Save; the accessibility tree did not expose its current control/value, so the exact choices are unverified. No type or reminder setting was saved.

### Settings — Note Categories

Note Categories can be added, sorted, and deleted. Each category has a name, a color (hexadecimal), a control to make new notes in that category private by default, and optional Access Permissions that determine who can view notes in it. Category help identifies use for distinguishing notes, reporting, at-a-glance review, and restricting sensitive note access. No category was changed.

### Settings — Access Permissions

Access Permissions can be listed as cards, viewed in a full list, printed, and added. A permission has a descriptive name and separate Admin Area and Member Area module gates. Admin gates cover People, Groups, Services, Songs, Check-in, Reports, Calendar, Events, Forms, Needs, Financial, Emails & Letters, Files, Posts, Pages, Links, Settings, Billing & Plan, Lockdown Areas, and Communication. Member Area gates cover Roster, Needs, Songs, Links, Unavailability, Pages, Sidebars, Files, Member Directory, and Calendar.

Enabled modules expose finer permissions. The observed People controls cover restriction scope; create/view/edit people; category and directory privacy settings; volunteer preferences; activity and sent-message visibility; public/private profile files; shared/private/self notes and note edit/complete/delete; family and volunteering/account tabs; password changes; granting permissions; contacts and volunteers; contact/archive/deceased/delete status; duplicate merge, Views, map, flows, categories/layouts, and CSV import. Reports permissions include create, edit, share, schedule email, delete, export, and manage categories. Financial permissions separate batch, transaction, and pledge view/create/edit/delete, chart-of-accounts access, publishing, and import. Event permissions separate create, details/registration editing, invoices/tickets view, refunds, cancellations, guest management, deletion, and inviting to others' events. The editor has Save; no permission was changed or saved.

### Settings — Demographics, Locations, and Departments

**Demographics** can be added, deleted, and reordered. A demographic can have sub-demographics with drag order, add/remove controls, and independent progression settings. Progression can be **Development Based**, **Age Based**, or **Grade Based**; age ranges use years/months and grade ranges use configured school-grade values. A separate **Assign Demographic Progression** action applies the configured rules to people in bulk. No progression assignment was run.

**Locations** can be added, deleted, and reordered. Each location configures a name, country, timezone, meeting address, optional separate mailing address (or Same As Meeting Address), and a financial-statement note for that location.

**Departments** can be added, merged, deleted, and reordered. A department editor configures its name, volunteer self-assignment, non-conflicting departments/sub-departments/positions, scheduling status (account default, Unconfirmed, Confirmed), and whether a notification must be prepared when scheduling volunteers. Departments have nested sub-departments and positions with add/edit/order/remove controls. No organizational data was changed.

### Settings — Layouts and navigation menus

The Layouts list exposes Add, and its editor has separate **Layout** and **Menu** tabs. Layout settings include layout name, site name/title, department assignment, custom account URL, custom domain, Member Area logo and header background images, background repeat mode, header color/height, navigation background/text colors, Admin Area logo/color, login-page style (Custom, Same as Member Area, Same as Admin Area), logout redirect URL, and iOS home-screen icon. The demo states layout changes cannot be saved.

The Menu editor offers built-in Member Area links (Home, Roster, Songs, Calendar, Member Directory, Group Finder, My Groups, My Giving, Links, Unavailability, Volunteer Preferences, Needs), plus sources for Custom Links, Pages, Post Categories, and Links. Admins can search built-ins, add entries to the menu, remove/reorder menu structure, and save; no change was saved. The separate Sidebars settings route returned “You do not have access to this item” in the demo.


### Files — folder creation and inherited access lockdown
- Folder editor exposes a name field and access modes: specified people only; people assigned to selected Lockdown areas; members and guests; members only; or guests only.
- Folder lockdown can be scoped by department, location, demographic, group, and access permission. The editor explains that files inside inherit the selected folder lockdown; leaving lockdown selections empty makes the files visible to everyone, subject to the chosen access mode.
- Folder creation is an explicit Save action; no folder was created.

### Files — folder list and filters
- Folder index shows folders in a record list and provides Add Folder and Add File actions, a Filter panel, and per-folder Edit plus an additional unlabeled row action whose purpose was not verified.
- The filter panel supports locations, demographics, departments, and access permissions, with Clear Filters and Apply controls. Each category exposes selectable values; the demo currently showed all listed values checked, so the result of narrowing was not tested.

### Settings access boundary — Account, Security, Legal & Compliance
- The Settings hub links to Account (account information, location, language), Legal & Compliance, and Passwords & Security. Directly opening those three observed hub links in the current demo session redirects to the Admin dashboard with “You do not have access to this item.” Their controls could not be inspected in this role/session; this is a demo access boundary, not evidence that the product lacks the features.
- Re-logged into the public demo using its explicit Super Admin role option (available after Log Out). Account remained inaccessible in that role, confirming this is a demo-level route restriction; the switch did not expose account controls.

### Settings — Super Admins and Integrations
- Settings hub exposes Super Admins, described as configuring the account's Super Admin users. Its observed route redirects to the Admin dashboard with “You do not have access to this item,” even after selecting the demo's Super Admin login role; controls could not be inspected.
- Integrations page opens and states that settings cannot be saved in the demo. It provides Add and “create one now” entry points and an empty-state message when no integrations exist. Following the create entry point produced an “Internal Server Error” modal, so integration types, fields, and management actions remain unverified.

### Settings — Formatting, export defaults, and label templates
- Account-wide formatting includes date formats (US slash, day/month slash, dotted, dashed, ISO); 12/24-hour time; currency selection; and a custom address format built from address/city/state/postcode/country placeholders, with a default-format example.
- Export/print settings include PDF/XLS paper size (A4 or Letter) and font (Arial, Arial Unicode MS, Khmer). Label settings choose among Avery sheet layouts and support separate Address Label and Name Tag Label templates.
- The label editor supports a template name, a field search/palette, a Format editor, default template preview, tips for full mailing/home address fallback, and Save Label/Cancel. The visible merge-field families include person details; contact details and email/SMS preferences; access permissions/departments/positions/demographics/locations/service types; groups; account details; mailing/home addresses; family/relationships; child/safeguarding fields; financial receipt/giving/transaction fields; and custom fields. No template was saved.

### Settings — Built-in Contact Templates catalog and editor
- Contact Templates is organized into People, Groups, Notes, SMS, Services & Volunteers, Needs, Forms, Events, Event Registration, Reports, and Assets. Templates cover login details (normal/social registration), password resets (including inactive accounts), new-account and family-approval notices, People Flow assignment/reminders, unsubscribe and Member Directory opt-in approvals, birthday/anniversary messages; group new-person/new-report notices, attendance and meeting reminders, unread-message notices, join-request notifications/responses/acceptance/decline; scheduled/rescheduled/completed note notifications; SMS reply success/failure/no-email cases; volunteer contact (single/multiple service), confirmed/declined Reports To notices, scheduled/unscheduled notifications, unconfirmed follow-up, schedule reminders, swap and replacement request/completion/no-response/accepted/unsuccessful/cancelled notices for requestors, volunteers, and Reports To people; need reminders and new-need notices; normal/approval-required form submissions; manual/automated event invitation; registration invoice and invoice/ticket messages; scheduled report email; asset booking (normal/approval-required), approval, and decline.
- Template detail editor supports subject and rich-text email message editing, formatting/alignment/lists/indent/quotes/links/images/tables/special characters/font/size/color/source, Insert File, merge-field reference, Save, and Restore Default Template. Demo contents were not saved.
