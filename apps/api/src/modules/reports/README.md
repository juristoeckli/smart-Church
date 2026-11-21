# Reports module

The optional Reports module combines a fixed catalog with a bounded ad-hoc designer. All queries are defined in server code, parameterized, scoped to the active location (`department_id`), and gated by Reports access plus the corresponding People, Groups, Events, or Finance permissions. The module does not accept user-authored SQL.

## Implemented report definitions

- **People directory** — first/last name, email, phone, status and creation date; optional status and created-date range.
- **People consent history** — person, consent purpose/status, capture time, expiry, and recorded-by name with an optional date range. Private consent notes are never selected or exported.
- **People status changes** — audited member/visitor changes recorded through People Records, with previous/new value, time, actor, and optional date range. This report reflects People Records edits, not writes made through other contact APIs.
- **Upcoming birthdays and wedding anniversaries** — private People data for the next 30 days; access requires private People permission and birthday exports omit age.
- **Group summary** — per-group membership totals for active, paused and waitlist members.
- **Group roster** — member names, role, membership status, join date and contact details for a selected group.
- **Group leaders** — names, current leader/co-leader/owner/manager roles, and membership start dates for active members of active groups; an optional group filter is available. Reports/Groups permissions are required. Email and phone are not included; results are capped at 5,000 rows.
- **Group hierarchy** — active groups with parent group, active child group names, lifecycle status, and start/end dates; an optional group filter is available. It requires Reports/Groups permissions and is listed only when the hierarchy and lifecycle columns are installed. The current `church_groups` schema has no group-type field, so type is not included.
- **Group meeting attendance** — present, absent and excused counts by meeting and group, with optional group and date filters.
- **Group meeting feedback** — leader and attendee answers by meeting, question and response type, with optional group and meeting-date filters. Respondent identities and contact details are omitted; access requires Reports view plus Groups management permission, and results stay within the active location. Answers are free text and may contain sensitive information. If a feedback prompt was later removed or changed, its prior answer is labeled `Removed or renamed question`. The report is listed only when the group feedback, attendee response and meeting schemas are installed.
- **Group lifecycle history** — dated group creation, updates, and deletion with selected before/after group metadata and actor; membership rows are omitted to avoid leaking private person records.
- **Event attendance** — event date/title/type/location, recorded adult/child totals and individual check-in/first-time visitor counts; optional event date range.
- **Event staffing** — service date/title, each volunteer role, assigned person, and pending/confirmed/declined response mapped from the existing service-position response records; optional event date range.
- **Event absence conflicts** — assigned role, person, service date/title and response status when an active absence overlaps the service date, including absence dates and the shared reason. Requires an event-manager or site-admin role and a date range of at most 367 calendar dates; private absence notes are never selected or exported. The report is listed only when the absence, service-event and event-position-response tables exist.
- **Event service plan** — ordered plan items by service date/event, start time, duration, item title, linked song title, role category, and item notes; optional date range. Requires Events access and is listed only when service events and Worship songs are installed.
- **Event registration summary** — event capacity, registered/waitlisted/cancelled totals, check-ins and remaining places; optional date range.
- **Event registration list** — registrant name/email, status, registration time and check-in time; optional date range and private People permission. Contact data is not included in the summary report.
- **Check-in trend** — daily event count, individual check-ins and first-time visitors over a selected date range.
- **Visitor follow-up** — first-time visitor, event and follow-up status; optional event date range and follow-up state.
- **Worship song usage** — count and latest date for songs included in service plans, with optional date filters. It is listed only when the Worship Planning schema is installed.
- **Resource bookings** — booking totals by resource and requested/approved/declined counts, with optional date filters. It requires resource-management access and is listed only when booking tables exist.
- **Resource utilization** — monthly requested and approved reservation hours, booking counts by status, and resource/category; optionally filter by booking start date. Hours are wall-clock reservation duration and do not account for resource buffers or quantity.
- **Finance account summary** — posted debit/credit totals by account and accounting year; optional booking-date range, if the Finance module schema exists and the viewer has Finance access.
- **Finance budget vs actual** — each configured budget scope with posted debit and credit totals for the same year and account/cost-center scope; optionally filter by accounting year. The report does not net debits/credits or merge overlapping budget scopes. A posting can therefore contribute to a broad budget row and a more specific budget row; rows are independent scopes and should not be added together. Available only when both Finance transactions and budgets are installed.
- **Donor giving totals** — posted transaction count, credit totals, debit/reversal totals, net giving, and latest transaction by donor; optional booking-date range. Donor email is not exported. Available only when the Finance donor and transaction tables are installed.

Reports render a limited table preview, with CSV export of the returned rows. Saved definitions are scoped to the active location, contain only a catalog key and validated filters, and are visible to users who can run that report. A manager can save a definition and remove definitions they own; site administrators can remove any definition.

## Ad hoc designer

The designer exposes fixed People, Groups, Group memberships, Events/attendance, and Finance posting datasets only when their required permissions and schemas are available. When People custom fields are installed and the viewer has private People access, active text, date, boolean, and select fields are added to the People dataset with location-scoped values. Membership custom values are also added as text columns to the Group memberships dataset for users with People access. A user can choose up to twelve allow-listed columns, add up to eight typed filters, sort, group by one field, and apply count/sum/average to an approved numeric field. Source queries are fixed and location-scoped, capped at 5,000 rows; previews and CSV exports are capped at 500 rows. Personal definitions can be saved, edited, and deleted by their owner; the API revalidates the dataset and every selected field/operator on each save and preview. The designer does not accept SQL, table names, joins, custom expressions, or user-supplied query fragments.

## Not implemented

This is an initial reporting slice, not feature parity with ChurchTools reporting. The following report families and features remain unimplemented:

- Full ChurchTools ad-hoc report designer: arbitrary joins, calculated expressions, multiple grouping levels, report templates, shared layouts, and organization-wide designer definitions. Custom person and membership fields are exposed in their respective datasets only.
- People reports for membership/entry/exit changes, addresses/geographic distribution, tags/categories, relationships/families, teams, archive, and duplicates. Custom person fields are available in the ad-hoc People dataset, but there are no dedicated custom-field reports.
- Group reports for group-type classifications and group metadata/custom fields. The fixed lifecycle report covers only group records, not member-level lifecycle changes.
- Event reports for cancellations beyond registration status totals, and per-event attendance trends beyond the current summaries. The service plan report lists ordered item details but does not report role assignees or attachments.
- Additional Finance-specific reports not yet in this catalog: donation-receipt issuance/eligibility, tax reports, and bank reconciliation summaries. The Finance module has its own ledger statements and budget workflows.
- CCLI reports; communication delivery, process/flow, check-in, and module-specific operational reports.
- User-selected columns, aggregates, pivots, charts, report scheduling, emailed delivery, PDF/Excel/SAGE/DATEV exports, and asynchronous large-report generation.
- Saved-report editing, version history, explicit sharing/ownership controls, and organization-wide report templates.

The current result limits are fixed per report. CSV export includes the rows returned by the current bounded query.
