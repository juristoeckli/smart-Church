# Delivery plan

Status: Milestone 1's source-based Windows and Debian-container smoke checks have passed; broader ChurchTools parity, localization completion, and Elvanto sync remain open. Elvanto connection setup now encrypts an API key, validates People read access, and stores per-area directions with an explicit financial-data gate, but it does not synchronize records. The TypeScript workspace, shared contracts, PostgreSQL-backed People directory and Services & events schedule, configurable GfC locations/logo, local sign-in, explicit location memberships, and server-enforced access checks are in place. Core location rights cover private people details and management of people, events, groups, and bookable resources. Personal account settings include a server-saved date/time format (default DD.MM.YYYY HH:MM), used by core views, notifications, chat, community feed, resource bookings, and built-in module views; users can also inspect and revoke active sign-in sessions. The per-user language setting is persisted for English, German, French, and Italian; localization covers shared navigation, personal settings, Overview, People, Groups, Resources, public registration, the Services & events schedule, and translated built-in module interfaces. Other core pages and some module text remain outstanding. Administrator diagnostics show system CPU utilization, host and container memory, persistent application-volume capacity and free space, worker status, and sanitized recent logs. Separate installation grants now control diagnostics viewing, worker troubleshooting/restart, and installation management; a full Server Administrator retains all grants. Groups have dated attendance records, leader-approved public sign-up requests, and the Community feed supports department-scoped posts, comments, and likes for signed-in members. Services & events support headcounts, individual check-ins, first-time visitor markers, an assigned follow-up queue, and public event registration with capacities, waitlists, shareable signup links, and registrant check-in. Notifications provides an in-app inbox, user-ID-based email delivery through server-configured SMTP or direct delivery, retries, suppression handling, per-message status, and a reusable responsive HTML/plain-text email template; per-notification template customization remains future work. Manifest validation, dependency ordering, required-module protections, supervised worker health, timeouts, bounded restarts, and failure isolation are in place. The Video worker transport contract and a reusable worker client SDK are documented; arbitrary third-party installation and a module-neutral worker host, password recovery and push login approval, complete localization, and Elvanto data synchronization remain outstanding.

The Sync module generates a persistent Ed25519 installation identity and supports manually verified, dual-approved peer pairing, signed peer-status checks, durable replay rejection, explicit scoped shares, and manual push/pull snapshots for people names/status and service/event schedules. A separate primary/standby workflow automatically pushes complete core and module-owned snapshots over the existing HTTPS/API endpoint, tracks per-standby replication health, and self-fences a former primary after it sees a trusted peer's newer epoch. Promotion remains manual and requires external fencing. The settings page has three tabs: ChurchTools, Elvanto, and Server-to-server. Full redundancy remains not ready for production until two independent installations complete recovery, account sign-in provisioning, and fencing/rejoin verification. See [the server-to-server sync plan](SERVER_TO_SERVER_SYNC.md).

## Milestone 1 — foundation

Agreed scope: Core, departments, local login, permissions, worker management, required Notifications, System Management and File Storage modules, and one example module.

- [x] [M1: Set up TypeScript workspace and shared contracts](https://github.com/juristoeckli/smart-Church/issues/1)
- [x] [M1: Implement installation setup and location isolation](https://github.com/juristoeckli/smart-Church/issues/2) — one-time setup, a persistent installation UUID linked to department UUIDs, location switching, explicit memberships and membership checks on Core APIs, built-in module routes and WebSockets are in place; two-location REST and WebSocket isolation was verified in #8.
- [x] [M1: Implement local authentication and scoped permissions](https://github.com/juristoeckli/smart-Church/issues/3) — local credentials use scrypt, active sign-in sessions can be inspected and revoked, and department access requires explicit membership with server-enforced permissions.
- [x] [M1: Implement module SDK and worker supervision](https://github.com/juristoeckli/smart-Church/issues/4) — manifests now validate version/required/dependency metadata and registration order; required Notifications and File Storage cannot be disabled. The Video worker has authenticated loopback WebSocket registration/routing and supervised health, timeout, restart, and failure-isolation behavior. Module activation is stored installation-wide, with location-specific data/settings retained. The Video worker transport contract and reusable `@smart-church/worker-sdk` are in [THIRD_PARTY_WORKER_PROTOCOL.md](THIRD_PARTY_WORKER_PROTOCOL.md) and `packages/worker-sdk`; the module-neutral host and third-party installation flow remain later work.
- [x] [M1: Build shared React shell and example module](https://github.com/juristoeckli/smart-Church/issues/5) — the Module Demo has its own location-scoped SQL table, permission-checked create/delete routes, translated UI, and live change updates; two-location runtime isolation and permission checks passed in #8.
- [x] [M1: Add required Notifications module](https://github.com/juristoeckli/smart-Church/issues/6) — the in-app inbox, preferences, permission-controlled user-ID announcements, event reminders, volunteer service-position requests and follow-up notices are in place. Server Administrators configure direct SMTP or a relay; delivery handles suppression and retry state without exposing recipient addresses to the calling module. Notification emails use a reusable, responsive HTML/plain-text template with localized controls; per-notification template customization remains future work.
- [x] [M1: Add required System Management module](https://github.com/juristoeckli/smart-Church/issues/7) — module list, installation-scoped sanitized diagnostics, and worker restart requests are protected by independently assignable view, troubleshoot, and manage grants; full Server Administrators receive all grants.
- [x] [M1: Verify end-to-end isolation and failure recovery](https://github.com/juristoeckli/smart-Church/issues/8) — a source-mounted Windows Docker development build and Debian 12 container smoke run verified two-location data isolation, membership/permission denials, authenticated REST/WebSocket access, worker timeout and supervised restart, and continued API/Notifications health.

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

Full active/passive department availability is not ready for production until the manual primary/standby, external fencing, account recovery, and rejoin procedures in [SERVER_TO_SERVER_SYNC.md](SERVER_TO_SERVER_SYNC.md) have been verified against two independent installations. Automatic failover remains deferred until a quorum or external fencing authority is available.

## Outstanding implementation decisions

- Sync data-scope and per-field grants, record adapters, signed key rotation, and identity recovery. The current signed pairing/status protocol and key storage are defined in [SERVER_TO_SERVER_SYNC.md](SERVER_TO_SERVER_SYNC.md).
- SSO protocol and home-server unavailable behaviour.
- Release integrity/signature verification.
- Third-party UI extension build/loading and dependency policy.
- Exact file/database adapters and deployment packaging.
- Private-field encryption/key custody, offline private-data policy.
- OTP sizes/brute-force policies, detailed session lifetimes.
- Which Sync/Backup/History capabilities are required in each supported deployment.

Refer to [ARCHITECTURE.md](ARCHITECTURE.md) for all agreed behaviour. Do not treat outstanding details as already implemented or decided.
