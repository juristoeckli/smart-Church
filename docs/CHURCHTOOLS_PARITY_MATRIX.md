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
| People directory and profiles | Find people; maintain contact details, family relationships, custom fields, statuses, privacy and access | Location-scoped People directory and editing support contact details and member/visitor status. | **Partial.** Family relationships, custom fields, profile privacy, archive/status rules, duplicate handling and ownership after migration need review. | _Church review_ | [#19](https://github.com/juristoeckli/smart-Church/issues/19), [#44](https://github.com/juristoeckli/smart-Church/issues/44) |
| Accounts and permissions | Grant/revoke user access; assign roles; protect sensitive data; deactivate or recover accounts | Explicit location membership, location roles and core grants are enforced on server routes. Users can inspect/revoke sessions; password-reset users are required to change their password. | **Partial.** Confirm ChurchTools role equivalents, field-level privacy, account lifecycle, delegated administration, and recovery procedures. | _Church review_ | [#19](https://github.com/juristoeckli/smart-Church/issues/19) |
| Groups and membership | Create groups; assign leaders/members; manage public join requests; record attendance | Groups, memberships, dated attendance, public sign-up requests and approvals are present. | **Partial.** Confirm subgroup/household structures, group history, leader rights, invitations, reporting, and migration of inactive memberships. | _Church review_ | [#19](https://github.com/juristoeckli/smart-Church/issues/19), [#44](https://github.com/juristoeckli/smart-Church/issues/44) |
| Services, events and attendance | Schedule services/events; manage plans and assignments; record attendance and follow-up | Services & events support schedules, weekly/biweekly/monthly recurring series (up to one year ahead), series edits/deletion, headcounts, individual check-in, first-time-visitor markers, follow-up queues, public registration, capacities and waitlists. | **Partial.** Confirm service-plan depth, volunteer roster workflow, pastoral follow-up, attendance reports/history, and whether the recurring-series rules match church practice. | _Church review_ | [#19](https://github.com/juristoeckli/smart-Church/issues/19) |
| Public registration | Publish an event; accept registrations; handle capacity, waitlists and check-in | Public event registration supports capacity limits, waitlists, shareable links and registrant check-in. | **Partial.** Confirm guest/family registration, cancellation, consent, notifications, exports and ChurchTools migration behavior. | _Church review_ | [#19](https://github.com/juristoeckli/smart-Church/issues/19) |
| Resources and bookings | Maintain rooms/assets; request, approve and resolve booking conflicts | Location-scoped Resources and booking requests/approval workflows are present. | **Partial.** Confirm recurring bookings, calendars, equipment/room rules, conflict policy, access, and historical bookings. | _Church review_ | [#19](https://github.com/juristoeckli/smart-Church/issues/19) |
| People workflows and care | Define workflows; assign steps; track due dates, notes, completion and responsible users | There is no active native workflow engine for assigning, completing, or reporting care workflows. | **Open.** Confirm required workflows, confidentiality, escalation, responsible roles and reporting before designing a native workflow module. | _Church review_ | [#19](https://github.com/juristoeckli/smart-Church/issues/19) |
| Giving and finance | Record donations; manage donors, funds, receipts, batches, reconciliation and reports | No native giving ledger, receipts or reconciliation workflow is currently present in the ChurchTools replacement scope. | **Open.** Confirm accounting boundaries, permissions, retention and migration requirements with church finance owners before designing this sensitive workflow. | _Church review_ | [#19](https://github.com/juristoeckli/smart-Church/issues/19) |
| Songs and worship planning | Maintain songs/arrangements; build service plans; manage keys, charts and sequences | Location-scoped song/arrangement catalog, HTTPS links to licensed charts/audio, reusable service-plan templates, volunteer positions, ordered timed plans with responsible roles, and applying templates to events are implemented. Lyrics are not stored. | **Partial.** Church workflow and role review is still pending; confirm licensing expectations, musician handoff, and any required scheduling/printing workflows before expanding this slice. User prioritized this area; current edit access reuses `events_manage`. | _Church review_ | [#19](https://github.com/juristoeckli/smart-Church/issues/19), [#47](https://github.com/juristoeckli/smart-Church/issues/47) |
| Communications and notifications | Send announcements and reminders; track delivery and preferences | In-app inbox, location announcements, event/service reminders, email delivery, retries and responsive HTML/plain-text templates are present. | **Partial.** Confirm audience targeting, consent, templates, delivery reporting, retention and migration of communication history. Per-notification template customization remains future work. | _Church review_ | [#19](https://github.com/juristoeckli/smart-Church/issues/19) |
| Files and records | Store and share church documents; control access; retain history or recover deleted files | Required File Storage module has location-scoped file management and access controls. | **Partial.** Confirm quotas, bulk migration, version history, retention/trash, external sharing, backup/restore and file ownership. | _Church review_ | [#19](https://github.com/juristoeckli/smart-Church/issues/19) |
| Locations and administration | Manage multiple locations; switch context; administer modules and installation health | Location isolation, location switching, module management, worker health, diagnostics and separate installation grants are present. | **Partial.** Confirm central administration, cross-location reporting, account provisioning, managed updates, backup and recovery processes. | _Church review_ | [#19](https://github.com/juristoeckli/smart-Church/issues/19) |
| Language, date and time | Use supported languages and local date/time conventions consistently | User language preference supports EN/DE/FR/IT with English fallback. User date/time format defaults to `DD.MM.YYYY HH:MM`; locations have time zones. | **Partial.** Full German/French/Italian coverage and persistence/UI verification remain open. Confirm local formats, time-zone behavior and authored-content handling. | _Church review_ | [#19](https://github.com/juristoeckli/smart-Church/issues/19), [#34](https://github.com/juristoeckli/smart-Church/issues/34) |
| Data migration and integrations | Export/import data; map IDs and relationships; preview conflicts; resume and audit migrations | ChurchTools has a separate one-time migration preview/import for people, groups and memberships, events, and resources. It uses encrypted snapshots, stable ID crosswalks, conflict review, resumable batches, per-record failure tracking, and retry. Imported records remain editable and separate from scheduled sync cleanup. | **Partial.** Person profiles/relationships, richer group membership details, recurrence/service plans beyond the mapped event snapshot, and resource bookings are not imported. The source API schema and recovery flow still need verification on a non-production ChurchTools site. Incremental bidirectional sync is not part of the one-time migration. | _Church review_ | [#19](https://github.com/juristoeckli/smart-Church/issues/19), [#44](https://github.com/juristoeckli/smart-Church/issues/44) |

## Church reviewer worksheet

For each row, a church reviewer should record:

1. The ChurchTools screen or workflow currently used, including any local conventions.
2. Whether Smart Church supports it today: yes, partly, or no.
3. The consequence if the workflow is missing and a priority: blocking, important, or optional.
4. Data that must be migrated, retained, archived or excluded.
5. The responsible church role and permissions required.
6. A concrete acceptance example and any linked implementation issue.

Reviewer: _project owner (juristoeckli); review pending._

Review date: _pending._

## Sources

- [Current delivery plan](MILESTONES.md)
- [Architecture baseline](ARCHITECTURE.md)
- [Elvanto integration scope and limits](ELVANTO_SYNC.md)
- [Localization workflow](LANGUAGES.md)
- [Roadmap issue #19](https://github.com/juristoeckli/smart-Church/issues/19)
