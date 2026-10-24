# smart-Church

A modular, department-isolated application with one shared web/desktop interface, optional offline operation, trusted server-to-server sharing and extensible worker processes.

**Status: local development foundation.** The People directory and Services & events schedule read and save department-scoped data through Core API into PostgreSQL. The GfC location and site logo are configurable. Authentication and permission checks are still in progress; keep this API bound to localhost and use fictional data only until those are implemented.

## Start here

- [Architecture and agreed decisions](docs/ARCHITECTURE.md)
- [Milestone 1 and later delivery plan](docs/MILESTONES.md)
- [Implementation issues](https://github.com/juristoeckli/smart-Church/issues)

## Technology baseline

TypeScript • Node.js LTS / Fastify • React • Electron • PostgreSQL • SQLite for local offline data • Capacitor for Android later.

## Local development

Use Node.js 24.22.1, pnpm 11.25.0 and Docker Desktop. Copy `.env.example` to `.env`, then run `docker compose up -d db`. On startup, Core applies the checked-in SQL migration and creates/updates the configured development department. Run `pnpm install` and `pnpm dev`. The UI is available at `http://localhost:5173`; the API health endpoint is at `http://localhost:3001/api/health`. Stop the local database with `docker compose stop db`; its named volume keeps the development data.

The directory starts empty. Contacts are stored in PostgreSQL and scoped to `SMART_CHURCH_DEPARTMENT_ID`. If `DATABASE_URL` is not set, the API starts but shows that database-backed contacts are unavailable. The development API has no login yet and refuses to run in production mode; use fictional data only until authentication and permissions are complete.

## Principles

- Small Core with separately supervised module workers.
- Required Notifications and System Management modules.
- Module code, worker, UI and data definitions kept together.
- Installation-wide modules; department-specific data, settings and permissions.
- Explicit library sharing to named users; server-wide trust for remote sharing.
- Same UI for web and Windows; offline support explicitly defined per module.
- Runtime data, copyrighted datasets and secrets stay outside the repository.

See the architecture document for security boundaries, recovery, deployment and deferred decisions.
