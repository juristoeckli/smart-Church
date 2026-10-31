# Remote desktop

Remote desktop embeds Apache Guacamole's JavaScript client inside the Smart-Church module. Destinations can use RDP, VNC, or SPICE. The browser connects to the Guacamole WebSocket; destination credentials remain encrypted in the module's database records and are only decrypted by its API routes when opening a session.

## Local development

1. The deployment uses the public Apache Guacamole 1.6.0 `guacd` image by default. In the terminal Manager's Remote desktop settings, choose the patched Wave2 audio option when an RDP destination requires RDPSND Wave2 support from [Apache PR #696](https://github.com/apache/guacamole-server/pull/696). The manager builds the image locally; the server needs `git`, Docker, and outbound access to GitHub and the Docker build dependencies. To build it manually instead:

   ```powershell
   .\apps\api\src\modules\remote-desktop\build-guacd.ps1
   ```

   The build script tags it `smart-church/guacd:1.6.0-wave2`. To select it manually, set `SYSTEM_LAPTOP_GUACD_IMAGE=smart-church/guacd:1.6.0-wave2` in `.env`. Otherwise leave the setting unset to use `guacamole/guacd:1.6.0`.

   Generate a 128-bit secret for this server's `SYSTEM_LAPTOP_JSON_SECRET_KEY` in `.env`. Keep it stable so this server can decrypt its saved destination passwords. A standby can use its own key; site replication re-encrypts destination passwords for that server after the signed peer key exchange:

   ```powershell
   node -e "console.log(require('node:crypto').randomBytes(16).toString('hex'))"
   ```

2. Set the module's signing key and private gateway URL in `.env`. Destination hosts and credentials are managed in Settings → Modules → Remote desktop or through the terminal Manager; they are encrypted in the module-owned database table.

   ```dotenv
   SYSTEM_LAPTOP_JSON_SECRET_KEY=<32-hex-character-secret>
   SYSTEM_LAPTOP_GUACAMOLE_API_URL=http://127.0.0.1:8080/guacamole
   ```

3. Start the module gateway alongside PostgreSQL:

   ```powershell
   docker compose -f compose.yaml -f apps/api/src/modules/remote-desktop/compose.yaml --profile system-laptop up -d db system-laptop-guacd system-laptop-guacamole
   ```

4. Run `pnpm install` if the workspace dependencies have changed, then start Smart-Church. Enable Remote desktop for a location using Settings → Modules or the terminal Manager. Members can open the module to watch; a site administrator starts the controlling session.

Each selected destination must be reachable from `guacd` on its configured protocol and port. The browser loads Guacamole's JavaScript and opens its WebSocket through the authenticated same-origin Remote desktop API routes. Only the API server needs network access to the private Guacamole URL. Do not expose Guacamole's port, destination credentials, or the JSON secret to browsers. The Guacamole WebSocket URL carries a short-lived bearer token and proxy ticket as required by its client protocol; configure the web server not to log query strings for this route.

## Shared control and display size

One site administrator can control the desktop at a time. The API grants a short pending lease while the controller connects, then holds the lease until that WebSocket closes. Other members of the same location join the active Guacamole connection in read-only mode; they cannot send keyboard or mouse input. A viewer cannot create the session, and a viewer from another location cannot join it.

Any member who can access this module and is watching the session can choose **Take control** to transfer the lease. The previous controller's tunnel is disconnected, and the new controller joins the existing shared Guacamole connection. Other viewers remain read-only. Starting a new session still requires a site administrator.

The controlling browser reports the available display area to Guacamole on connect and whenever that area changes, including when entering or leaving fullscreen. The RDP connection uses the `display-update` resize method, so the Windows host must support RDP 8.1 display updates for dynamic resolution changes. Viewers join at the current controller dimensions and do not control the resolution.

RDP audio output is enabled and plays through the connected browser. The local `guacd` image includes the Wave2 PDU support from Apache PR #696. This addresses modern RDP servers that use Wave2. It does not address the separate intermittent audio-instruction issue tracked as [GUACAMOLE-2095](https://issues.apache.org/jira/browse/GUACAMOLE-2095). Microphone input is not redirected.

## Access boundary

Only members of a location with `remote-desktop` enabled can request a view session; only site administrators can start the controlling session. Guacamole JSON authentication tokens expire after one minute. RDP credentials, the JSON signing key, and the API endpoint are supplied through environment variables and must remain private. The gateway is a trusted module dependency, not a security sandbox.
