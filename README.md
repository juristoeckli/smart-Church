# smart-Church

A modular application for Churches, with one shared web/desktop interface, optional offline operation, trusted server-to-server sharing and extensible worker processes.

**Status: early self-hosted release candidate.** The repository includes Docker development and deployment paths, location-scoped access controls, and published-image release automation. Production operations still need clean-host validation and backup/restore drills before a church relies on them for irreplaceable records. For local development, keep the API bound to localhost and use fictional data. A deployment may use an existing reverse proxy or the optional bundled Caddy service for automatic HTTPS.

## Start here

- [Architecture and agreed decisions](docs/ARCHITECTURE.md)
- [Milestone 1 and later delivery plan](docs/MILESTONES.md)
- [Interface language coverage and translation guide](docs/LANGUAGES.md)
- [Personal date and time formats](docs/DATE_TIME_FORMATS.md)
- [Implementation issues](https://github.com/juristoeckli/smart-Church/issues)

## Technology baseline

TypeScript • Node.js LTS / Fastify • React • Electron • PostgreSQL • SQLite for local offline data • Capacitor for Android later.

## Local development with Docker

Use Node.js 24.22.1, pnpm 11.25.0 and Docker Desktop. Copy `.env.example` to `.env`, then start the full development stack:

```sh
docker compose -f compose.yaml -f compose.dev.yaml up --build
```

This runs PostgreSQL, the API and the Vite web app in containers. Open `http://localhost:5173`; the API health endpoint is `http://localhost:3001/api/health`. The API terminal prints the one-time setup code for a fresh database. Source files are mounted for hot reload. Stop the stack with `docker compose -f compose.yaml -f compose.dev.yaml down`; named volumes keep the database and application data. Rebuild with `--build` after changing package dependencies.

## Local development on the host

Copy `.env.example` to `.env`, start the database with `docker compose -f compose.yaml -f compose.dev.yaml up -d db`, then run `pnpm install` and `pnpm dev`. On startup, Core applies the checked-in SQL migrations and ensures the configured initial location exists. PostgreSQL creates a persistent installation UUID and associates each location with it; existing locations are linked during migration. On a fresh database, Core prints a one-time setup code in the API terminal; enter it in the browser with an initial location and first Server Administrator details, including a username (3–32 letters, numbers, dots, underscores or hyphens) and a password of at least 12 characters. Users can sign in with their username; an email address is optional, and can also be used to sign in when provided. Add more locations from the location switcher after sign-in. Stop the local database with `docker compose -f compose.yaml -f compose.dev.yaml stop db`; its named volume keeps the development data.

The people directory starts empty. Contacts are stored in PostgreSQL and scoped to the selected location. Personal settings include a server-saved date/time format, defaulting to DD.MM.YYYY HH:MM, and tools to inspect and revoke active sign-in sessions. Site and server administrators can view system CPU utilization, host and container memory, persistent application-volume capacity/free space, and managed-worker health in Settings. Groups support local membership management, per-person roles and active/paused/waitlist status, dated meetings with attendance tracking, and optional public sign-up links with leader approval; groups imported from ChurchTools remain read-only. Services and events can be browsed in list or month views, scheduled as weekly, biweekly or monthly series for up to one year ahead, and assigned volunteers can record their response to service positions. Event managers can record adult and children headcounts or check in individual people. First-time visitors can be flagged and followed up through a queue with an assignee, due date, note, and completion status. Events can also accept public registrations through shareable links, enforce a capacity, place additional guests on a waitlist, and check registrants in from the event roster. The Community module provides a location-scoped news feed where signed-in members can publish posts, comment, and react. In-app notifications alert linked assignees to new follow-ups and remind them around the due date. Site administrators can send in-app announcements to the whole location or active members of selected groups. The development API can start without a database and report that saved data is unavailable. Production mode requires a database, a public HTTPS origin and an explicitly trusted reverse proxy.

## Container deployment

The production Compose package is documented in [deploy/README.md](deploy/README.md). It runs PostgreSQL, the API and the web app from published release images; the API port is bound to loopback by default and PostgreSQL is not published to the host. Use an existing reverse proxy by default, or enable the optional bundled Caddy profile for automatic HTTPS at a standalone church.

The Video & streaming module is a Steffisburg-specific custom module. Its API, worker, UI and example config live under `apps/{api,web}/src/modules/video-steffisburg`; its internal module ID is `video-steffisburg`, while the web UI keeps the existing “Video & streaming” name. It is enabled for the initial location only when `SMART_CHURCH_DEPARTMENT_NAME=Steffisburg`; other locations do not receive it. To enable it, install Python 3.10 or later and set `STREAMING_CONFIG_FILE` to a private copy of [the module example config](apps/api/src/modules/video-steffisburg/streaming.example.json), saved beside it as `streaming.steffisburg.json`. The private filename is ignored by Git. The example maps its sample equipment to this installation's Testlocation01 (`00000000-0000-4000-8000-000000000001`); replace `department_id` if the location has a different UUID, then add the real device addresses. Multiple equipment groups may share a location UUID. Keep API keys and the private config out of Git. See [video integration setup](docs/video-integration.md).

The optional **Remote desktop** module provides browser access to configured RDP, VNC, and SPICE destinations. It can be enabled per location. Apache Guacamole 1.6.0 (`guacamole` plus `guacd`) runs as a private gateway; the module owns its UI, settings, encrypted destination credentials, API routes, migrations, and terminal-manager integration. See [Remote desktop setup](apps/api/src/modules/remote-desktop/README.md). Keep its Guacamole signing key in `.env`; destination passwords are stored encrypted by the module.

The **Sync** module generates an Ed25519 identity and stores its private key in the protected application data volume at `/var/lib/smart-church/sync/identity-ed25519.pem`; `SMART_CHURCH_SYNC_IDENTITY_KEY_FILE` can override this path. Server Administrators pair peers with one-time invitations and independently verify fingerprints. Site Administrators can share people names/status or service/event schedule details. Either the receiving server can pull, or the source can push outbound to a reachable peer, which supports a source behind NAT without port forwarding. Both directions use the existing HTTPS/API endpoint and open no extra ports. A separate full-site redundancy path automatically pushes complete snapshots of core data and enabled module state to configured read-only standbys, by default every 60 seconds, with manual promotion after external fencing. It remains not ready for production until the two-server recovery and fencing procedures have been verified. Back up the application data volume and database together. See [the server-to-server protocol plan](docs/SERVER_TO_SERVER_SYNC.md).

The **EventDesk** module handles customer jobs, equipment bookings, crew requests, and job estimates. It can run without linking jobs to Smart-Church events; event and people links are optional. See [EventDesk features and scope](docs/eventdesk.md).

### Email delivery

Server Administrators configure email under **Settings → Server**. Choose direct delivery, which connects to recipient domains' mail servers on port 25, or SMTP through a relay using host, port, TLS mode, and optional credentials. SMTP passwords are stored encrypted; set `SMART_CHURCH_EMAIL_ENCRYPTION_KEY` to a persistent random secret so key rotation of the database connection string does not affect them. Direct delivery requires outbound port 25 and correct SPF/DKIM DNS records for reliable delivery. Email delivery is disabled until an administrator enables and configures it. Modules can send to an email address with `context.email.send({ recipientEmail, subject, text, html? })` or target an account with `recipientUserId`. Users still opt in to inbox email notifications in Notifications; those messages are queued and retried automatically.

Self sign-up is available under **Settings → Server** and is off by default. Applicants receive a link that stays valid for seven days; incomplete applications are deleted after seven days. After applicants submit their details, a confirmation email is sent within 24 hours. Verified applications appear in the review queue, where a server manager can edit the profile, choose a site and rights, approve or deny, and send login details. Applications still awaiting an administrator decision after 30 days are emailed in the applicant’s selected language, then deleted. Approved accounts must change their temporary password at first sign-in.

Presenter datasets are stored separately from the application and site database in `apps/api/data/presenter-datasets` by default; set `PRESENTER_DATASETS_DIR` to use another private storage location. To install the three built-in Singt datasets from a previous Smart-Church Presenter installation, run `node apps/api/scripts/import-singt-datasets.mjs --source "<path-to-old-project>/content/singt"` from the repository root. A Presenter administrator can export or import each dataset independently as `.scdataset.tar.gz`. Keep these packages in private backups; they are intentionally excluded from Git. Song content remains subject to its original license and usage terms.

## Principles

- Small Core with separately supervised module workers.
- Required Notifications and System Management modules.
- Module code, worker, UI and data definitions kept together.
- Installation-wide modules and branding; location-specific data, settings and permissions.
- Explicit library sharing to named users; server-wide trust for remote sharing.
- Same UI for web and Windows; offline support explicitly defined per module.
- Runtime data, copyrighted datasets and secrets stay outside the repository.

See the architecture document for security boundaries, recovery, deployment and deferred decisions.
