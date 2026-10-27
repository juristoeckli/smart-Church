# Install and operate Smart-Church

## One-command installation

The supported self-hosted path is Docker Engine with the Docker Compose plugin on a Linux server. Point a public DNS name at the server and allow inbound TCP ports 80 and 443. Then run:

```sh
curl -fsSL https://github.com/juristoeckli/smart-Church/releases/latest/download/install.sh | sudo bash
```

The installer downloads the latest deployment package, asks for the public domain and church location name, generates database and sync secrets, creates a protected `.env`, pulls the published release images and starts the stack. Caddy obtains and renews the HTTPS certificate automatically. The installer prints the one-time setup code; open the URL it prints and use the code to create the first Server Administrator.

Enter a version such as `1.2.3` when prompted to pin a particular release. Keep the generated `.env` private. The setup page pre-fills the location name entered by the installer. If the location name is exactly `Steffisburg`, the Steffisburg-specific Video module is enabled; other locations do not receive it.

Requirements: a supported Linux host with Docker Engine, the Docker Compose plugin, `curl`, `tar`, and `openssl`. The installer checks these prerequisites but does not install Docker for you. The standalone Caddy profile needs ports 80 and 443 available and the public DNS record working before first startup.

## Existing central reverse proxy

1. Create `.env` with unique database credentials, the public HTTPS origin, a location name and a random sync-encryption key. Set `SMART_CHURCH_TRUST_PROXY` to the source IP/CIDR that Smart-Church sees for the proxy.
2. Keep `SMART_CHURCH_API_BIND_ADDRESS` and `SMART_CHURCH_WEB_BIND_ADDRESS` on loopback when the proxy is on the same host. If it is on another host, bind these ports to a private interface and firewall access to the proxy only.
3. Pull the selected release and start the stack:

   ```sh
   docker compose pull
   docker compose up -d
   ```

4. Configure the proxy to terminate HTTPS and route `/api/` to port 3001 and other paths to port 8080. Forward the original host, client address and HTTPS scheme, and allow WebSocket upgrades on `/api/`. See the [central Nginx example](nginx-central-example.conf).
5. Read the setup code with `docker compose logs api` and complete first-run setup at the public HTTPS address.

Do not expose the API or web upstream ports to the public internet. Production startup requires the browser Origin to match `SMART_CHURCH_WEB_ORIGIN` and the API to trust the configured proxy.

## Optional modules

The base release keeps integrations disabled unless their location has the module enabled. Steffisburg Video has a module-owned Compose overlay and configuration. On that deployment, copy `apps/api/src/modules/video-steffisburg/streaming.example.json` to `apps/api/src/modules/video-steffisburg/streaming.steffisburg.json`, add the real device addresses, and set `SMART_CHURCH_STREAMING_CONFIG_PATH` in `.env`. Start using both Compose files:

```sh
docker compose -f compose.yaml -f apps/api/src/modules/video-steffisburg/compose.yaml --profile bundled-proxy up -d
```

The private config remains beside the module and is ignored by Git. System Laptop and other hardware integrations have separate prerequisites; they are not required for a standard church installation.

## Backups and restore

Create a consistent backup of PostgreSQL and the persistent application-data volume:

```sh
bash deploy/backup.sh
```

Backups are written to `backups/` with restrictive permissions. They include the database and persistent application-data volume. Module-specific config files such as the Steffisburg Video device config and `.env` are stored beside the deployment and must be copied separately into protected, encrypted recovery storage. Encrypt backups before copying them off the server and store the decryption key separately. Restore replaces the live database and all persistent application files; the command requires typing `RESTORE`:

```sh
bash deploy/restore.sh /absolute/path/to/backups/20261027T120000Z
```

Practice restore on a separate server before relying on a backup. Include a copy of `.env` in a separately protected recovery location; it contains secrets required to run the restored service.

## Updates

Update to the latest release:

```sh
bash deploy/update.sh
```

Pin a specific release:

```sh
bash deploy/update.sh 1.2.3
```

The updater first creates a database and file backup, then pulls the image and starts the selected version. Database migrations may make a release incompatible with older code; if an update fails, restore the full pre-update backup and return `.env` to the previous `SMART_CHURCH_VERSION`.

## Operations

- Check services: `docker compose ps`
- Read recent logs: `docker compose logs --tail=200 api web db`
- Stop without deleting data: `docker compose down`
- Never use `docker compose down -v` for routine maintenance; it deletes database, application files and Caddy certificates.

PostgreSQL is private to the Compose network. The deployment runs a single API instance because the worker supervisor, sync timer and login throttling assume one process. Confirm the host firewall, backup recovery, disk capacity and release procedure for each installation.

## Publishing a release

Push a version tag such as `v1.2.3`. The GitHub Actions release workflow builds and publishes the API and web images to GitHub Container Registry and attaches the installer plus deployment package to the GitHub release. After the first publish, make both GHCR container packages public in the repository owner's package settings so installations can pull them without authentication.
