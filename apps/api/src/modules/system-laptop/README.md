# System Laptop

System Laptop embeds Apache Guacamole's JavaScript remote desktop client inside the Smart-Church module. It opens one configured Windows RDP host, intended for the PC running Dante Controller. The browser connects only to the Guacamole WebSocket; RDP credentials remain on the API server and the AV/control network stays at the remote PC.

## Local development

1. The deployment uses the public Apache Guacamole 1.6.0 `guacd` image by default. In the terminal Manager's System Laptop settings, choose the patched Wave2 audio option when the remote RDP server requires RDPSND Wave2 support from [Apache PR #696](https://github.com/apache/guacamole-server/pull/696). The manager builds the image locally; the server needs `git`, Docker, and outbound access to GitHub and the Docker build dependencies. To build it manually instead:

   ```powershell
   .\apps\api\src\modules\system-laptop\build-guacd.ps1
   ```

   The build script tags it `smart-church/guacd:1.6.0-wave2`. To select it manually, set `SYSTEM_LAPTOP_GUACD_IMAGE=smart-church/guacd:1.6.0-wave2` in `.env`. Otherwise leave the setting unset to use `guacamole/guacd:1.6.0`.

   Generate a 128-bit secret and use the same 32-character hexadecimal value for `SYSTEM_LAPTOP_JSON_SECRET_KEY` in `.env`:

   ```powershell
   node -e "console.log(require('node:crypto').randomBytes(16).toString('hex'))"
   ```

2. Set the private RDP and gateway values in `.env`:

   ```dotenv
   SYSTEM_LAPTOP_JSON_SECRET_KEY=<32-hex-character-secret>
   SYSTEM_LAPTOP_RDP_HOST=<private-rdp-host>
   SYSTEM_LAPTOP_RDP_PORT=3389
   SYSTEM_LAPTOP_RDP_USERNAME=smart-church-control
   SYSTEM_LAPTOP_RDP_PASSWORD=<private-password>
   SYSTEM_LAPTOP_GUACAMOLE_API_URL=http://127.0.0.1:8080/guacamole
   ```

3. Start the module gateway alongside PostgreSQL:

   ```powershell
   docker compose -f compose.yaml -f apps/api/src/modules/system-laptop/compose.yaml --profile system-laptop up -d db system-laptop-guacd system-laptop-guacamole
   ```

4. Run `pnpm install` if the workspace dependencies have changed, then start Smart-Church. System Laptop is enabled for locations where Video is already enabled. Members can open the module to watch; a site administrator starts the controlling session.

The RDP host must allow incoming Remote Desktop connections and be reachable from `guacd`. Dante Controller must be installed on that PC and configured to use its Dante-connected Ethernet interface. The browser loads Guacamole's JavaScript and opens its WebSocket through the authenticated same-origin System Laptop API routes. Only the API server needs network access to the private Guacamole URL. Do not expose Guacamole's port, port 3389, or the JSON secret to browsers. The Guacamole WebSocket URL carries a short-lived bearer token and proxy ticket as required by its client protocol; configure the web server not to log query strings for this route.

## Shared control and display size

One site administrator can control the desktop at a time. The API grants a short pending lease while the controller connects, then holds the lease until that WebSocket closes. Other members of the same location join the active Guacamole connection in read-only mode; they cannot send keyboard or mouse input. A viewer cannot create the session, and a viewer from another location cannot join it.

Any member who can access this module and is watching the session can choose **Take control** to transfer the lease. The previous controller's tunnel is disconnected, and the new controller joins the existing shared Guacamole connection. Other viewers remain read-only. Starting a new session still requires a site administrator.

The controlling browser reports the available display area to Guacamole on connect and whenever that area changes, including when entering or leaving fullscreen. The RDP connection uses the `display-update` resize method, so the Windows host must support RDP 8.1 display updates for dynamic resolution changes. Viewers join at the current controller dimensions and do not control the resolution.

RDP audio output is enabled and plays through the connected browser. The local `guacd` image includes the Wave2 PDU support from Apache PR #696. This addresses modern RDP servers that use Wave2. It does not address the separate intermittent audio-instruction issue tracked as [GUACAMOLE-2095](https://issues.apache.org/jira/browse/GUACAMOLE-2095). Microphone input is not redirected.

## Access boundary

Only members of a location with `system-laptop` enabled can request a view session; only site administrators can start the controlling session. Guacamole JSON authentication tokens expire after one minute. RDP credentials, the JSON signing key, and the API endpoint are supplied through environment variables and must remain private. The gateway is a trusted module dependency, not a security sandbox.
