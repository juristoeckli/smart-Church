# Delivery plan

Status: implementation started. The TypeScript workspace, shared contracts, PostgreSQL-backed People directory and Services & events schedule, configurable GfC locations/logo, local sign-in, explicit location memberships, and server-enforced access checks are in place. Core location rights cover private people details and management of people, events, groups, and bookable resources. Personal account settings include a server-saved date/time format (default DD.MM.YYYY HH:MM), used by core views, notifications, chat, community feed, resource bookings, and built-in module views; users can also inspect and revoke active sign-in sessions. The per-user language setting is persisted for English, German, French, and Italian; localization currently covers shared navigation, personal settings, Overview, Groups, and the Services & events schedule list/calendar. Event management dialogs and follow-up/check-in workflows, other core pages, and module translations remain outstanding. Administrator diagnostics show system CPU utilization, host and container memory, persistent application-volume capacity and free space, worker status, and recent logs. Groups have dated attendance records, leader-approved public sign-up requests, and the Community feed supports department-scoped posts, comments, and likes for signed-in members. Services & events support headcounts, individual check-ins, first-time visitor markers, an assigned follow-up queue, and public event registration with capacities, waitlists, shareable signup links, and registrant check-in. Notifications provides an in-app inbox, location and selected-group announcements, event reminders, volunteer service-position requests, and visitor follow-up assignment and due-date reminders, plus opt-in Resend email delivery with retries, signed delivery webhooks, suppression handling, and per-message status. Manifest validation, dependency ordering, required-module protections, supervised worker health, timeouts, bounded restarts, and failure isolation are in place. A reusable third-party worker protocol/SDK, worker restart controls, rich email templates, password recovery and push login approval, and remaining Milestone 1 modules are outstanding.

## Milestone 1 — foundation

Agreed scope: Core, departments, local login, permissions, worker management, required Notifications, System Management and File Storage modules, and one example module.

- [x] [M1: Set up TypeScript workspace and shared contracts](https://github.com/juristoeckli/smart-Church/issues/1)
- [x] [M1: Implement installation setup and location isolation](https://github.com/juristoeckli/smart-Church/issues/2) — one-time setup, a persistent installation UUID linked to department UUIDs, location switching, explicit memberships and membership checks on Core APIs, built-in module routes and WebSockets are in place; end-to-end isolation verification remains tracked in #8.
- [x] [M1: Implement local authentication and scoped permissions](https://github.com/juristoeckli/smart-Church/issues/3) — local credentials use scrypt, active sign-in sessions can be inspected and revoked, and department access requires explicit membership with server-enforced permissions.
- [ ] [M1: Implement module SDK and worker supervision](https://github.com/juristoeckli/smart-Church/issues/4) — manifests now validate version/required/dependency metadata and registration order; required Notifications and File Storage cannot be disabled. The Video worker has authenticated loopback WebSocket registration/routing and supervised health, timeout, restart, and failure-isolation behavior. Module activation is now stored installation-wide, with location-specific data/settings retained. A reusable third-party worker protocol remains open.
- [ ] [M1: Build shared React shell and example module](https://github.com/juristoeckli/smart-Church/issues/5)
- [ ] [M1: Add required Notifications module](https://github.com/juristoeckli/smart-Church/issues/6) — the in-app inbox, site-admin announcements, read state, one-day event reminders and volunteer service-position requests are in place; email delivery/templates remain outstanding.
- [ ] [M1: Add required System Management module](https://github.com/juristoeckli/smart-Church/issues/7)
- [ ] [M1: Verify end-to-end isolation and failure recovery](https://github.com/juristoeckli/smart-Church/issues/8)

Suggested order: #1 → #2/#3 → #4 → #5/#6/#7 → #8. These are dependencies, not an instruction to implement all later features now.

Completion: a browser user can log in, select an authorised department, edit an example record via its worker, receive live updates and inspect scoped module health. Department access remains isolated and a crashing/hanging worker does not take down the application.

## Later milestones — proposed grouping, not fixed implementation scope

1. Desktop and offline: Electron shell, SQLite adapters, profile modes, last-confirmed permissions, offline editing/conflicts, module-specific incompatible-reset flow and selected local workers.
2. Identity and sharing: remote installation signing/trust, home-server authentication, explicit central administration grants, cross-server department navigation, library sharing and readonly replicas; push login approval and password recovery.
3. Files and retention: larger and resumable uploads, quotas, separate licensed datasets, offline downloads, History/trash.
4. Operations: Backup selectable Application/Storage/Database, recovery tool, managed PostgreSQL/external option, optional Nginx, resource limits and managed GitHub Release updates.
5. Optional interfaces/modules: Kiosk, actual device-control modules and Android wrapper.

Some infrastructure will need earlier primitives; implement those narrowly without pulling entire later workflows into Milestone 1.

## Future, not required now

Active/passive department availability. Preserve department identity/export-import design, but no continuous replication or automatic failover initially.

## Outstanding implementation decisions

- Precise signed-request standard, key storage/rotation/recovery.
- SSO protocol and home-server unavailable behaviour.
- Release integrity/signature verification.
- Third-party UI extension build/loading and dependency policy.
- Exact file/database adapters and deployment packaging.
- Private-field encryption/key custody, offline private-data policy.
- OTP sizes/brute-force policies, detailed session lifetimes.
- Which Sync/Backup/History capabilities are required in each supported deployment.

Refer to [ARCHITECTURE.md](ARCHITECTURE.md) for all agreed behaviour. Do not treat outstanding details as already implemented or decided.
