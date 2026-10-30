# ChurchTools replacement parity matrix

Status: draft for review with church users. This matrix records current Smart Church evidence and questions; it does not claim ChurchTools parity before a church reviewer confirms the workflows.

Scope: core church-management workflows only. EventDesk is excluded.

## Review key

- **Implemented** means the named Smart Church capability is present in the current repository. It does not mean a church has confirmed it replaces its ChurchTools workflow.
- **Partial** means there is a usable slice, but a material workflow, field mapping, permission, or migration gap remains.
- **Open** means the capability is not implemented or cannot be verified against the current integration API.
- Importance and migration priority are intentionally left for church users to rank.

## Workflow matrix

| Area | ChurchTools workflows for reviewer to confirm | Current Smart Church capability and evidence | Status and known gap | Importance / migration priority | Linked work |
| --- | --- | --- | --- | --- | --- |
| People directory and profiles | Find people; maintain contact details, family relationships, custom fields, statuses, privacy and access | Location-scoped People directory and editing are present. Elvanto import retains a profile snapshot; export currently maps first/last name, email and phone. | **Partial.** Compare field coverage, family relationships, profile privacy, archive/status rules, duplicate handling and ownership after migration. | _Church review_ | [#19](https://github.com/juristoeckli/smart-Church/issues/19), [#35](https://github.com/juristoeckli/smart-Church/issues/35) |
| Accounts and permissions | Grant/revoke user access; assign roles; protect sensitive data; deactivate or recover accounts | Explicit location membership, location roles and core grants are enforced on server routes. Users can inspect/revoke sessions; password-reset users are required to change their password. | **Partial.** Confirm ChurchTools role equivalents, field-level privacy, account lifecycle, delegated administration, and recovery procedures. | _Church review_ | [#19](https://github.com/juristoeckli/smart-Church/issues/19) |
| Groups and membership | Create groups; assign leaders/members; manage public join requests; record attendance | Groups, memberships, dated attendance, public sign-up requests and approvals are present. Elvanto group import/export supports reviewed batches; local-only memberships are retained on refresh. | **Partial.** Confirm subgroup/household structures, group history, leader rights, invitations, reporting, and migration of inactive memberships. | _Church review_ | [#19](https://github.com/juristoeckli/smart-Church/issues/19), [#35](https://github.com/juristoeckli/smart-Church/issues/35) |
| Services, events and attendance | Schedule services/events; manage plans and assignments; record attendance and follow-up | Services & events support schedules, headcounts, individual check-in, first-time-visitor markers, follow-up queues, public registration, capacities and waitlists. Elvanto service/calendar data has one-way import slices. | **Partial.** Confirm recurring services, service plans, volunteer rosters, pastoral follow-up, attendance reports and history. Elvanto's documented Services API currently lists read endpoints only, so a reverse adapter needs another supported write path. | _Church review_ | [#19](https://github.com/juristoeckli/smart-Church/issues/19), [#35](https://github.com/juristoeckli/smart-Church/issues/35) |
| Public registration | Publish an event; accept registrations; handle capacity, waitlists and check-in | Public event registration supports capacity limits, waitlists, shareable links and registrant check-in. | **Partial.** Confirm guest/family registration, cancellation, consent, notifications, exports and ChurchTools migration behavior. | _Church review_ | [#19](https://github.com/juristoeckli/smart-Church/issues/19) |
| Resources and bookings | Maintain rooms/assets; request, approve and resolve booking conflicts | Location-scoped Resources and booking requests/approval workflows are present. | **Partial.** Confirm recurring bookings, calendars, equipment/room rules, conflict policy, access, and historical bookings. | _Church review_ | [#19](https://github.com/juristoeckli/smart-Church/issues/19) |
| People workflows and care | Define workflows; assign steps; track due dates, notes, completion and responsible users | Elvanto People Flows can be imported as read-only definitions and assignment snapshots. | **Open / partial.** There is no active native workflow engine for executing and updating care workflows. Confirm required workflows, confidentiality, escalation and reporting. | _Church review_ | [#19](https://github.com/juristoeckli/smart-Church/issues/19), [#35](https://github.com/juristoeckli/smart-Church/issues/35) |
| Giving and finance | Record donations; manage donors, funds, receipts, batches, reconciliation and reports | Elvanto giving transactions can be imported as encrypted, site-admin-only snapshots behind a separate authorization. | **Open / partial.** No native giving ledger, receipts or reconciliation workflow. Confirm accounting boundaries, permissions, retention and migration requirements before enabling financial data. | _Church review_ | [#19](https://github.com/juristoeckli/smart-Church/issues/19), [#35](https://github.com/juristoeckli/smart-Church/issues/35) |
| Songs and worship planning | Maintain songs/arrangements; build service plans; manage keys, charts and sequences | Elvanto song/arrangement snapshots can be imported and inspected. Services can retain imported plan items. | **Open / partial.** No standalone native song library and service-plan picker; export and live account verification remain open. Confirm licensing/lyrics access and musician workflows. | _Church review_ | [#19](https://github.com/juristoeckli/smart-Church/issues/19), [#35](https://github.com/juristoeckli/smart-Church/issues/35) |
| Communications and notifications | Send announcements and reminders; track delivery and preferences | In-app inbox, location announcements, event/service reminders, email delivery, retries and responsive HTML/plain-text templates are present. | **Partial.** Confirm audience targeting, consent, templates, delivery reporting, retention and migration of communication history. Per-notification template customization remains future work. | _Church review_ | [#19](https://github.com/juristoeckli/smart-Church/issues/19) |
| Files and records | Store and share church documents; control access; retain history or recover deleted files | Required File Storage module has location-scoped file management and access controls. | **Partial.** Confirm quotas, bulk migration, version history, retention/trash, external sharing, backup/restore and file ownership. | _Church review_ | [#19](https://github.com/juristoeckli/smart-Church/issues/19) |
| Locations and administration | Manage multiple locations; switch context; administer modules and installation health | Location isolation, location switching, module management, worker health, diagnostics and separate installation grants are present. | **Partial.** Confirm central administration, cross-location reporting, account provisioning, managed updates, backup and recovery processes. | _Church review_ | [#19](https://github.com/juristoeckli/smart-Church/issues/19) |
| Language, date and time | Use supported languages and local date/time conventions consistently | User language preference supports EN/DE/FR/IT with English fallback. User date/time format defaults to `DD.MM.YYYY HH:MM`; locations have time zones. | **Partial.** Full German/French/Italian coverage and persistence/UI verification remain open. Confirm local formats, time-zone behavior and authored-content handling. | _Church review_ | [#19](https://github.com/juristoeckli/smart-Church/issues/19), [#34](https://github.com/juristoeckli/smart-Church/issues/34) |
| Data migration and integrations | Export/import data; map IDs and relationships; preview conflicts; resume and audit migrations | Elvanto has encrypted credentials, per-area directions, permission checks, reviewed previews, resumable People/Groups exports, and one-way imports for several areas. | **Partial.** ChurchTools migration tooling, full field/relationship mapping, incremental sync, complete bidirectional conflict/deletion rules, write verification and audit history remain open. | _Church review_ | [#19](https://github.com/juristoeckli/smart-Church/issues/19), [#35](https://github.com/juristoeckli/smart-Church/issues/35) |

## Church reviewer worksheet

For each row, a church reviewer should record:

1. The ChurchTools screen or workflow currently used, including any local conventions.
2. Whether Smart Church supports it today: yes, partly, or no.
3. The consequence if the workflow is missing and a priority: blocking, important, or optional.
4. Data that must be migrated, retained, archived or excluded.
5. The responsible church role and permissions required.
6. A concrete acceptance example and any linked implementation issue.

Reviewer: _to be nominated by the project owner._

Review date: _pending._

## Sources

- [Current delivery plan](MILESTONES.md)
- [Architecture baseline](ARCHITECTURE.md)
- [Elvanto integration scope and limits](ELVANTO_SYNC.md)
- [Localization workflow](LANGUAGES.md)
- [Roadmap issue #19](https://github.com/juristoeckli/smart-Church/issues/19)
