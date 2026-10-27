# Smart-Church server-side schema

This diagram shows the current production request path and server-side services. The bundled Caddy proxy is optional; it obtains HTTPS certificates automatically. An existing reverse proxy can use the same private web and API upstreams.

```mermaid
flowchart LR
  client[Browser or client]

  subgraph edge[HTTPS entry]
    proxy[Existing reverse proxy<br/>or optional bundled Caddy]
  end

  subgraph app[Smart-Church Compose network]
    web[Web service<br/>Static React app]

    subgraph api[API service · Fastify]
      core[Core<br/>Login · sessions · location access<br/>CSRF · module loader]
      modules[Module route plugins<br/>Community · File Storage · Presenter<br/>Notifications · ChurchTools Sync · System Laptop]
      supervisor[Core Video worker supervisor<br/>Internal authenticated WebSocket]

      subgraph video[Video module · module-owned code]
        videoRoutes[Video API routes]
        nodeworker[Video Node worker process]
        python[Python device controller process]
      end
    end

    db[(PostgreSQL<br/>Accounts · location data<br/>module records · file metadata/content)]
    volume[(Persistent app-data volume<br/>Presenter media and datasets<br/>Video state)]
    guac[Guacamole web gateway]
    guacd[guacd tunnel service]
  end

  churchtools[ChurchTools API]
  equipment[Video equipment LAN<br/>ATEM · Videohub · encoders · DS-700]
  rdp[Configured RDP computer]

  client -->|HTTPS| proxy
  proxy -->|/| web
  proxy -->|/api/* and WebSocket| core
  web -->|REST and live connections| core
  core --> modules
  modules -. Video manifest .-> videoRoutes
  videoRoutes -->|worker accessor| supervisor
  supervisor -->|launches and supervises| nodeworker
  nodeworker <-->|loopback WebSocket| supervisor
  nodeworker -->|private JSON-lines pipe| python
  core -->|SQL · migrations| db
  modules -->|location-scoped queries| db
  videoRoutes --> db
  modules -->|datasets · media · state| volume
  modules <-->|sync requests| churchtools
  python <-->|device protocols| equipment
  modules -->|short-lived session setup| guac
  guac --> guacd -->|RDP| rdp
```

## Server responsibilities

- **Core API** validates the user session, selected location, permissions, CSRF token and request size. It loads API modules from each module's `manifest.json` and gives them shared database and location-access services.
- **Modules** own their route handlers and domain behavior. File Storage owns `/api/files` and its access grants; Presenter owns dataset and presentation media routes. Video owns its API routes and worker code; Core owns the supervisor and authenticated internal WebSocket used to launch and communicate with that worker.
- **PostgreSQL** is a separate service with a persistent database volume. The API applies checked-in SQL migrations during startup. File Storage's current records and file bytes remain in `stored_files` in PostgreSQL.
- **Persistent app data** is mounted at `/var/lib/smart-church` in the API container. Compose configures Presenter datasets/media and Video state there. The private Video equipment configuration is mounted read-only into the API container.
- **Network exposure** is through the selected reverse proxy. Compose binds the web and API upstream ports to loopback by default; PostgreSQL, Guacamole and `guacd` do not publish host ports in the base stack.

For the browser/client module boundary and ownership rules, see [Architecture](ARCHITECTURE.md). For deployment steps and proxy configuration, see [Container deployment](../deploy/README.md).
