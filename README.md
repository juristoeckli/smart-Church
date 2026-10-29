# smart-Church

A modular application for Churches, with one shared web/desktop interface, optional offline operation, trusted server-to-server sharing and extensible worker processes.

**Status: early self-hosted release candidate.** The repository includes Docker development and deployment paths, location-scoped access controls, and published-image release automation. Production operations still need clean-host validation and backup/restore drills before a church relies on them for irreplaceable records. For local development, keep the API bound to localhost and use fictional data. A deployment may use an existing reverse proxy or the optional bundled Caddy service for automatic HTTPS.

## Start here

- [Architecture and agreed decisions](docs/ARCHITECTURE.md)
- [Milestone 1 and later delivery plan](docs/MILESTONES.md)
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

Copy `.env.example` to `.env`, start the database with `docker compose -f compose.yaml -f compose.dev.yaml up -d db`, then run `pnpm install` and `pnpm dev`. On startup, Core applies the checked-in SQL migrations and ensures the configured initial location exists. On a fresh database, Core prints a one-time setup code in the API terminal; enter it in the browser with an initial location and first Server Administrator details, including a username (3–32 letters, numbers, dots, underscores or hyphens) and a password of at least 12 characters. Users can sign in with their username; an email address is optional, and can also be used to sign in when provided. Add more locations from the location switcher after sign-in. Stop the local database with `docker compose -f compose.yaml -f compose.dev.yaml stop db`; its named volume keeps the development data.

The people directory starts empty. Contacts are stored in PostgreSQL and scoped to the selected location. The development API can start without a database and report that saved data is unavailable. Production mode requires a database, a public HTTPS origin and an explicitly trusted reverse proxy.

## Container deployment

The production Compose package is documented in [deploy/README.md](deploy/README.md). It runs PostgreSQL, the API and the web app from published release images; the API port is bound to loopback by default and PostgreSQL is not published to the host. Use an existing reverse proxy by default, or enable the optional bundled Caddy profile for automatic HTTPS at a standalone church.

The Video & streaming module is a Steffisburg-specific custom module. Its API, worker, UI and example config live under `apps/{api,web}/src/modules/video-steffisburg`; its internal module ID is `video-steffisburg`, while the web UI keeps the existing “Video & streaming” name. It is enabled for the initial location only when `SMART_CHURCH_DEPARTMENT_NAME=Steffisburg`; other locations do not receive it. To enable it, install Python 3.10 or later and set `STREAMING_CONFIG_FILE` to a private copy of [the module example config](apps/api/src/modules/video-steffisburg/streaming.example.json), saved beside it as `streaming.steffisburg.json`. The private filename is ignored by Git. The example maps its sample equipment to this installation's Testlocation01 (`00000000-0000-4000-8000-000000000001`); replace `department_id` if the location has a different UUID, then add the real device addresses. Multiple equipment groups may share a location UUID. Keep API keys and the private config out of Git. See [video integration setup](docs/video-integration.md).

The **EventDesk** module handles customer jobs, equipment bookings, crew requests, and job estimates. It can run without linking jobs to Smart-Church events; event and people links are optional. See [EventDesk features and scope](docs/eventdesk.md).

The optional **System Laptop** module provides an embedded RDP view of the Windows computer running Dante Controller. It is enabled for locations that already have Video enabled, and site administrators can use it. Apache Guacamole 1.6.0 (`guacamole` plus `guacd`) runs as a private gateway; the module UI and session authorization stay inside Smart-Church. See [System Laptop setup](apps/api/src/modules/system-laptop/README.md). Keep the RDP password and Guacamole JSON secret in `.env` or another private configuration source.

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
