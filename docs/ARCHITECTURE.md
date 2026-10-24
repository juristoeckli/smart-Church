# smart-Church architecture

Status: agreed planning baseline, 24 October 2026. This document describes intended behaviour, not implemented features. Examples such as Inventory and Machine Control illustrate module boundaries; their full product requirements remain to be defined.

## 1. Goals and platform

A modular application serving browsers, kiosks, Windows/Android clients and REST integrations. Windows is the development platform; Debian Linux is the primary server deployment. Low-power physical hosts must be supported without requiring a VM. Some interactive updates target below 100 ms end-to-end; measure actual device/protocol paths. This is not a hard real-time or machine-safety system.

Baseline:
- TypeScript, Node.js LTS and Fastify for Core and default workers.
- React and TypeScript for the shared UI.
- Electron for Windows, packaging the shared UI and supporting local workers.
- PostgreSQL on servers; SQLite for desktop offline storage.
- Capacitor for a later Android wrapper; Android worker execution needs separate platform support.
- REST for data operations; WebSockets for live events/commands and persistent local worker connections.

## 2. Boundaries

An installation is one server deployment for the GfC organization. It may host multiple locations, each isolated as a logical area (stored as a department in the current database model). Location IDs remain stable when moving between installations. Companies normally have separate deployments; no shared cross-company hosting is required.

Location data, libraries, roles, memberships, module configuration and permissions remain isolated. All requests carry validated active-location context. Users can belong to multiple locations with different rights. Switching location must not mix caches, pending edits, records or permissions. The current local prototype supports location creation and switching for the installation administrator; individual membership and permission checks remain to be implemented.

Modules are installed/enabled installation-wide, not separately per department. Enabled modules have separate department data/settings. Required modules cannot be disabled. Disabling an optional module preserves its data.

## 3. Core and modules

Core stays small: authentication/identity, users and contacts, location context, permissions, module registration, worker supervision, REST/live routing and necessary shared storage primitives. User-facing management and larger workflows belong to modules.

Built-in modules are bundled with the app. Third-party modules may be installed separately, using a documented SDK/protocol and manifest with ID, version, compatibility, dependencies and permissions. Required dependencies block activation when unavailable; optional integrations add features when present. Third-party workers may use other languages if they implement the protocol. A separate process is fault isolation, not a security sandbox: installed extensions are trusted executable code unless additional sandboxing is implemented.

Agreed infrastructure modules:
- System Management (required): management UI, installation settings, updates, module installation/enabling, diagnostics and resource controls.
- Notifications (required): in-app messages, email, templates and notification preferences; email configuration is not required for basic operation.
- Sync: offline changes, library sharing and cross-installation synchronisation.
- Backup: manual/scheduled backups, selectable parts, retention and restore.
- History: selected record/file revisions, trash and retention cleanup.
- Kiosk (optional): pairing, device accounts, screen assignments, display UI and health reports.

Whether Sync, Backup and History must be permanently enabled is not yet decided. Backup must be available for the managed update flow. Modules own their scheduled jobs; a small common scheduling utility avoids duplicating machinery.

## 4. Worker communication and resilience

Workers run as separate processes, normally on the server. Each connects to an internal Core WebSocket endpoint over localhost TCP, using its own authenticated registration. Public client endpoints and internal worker endpoints are distinct. Protocol messages identify module, operation, request and department; Core enforces routing permissions.

Core supervises startup, health, crashes and bounded restarts. Worker calls have timeouts. One failed module must not bring down unrelated modules. Dependent operations report unavailability. Even a required Notifications worker failing temporarily does not stop the whole app.

Configurable per-worker memory limits and CPU controls are desired where supported. Report limit violations and apply restart policy. The implementation must account for Windows/Linux differences and capabilities of the host.

## 5. Data and file ownership

Core owns shared identity/contact/access data. Modules own their records and settings and may directly access their own tables through controlled credentials/adapters. They request shared data/services through Core and other module APIs, never by reading another module's tables. Core routing/authorisation must not be bypassed by public requests.

PostgreSQL runs as a separate service. The installer provisions a local instance by default; an external PostgreSQL connection is supported. Code releases never overwrite live data.

Core supplies common database/file-storage facilities. The shared file service handles uploads, downloads, folders, metadata and permissions. Modules can provide their own file browser or attach files to records; a global file-browser UI is not required. Store binary files outside the source repository. Default storage is a configurable local folder; mounted NAS/network storage is supported. Metadata remains in the database.

Files and libraries belong to departments, not creators. Modules can reference content without duplicating files, subject to access rules. Default maximum file size is 2 GB, configurable per department; provide streaming/resumable transfers, storage quotas and capacity warnings. Do not automatically delete current files to free space.

Settings definitions and defaults live in code. Actual configuration, records, uploads, identity secrets and licensed datasets do not belong in Git.

## 6. Shared UI and desktop offline operation

Module UI lives beside module worker code. Core owns the common shell, navigation, welcome and account UI. There are no duplicate web/Windows interfaces. The desktop wrapper adds local storage, sync and platform integration.

