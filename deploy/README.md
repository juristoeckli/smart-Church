# Container deployment

The Compose stack contains PostgreSQL, the Smart-Church API and a static web server. PostgreSQL has no host port. The API and web upstream ports bind to loopback by default, so a reverse proxy on the same host can reach them without exposing them to the network.

## Existing central reverse proxy

1. Copy `.env.production.example` to `.env` on the application host and replace the example database credentials, public origin and location name.
2. Set `SMART_CHURCH_TRUST_PROXY` to the source IP/CIDR that the API sees for the central proxy. Keep `SMART_CHURCH_API_BIND_ADDRESS` and `SMART_CHURCH_WEB_BIND_ADDRESS` on loopback when Nginx is on the same host. If the proxy is on another host, bind these ports to a private interface and allow only the proxy through the host firewall.
3. Start Smart-Church with `docker compose up -d --build`. Do not enable the bundled proxy profile.
4. Configure the central Nginx to terminate HTTPS and route `/api/` to port 3001 and all other paths to port 8080. Forward the original host, client address and `X-Forwarded-Proto: https`; allow WebSocket upgrades on `/api/`. The [central Nginx example](nginx-central-example.conf) shows the location blocks.
5. Use `docker compose logs api` once to read the one-time first-account setup code, then complete setup at the public HTTPS address. Treat the code as a secret and remove or restrict retained logs after setup.

The API requires the browser Origin to exactly match `SMART_CHURCH_WEB_ORIGIN` and requires the trusted proxy to report HTTPS. Do not expose the API or web upstream ports to the public internet. On a remote proxy deployment, firewall those private host ports to the proxy source address.

## Standalone church with bundled Nginx

1. Copy `.env.production.example` to `.env` and set the public HTTPS origin and unique database credentials.
2. Set `SMART_CHURCH_DOMAIN` to the hostname in the certificate. Put the TLS certificate chain and private key in `deploy/certs/fullchain.pem` and `deploy/certs/privkey.pem`. Keep the key private and out of Git.
3. Check that `SMART_CHURCH_DOCKER_SUBNET` does not overlap an existing network. If it does, change it and set `SMART_CHURCH_NGINX_IP` and `SMART_CHURCH_TRUST_PROXY` to an address in that subnet.
4. Start the full stack with `docker compose --profile bundled-proxy up -d --build`.
5. Read the one-time first-account setup code from `docker compose logs api` and finish setup over HTTPS.

The bundled Nginx redirects HTTP to HTTPS, serves as the public entry point, forwards API/WebSocket traffic, allows uploads up to 1 GiB and uses long proxy timeouts for live connections. It uses administrator-supplied certificates; automatic certificate issuance is not included yet.

## Optional System Laptop gateway

System Laptop uses a private Guacamole gateway. Build its patched `guacd` image using the module's build instructions, set the JSON key and private RDP connection values in `.env`, then include its Compose file and profile:

```sh
docker compose -f compose.yaml -f apps/api/src/modules/system-laptop/compose.yaml --profile system-laptop up -d --build
```

Add `--profile bundled-proxy` to that command when using the bundled Nginx. Guacamole and `guacd` remain private on the Compose network and publish no host ports.

## Optional Video configuration

Copy `config/streaming.example.json` to a private file on the host and configure its real device addresses. Set `SMART_CHURCH_STREAMING_CONFIG_PATH` to that file and `SMART_CHURCH_STREAMING_CONFIG_FILE=/run/secrets/streaming.json` in `.env`. Compose mounts the file read-only and keeps worker state in the persistent application-data volume. The example configuration is mounted but not activated by default.

## Operations

- Check status with `docker compose ps`; the API health check includes database readiness.
- View service logs with `docker compose logs --tail=200 api web db`.
- Stop without deleting data with `docker compose down`.
- Do not use `docker compose down -v` for routine maintenance; that deletes the database and uploaded Presenter files.
- Keep encrypted backups of the PostgreSQL database and the `smart-church-data` volume. A tested backup/restore workflow and managed upgrades are still required before relying on a production installation.
- The deployment is single-instance. Do not run multiple API replicas: the Video worker supervisor, ChurchTools sync timer and in-memory login throttling currently assume one process.

## Current deployment limits

Production startup now fails closed when the database, public HTTPS origin or trusted-proxy settings are absent. This package is the first production deployment path, not a certification of every optional module or NAS/Docker host. Validate module-specific integrations, backup recovery, host firewalling, certificate renewal and resource limits for the target installation before storing real church data.
