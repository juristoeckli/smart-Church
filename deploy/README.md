# Install and operate Smart-Church

## One-command installation

The supported self-hosted path is Docker Engine with the Docker Compose plugin on a Linux server. For a public certificate, point a public DNS name at the server and allow inbound TCP ports 80 and 443. If you do not have a public domain, leave that installer prompt blank and provide a hostname or IPv4 address that client devices can reach; the installer will use Caddy's self-signed HTTPS mode. Then run:

```sh
curl -fsSL https://github.com/juristoeckli/smart-Church/releases/latest/download/install.sh | sudo bash
```

The interactive terminal manager can also start the installation:

```sh
curl -fsSL https://github.com/juristoeckli/smart-Church/releases/latest/download/manage.sh | sudo bash
```

The installer downloads the latest deployment package, asks for the domain, church location name, connection mode, and release version, generates database and sync secrets, creates a protected `.env`, pulls the published release images and starts the stack. HTTPS mode serves TLS through Caddy on port 443. Caddy serves the app without redirects over HTTP on port 80, and the Smart-Church API service is also exposed directly on port 81. Port 81 bypasses Caddy; both HTTP paths are unencrypted and should be used only temporarily or on a trusted network. Leave the public domain blank to use Caddy HTTPS with its self-signed local certificate authority; the installer then asks for a client-reachable hostname or IPv4 address. Install Caddy's exported public root certificate as trusted on each client device to remove browser warnings. With a public domain, choose `https` to use Caddy with either `public` (automatically renewed Let's Encrypt certificate) or `self-signed`. Choose `direct-http` to run only the direct service on port 81, without Caddy or another proxy. The installer prints the HTTPS URL, both HTTP URLs, and one-time setup code; open either URL and use the code to create the first Server Administrator.

The bundled proxy uses a fixed private-network IP. Docker assigns other containers addresses from a separate IP range so they cannot take the proxy address.

To completely remove an installation, including its database, uploaded files, HTTPS certificates, backups, secrets, and configuration, run:

```sh
curl -fsSL https://github.com/juristoeckli/smart-Church/releases/latest/download/uninstall.sh | sudo bash
```

The uninstaller asks you to type `DELETE /opt/smart-church` before it removes anything. It removes all containers belonging to that Smart-Church Compose project; other containers on the server and Docker images stay untouched. To uninstall from a custom directory, pass `SMART_CHURCH_INSTALL_DIR` through `sudo`, for example: `curl -fsSL https://github.com/juristoeckli/smart-Church/releases/latest/download/uninstall.sh | sudo env SMART_CHURCH_INSTALL_DIR=/srv/smart-church bash`.

After installation, open a graphical terminal manager with `sudo ./deploy/manage.sh`. It uses `whiptail` or `dialog` when installed and otherwise provides a numbered terminal menu. Use it to check health, configure listening ports and host interface, select `main`, `beta`, or `dev`, and update to that branch's latest commit. The manager resolves the full commit SHA, checks that both images are published, and backs up before updating to that exact SHA. The selected branch is saved so **Force update** can pull its newest commit later, without publishing a release. If the branch build is still running, retry after it finishes. Branch builds may contain unfinished changes. The separate release update option continues to accept a release version such as `1.2.3` or `latest`. The manager also starts and stops services, follows logs, creates or restores backups, and uninstalls Smart-Church.
The bundled proxy uses a fixed private-network IP. Docker assigns other containers addresses from a separate IP range so they cannot take the proxy address.

To completely remove an installation, including its database, uploaded files, HTTPS certificates, backups, secrets, and configuration, run:

```sh
curl -fsSL https://github.com/juristoeckli/smart-Church/releases/latest/download/uninstall.sh | sudo bash
```

The uninstaller asks you to type `DELETE /opt/smart-church` before it removes anything. It removes all containers belonging to that Smart-Church Compose project; other containers on the server and Docker images stay untouched. To uninstall from a custom directory, pass `SMART_CHURCH_INSTALL_DIR` through `sudo`, for example: `curl -fsSL https://github.com/juristoeckli/smart-Church/releases/latest/download/uninstall.sh | sudo env SMART_CHURCH_INSTALL_DIR=/srv/smart-church bash`.

Enter a version such as `1.2.3` when prompted to pin a particular release. Keep the generated `.env` private. The setup page pre-fills the location name entered by the installer. If the location name is exactly `Steffisburg`, the Steffisburg-specific Video module is enabled; other locations do not receive it.

Requirements: a supported Linux host with Docker Engine, the Docker Compose plugin, `curl`, `tar`, and `openssl`. The installer checks these prerequisites but does not install Docker for you. HTTPS needs ports 80 and 443 available. Public certificates also require DNS to point to the host; self-signed certificates need their local CA trusted on clients. The direct HTTP service uses inbound TCP port 81.

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

Use **Modules** in `./deploy/manage.sh` to enable or disable packaged modules for the primary location and change their basic settings. Current optional modules are Video & streaming (Steffisburg only), Remote desktop, and Presenter. Remote desktop owns its terminal settings hook, gateway overlay, destination manager, and settings storage in its module directory. It can build and select the patched Wave2 audio proxy locally; this requires `git` and Docker on the server. Presenter content is managed in the web app. Chat, File storage, Notifications, and Sync are enabled by default.

Steffisburg Video has a module-owned Compose overlay and site configuration included in the deployment package. The included `streaming.steffisburg.json` contains the Steffisburg and linked site network/device settings. Configure the UniFi API key and optional DS-700 overrides through the manager or using `apps/api/src/modules/video-steffisburg/.env.example`. The UniFi API key is kept in `.env`, not in the module JSON. For manual Compose startup, set `SMART_CHURCH_STREAMING_CONFIG_PATH` to that file and include both Compose files:

```sh
docker compose -f compose.yaml -f deploy/compose.direct.yaml -f apps/api/src/modules/video-steffisburg/compose.yaml --profile bundled-proxy up -d
```

For a direct HTTP installation, include the direct-access overlay and start the database and API services without the Caddy profile:

```sh
docker compose -f compose.yaml -f deploy/compose.direct.yaml -f apps/api/src/modules/video-steffisburg/compose.yaml up -d db api
```

Remote desktop and other hardware integrations have separate prerequisites; they are not required for a standard church installation.

## Backups and restore

Create a consistent backup of PostgreSQL and the persistent application-data volume:

```sh
./deploy/backup.sh
```

Backups are written to `backups/` with restrictive permissions. They include the database and persistent application-data volume. The `.env` is stored beside the deployment and must be copied separately into protected, encrypted recovery storage. Encrypt backups before copying them off the server and store the decryption key separately. Restore replaces the live database and all persistent application files; the command requires typing `RESTORE`:

```sh
./deploy/restore.sh /absolute/path/to/backups/20261027T120000Z
```

Practice restore on a separate server before relying on a backup. Include a copy of `.env` in a separately protected recovery location; it contains secrets required to run the restored service.

## Updates

Update to the latest release:

```sh
./deploy/update.sh
```

Pin a specific release:

```sh
./deploy/update.sh 1.2.3
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