An initial online authentication authorises each local profile. Default: one profile, no local unlock password. One setting, "Enable multiple users", enables isolated profiles with local passwords. This is an unlock mechanism separate from server authentication.

Offline use defaults to unlimited. Installation-wide configuration may limit its duration or disable it. Use last confirmed permissions; managing users, permissions and sharing requires online access. Offline revocation cannot take effect until reconnecting or reaching the configured limit.

Most server-dependent operations show unavailable/errors offline. Selected modules explicitly support local workers. Prefer server workers online; switch to local workers only when server is unavailable or the user selects offline mode. Local workers retain the user's last confirmed permissions and need direct device connectivity.

Keep records, files and pending changes separated by department, installation and local profile. Shared libraries can be downloaded whenever access is granted; no extra offline-download permission exists.

## 7. Live machine commands

Workers are proxies; the machine/controller owns machine state and arbitrates commands from multiple connections. The app does not add exclusive worker ownership where the device already supports this model. If a device cannot be reached, disable its controls or show an error.

Commands are distinct from offline record changes: use IDs, expiry, duplicate/retry handling appropriate to the protocol and received/sent/confirmed/failed-or-unknown results. Never blindly replay old commands on reconnect or worker switching. Read actual device state after switching paths. Where device protocols cannot guarantee deduplication or outcome confirmation, expose the limitation rather than claiming exactly-once execution. Independent safety systems remain responsible for safety functions.

## 8. Sharing and sync

Sharing is mainly department-owned folders/libraries granted to named users from other departments. Folder/library grants cover contents and future additions; there is no automatic grant to all users of the recipient's department. Authorised users only share within their own permitted scope.

Source records have one owning installation/department. Recipients get read-only replicas. A permitted "Create local copy" produces a new independent ID, retains optional source provenance and does not receive future original updates. Original deletion propagates to replicas; independent copies remain.

Use globally unique record IDs, owner IDs, revisions, change cursors, deletion markers and idempotent retry handling. Internal sharing uses the same permission and ownership semantics as remote sharing, but needs no server-trust exchange.

Remote trust is installation-wide and configured by server managers. Example: server 1 hosts A, server 2 hosts B/C; one trust relationship enables communication, while grants can allow A to a user in B without granting C access. Trust is not transitive and never grants user/data/admin access automatically.

Each installation has a dedicated signing identity key pair, separate from TLS and data-encryption keys. Managers add peers by URL, verify public-key fingerprints and approve trust. HTTPS protects transport; use an established signed-request mechanism with replay protection and revocation/rotation. The precise signing standard is still an implementation decision. Proxies may terminate HTTPS; protect any proxy-to-Core network hop appropriately.

Desktop conflicts preserve both versions and let users choose server/local, merge, or keep both. Simple validation/compatibility checks suffice initially. An incompatible module update prompts explicit confirmation to clear that module's local data, lose pending changes and download fresh server state. Cancellation retains data and pauses affected sync. Unchanged compatible modules continue syncing; do not reject solely because the application release number changed.

Revocation blocks future access; managed offline caches are removed on reconnect. Exported files cannot be recalled. Reconnect refreshes current state/subscriptions before syncing pending edits; expired approvals and machine commands are not replayed.

## 9. Identity, access and central administration

Separate contacts, local access accounts and authentication identities:
- A synced person is a contact only until explicitly granted login access.
- Their home installation authenticates them; each destination assigns its own access.
- Local passwords remain at the home installation; later LDAP/external providers are possible.
- Link identities with origin installation/user IDs, never merge automatically by email.

Department roles and installation roles are separate. Department administrators manage their own access; installation administration is not automatic permission to read department records through the app. Underlying host administrators still have technical power over local data.

Cross-installation system administration and cross-department user management are independent extra privileges for selected central staff, not inherited by every server administrator. Destination installations explicitly authorise scope. Initial setup can connect to an existing installation and explicitly grant selected central IT users immediate management access. Keep an independent/local setup path and a local recovery administrator.

Users log in once and switch between authorised departments. Browser switching to another server redirects to its webapp; desktop switches endpoint while keeping the interface. Home-server SSO may avoid another login. Destination permissions still apply.

Users can inspect and revoke device sessions. Department admins revoke department memberships; home admins disable whole accounts. Preserve departmental content and minimal authorship references when users leave; private-profile deletion is separate.

Push login approval: enter username/email on the new client; registered logged-in devices receive client details and a number-matching challenge. Approval creates a new revocable session. Requests expire after 10 minutes and are single-use, cancelled on approval/rejection/cancellation, rate-limited and protected against brute force. Normal password/external-provider login remains a fallback.

Password recovery uses OTP then selection of a new password. Self-service email OTP expires after 15 minutes. Authorised administrator-generated OTP expires after 24 hours, is shown to the admin to pass on and emailed to the user. Limit attempts, avoid logging OTPs and do not invalidate existing credentials merely because an unauthenticated reset was requested. External identity recovery happens at its source.

## 10. Personal data and notifications

