# smart-Church

A modular application for Churches, with one shared web/desktop interface, optional offline operation, trusted server-to-server sharing and extensible worker processes.

**Status: local development foundation.** One installation can manage multiple Churches/locations. People, services, events and time zones are scoped to the selected location; the site logo is installation-wide. The first account is a Server Administrator who can manage locations; per-location memberships and permissions are still in progress. For local development, keep the API bound to localhost and use fictional data until access controls are complete. A deployed installation may use an existing, separately managed reverse proxy, or enable the optional bundled Nginx service.

## Start here

- [Architecture and agreed decisions](docs/ARCHITECTURE.md)
- [Milestone 1 and later delivery plan](docs/MILESTONES.md)
- [Implementation issues](https://github.com/juristoeckli/smart-Church/issues)

## Technology baseline

TypeScript • Node.js LTS / Fastify • React • Electron • PostgreSQL • SQLite for local offline data • Capacitor for Android later.

## Local development

Use Node.js 24.22.1, pnpm 11.25.0 and Docker Desktop. Copy `.env.example` to `.env`, then run `docker compose -f compose.yaml -f compose.dev.yaml up -d db` to start the development database. Run `pnpm install` and `pnpm dev`. The UI is available at `http://localhost:5173`; the API health endpoint is at `http://localhost:3001/api/health`. On startup, Core applies the checked-in SQL migrations and ensures the configured initial location exists. On a fresh database, Core prints a one-time setup code in the API terminal; enter it in the browser with an initial location and first Server Administrator details, including a username (3–32 letters, numbers, dots, underscores or hyphens) and a password of at least 12 characters. Users can sign in with their username; an email address is optional, and can also be used to sign in when provided. Add more locations from the location switcher after sign-in. Stop the local database with `docker compose -f compose.yaml -f compose.dev.yaml stop db`; its named volume keeps the development data.

The people directory starts empty. Contacts are stored in PostgreSQL and scoped to the selected location. The development API can start without a database and report that saved data is unavailable. Production mode requires a database, a public HTTPS origin and an explicitly trusted reverse proxy.

## Container deployment

The production Compose package is documented in [deploy/README.md](deploy/README.md). It runs PostgreSQL, the API and the web app; the API port is bound to loopback by default and PostgreSQL is not published to the host. Use an existing reverse proxy by default, or enable the optional bundled Nginx profile for a standalone church.

The Video & streaming module runs in a supervised Core worker and is optional. To enable it, install Python 3.10 or later and set `STREAMING_CONFIG_FILE` to a private copy of [config/streaming.example.json](config/streaming.example.json). The example maps its sample equipment to this installation's Testlocation01 (`00000000-0000-4000-8000-000000000001`); replace `department_id` if the location has a different UUID, then add the real device addresses. Multiple equipment groups may share a location UUID. Keep API keys and the private config out of Git. Without the variable the module stays inactive, and the rest of the app runs normally. See [video integration setup](docs/video-integration.md).

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