Practical protection is prioritised, especially users' private contact details. Names and relationships are still personal data. Limit collection, visibility, retention and exports. Exact privacy/compliance obligations require operator review for each country; this document is not a legal compliance certification.

Modules send notifications to user IDs; Notifications resolves addresses internally. For remote people, request delivery through the home installation. Do not expose addresses merely to send a message. Authorise senders, rate-limit requests and avoid private values/secrets in diagnostics. Viewing contact details requires explicit field-level permission, including remotely.

TLS, password hashing, access checks and encrypted backups are baseline goals. A field-encryption/key-custody design is still to be chosen; do not claim a full server copy is protected if usable keys are copied too. Automatic email implies some trusted runtime can access addresses.

## 11. History, trash, language and kiosks

History is optional per module/data type, lightweight, default 30 days with department configuration up to 30 days. Record actor/time, allow view/restore and create a new revision on restore. Exclude secrets and noisy live status. File history where useful follows the same limit. Trash retains deleted records/files 30 days before active-storage removal; sync propagates deletion; backups have separate retention.

English is fallback; German is initially supported. Translation files allow later languages, missing strings fall back to English. User language/locale and department time zone are configurable; authored content is not automatically translated.

Kiosks are device identities scoped to department/screens. They cannot edit business data but may report health/version/errors, acknowledge updates and heartbeat. On connection loss retry immediately; after 10 seconds show a notification unless explicitly disabled for that kiosk. Clear it on reconnect. Content/staleness behaviour may vary by providing module.

## 12. Operations, updates and recovery

Diagnostics rights have three levels: view health; troubleshoot (detailed logs/resources/sanitised exports); manage (worker restarts and settings). Installation-wide access is a separate scope from departmental diagnostics.

System Management coordinates manually triggered packaged GitHub Release updates: stable/prerelease selection and manual package upload for offline hosts. Download/verify first, enter server-enforced maintenance/read-only mode, drain/pause writers including sync/workers, back up selected required parts, stop workers, install/migrate and health-check before reopening writes. Offline clients may edit locally but cannot upload during maintenance.

A separate updater/recovery process must survive Core replacement. Rollback after database migrations may require restoring matching data, not just old binaries. Release/package signing and third-party UI packaging details remain to be specified.

Backups have three selectable parts:
1. Application: exact Core/module executables and versions.
2. Storage: uploads, datasets and retained file revisions.
3. Database: records, users, settings, permissions, history and sync state.

Each backup includes a manifest with selected parts, IDs, timestamp and app/schema versions. Capture Database+Storage consistently when selected together. Include necessary deployment configuration and identity/secrets in protected backup metadata; external keys require a separate recovery plan. Encrypt archives; store recovery material separately. Support manual/scheduled runs, retention, configurable compression and off-host destinations. Provide a standalone restore command for fresh Debian, checking compatibility of partial restores. This is app recovery, not a full OS image.

Local PostgreSQL is provisioned by default; external PostgreSQL is optional. Nginx is optional: installer-managed configuration or existing reverse proxy with example config. Cover WebSockets, 2 GB uploads and timeouts. Automatic HTTPS where domain/network allow, otherwise administrator-supplied certificates. First-run wizard requires a single-use locally displayed setup code; create identity, first admin and department and configure database/storage. Email can be set up later.

Department export/import preserves its ID, content, settings and memberships. Disable the original before making the new copy writable. Active/passive HA is a future possibility, not a current requirement; no replication/failover implementation is planned now.

## 13. Licensed datasets

Keep licensed datasets out of the source repository. Install/import separately per deployment with ID/version/compatibility metadata. Company-authorised users may download local copies; other companies install their own datasets. Updates preserve installed datasets. Dataset licence scope remains the operator's responsibility.

## 14. Proposed source layout

```text
smart-Church/
  core/
    server/             auth, users, departments, permissions, routing, supervision
    ui/                 common shell, navigation, welcome, account
    client/             common client connection/data interfaces
    database/           Core table definitions and migrations
  modules/
    notifications/
    system-management/
    sync/
    backup/
    history/
    kiosk/
    example/
      manifest.json
      worker/
      ui/
      database/
      settings/
      sync/             when needed
      tests/
  desktop/              Electron wrapper and local runtime integration
  shared/
    contracts/
    module-sdk/
  deploy/               Debian/install/Nginx/development templates
  docs/
  README.md
```

Only create code directories as implemented. Module UI is colocated with its module. Live database/config/files and copyrighted content remain outside this tree. Shared offline plumbing belongs to the Sync module and common client interfaces, not a duplicate UI or a large Core subsystem.

## 15. Delivery order

Milestone 1: Core, departments, login, permissions, worker management, required System Management and Notifications, and one small example module. Build a working browser slice first. Later milestones add Electron/offline, sharing/trust, files/history, deployment/backup/update flows and optional device modules. See [milestones](MILESTONES.md).

Implementation has started with the TypeScript workspace, shared contracts, a localhost Core API and PostgreSQL-backed People and Services & events data scoped to a configured development department. Initial local administrator setup and session-based sign-in are implemented. Installation first-run setup, user-selected department context, membership-scoped permissions and module workers remain to be implemented.
