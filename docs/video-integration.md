# Video & streaming (Steffisburg custom module)

The Video & streaming module ports the previous Smart-GfC workflow into the current app. It is the Steffisburg deployment's custom module, with internal ID `video-steffisburg`; its existing web UI name and API routes remain unchanged. Its UI, API, worker and example config are kept in `apps/{web,api}/src/modules/video-steffisburg`. A supervised Node process bridges the Core's private localhost WebSocket to the Python device controller. Python listens only on its private JSON-lines pipe and never opens an HTTP port. Core authentication, location membership, site administrator checks, request size limits and session-bound CSRF validation protect its browser API.

## Enable it

The module is inactive until `STREAMING_CONFIG_FILE` points to a private JSON configuration. Copy `apps/api/src/modules/video-steffisburg/streaming.example.json` to `apps/api/src/modules/video-steffisburg/streaming.steffisburg.json`, set that path in the API process environment, and restart the Core API. For Docker deployments, add the module-owned `apps/api/src/modules/video-steffisburg/compose.yaml` overlay and set `SMART_CHURCH_STREAMING_CONFIG_PATH` in `.env`; the overlay mounts the file read-only. This deployment file is ignored by Git so it can remain with the module safely. Python 3.10 or later must be available through `py -3` on Windows or `python3` on Linux; set `PYTHON_BINARY` to the executable path when it is elsewhere. Set `STREAMING_STATE_DIR` to a private writable directory for routing history and presets. If omitted, the configuration's directory is used.

Each `sites` entry must use the `department_id` UUID of the app location it serves. Several equipment groups can share one location UUID. The Video page shows the selected location ID while configuration is missing. Location membership is checked in Core, and the worker scopes status and operations to that trusted location. When a location has several equipment groups, an operation must identify one of its groups; the worker validates the selection against the trusted location before dispatching a device command. An unmapped location receives an empty status and no controls.

Keep the private config and state directory out of source control and backups intended for public sharing. Network keys stay in the private file. Public status is filtered by location and allowlists display and telemetry fields. To remove credentials from an XML export, use **Load current settings**; **Include secrets** is an explicit opt-in.

## Behaviour and safeguards

The API supervises one video worker process with a bounded restart policy and correlates requests over a loopback-only WebSocket authenticated by an unshared per-process token. Device requests have a size limit and timeout; timed-out operations are never retried automatically. The Python device controller keeps its device-specific timeouts, route read-back checks, output-lock checks, encoder start/stop cooldowns and explicit confirmation for power cycles and routing preset recalls. Monitoring does not issue control commands.

Automated verification uses mocks and simulated protocol devices only. Do not run a second controller against equipment already managed by the old project. Automated tests do not start streams, route live outputs, delete presets or power-cycle equipment.

## ATEM Streaming Bridge monitoring

Add the Bridge to a site's `devices` list with a unique `id`, a display `name`, `type: "streamingbridge"`, its `ip` address, input `port` 1935, and status `status_port` 9977. The Video & Streaming page polls the status port using a read-only `STREAM STATE` request and shows the Bridge's reported stream status, video mode, and bitrates. It also reports ping reachability and whether the receiver's TCP input port is listening. The status protocol was confirmed against both configured Bridges and returns the `STREAM STATE` fields used by ATEM Setup. [Blackmagic's ATEM Mini manual](https://documents.blackmagicdesign.com/UserManuals/ATEM_Mini_Manual.pdf?_v=1724742010000) documents TCP port 1935 for the ATEM Streaming Bridge. These checks read status only; they do not change Bridge settings or stream state. The monitor implements the network request in Smart-Church with Python's standard socket library; ATEM Setup, its plugin, a Blackmagic SDK, and USB drivers are not runtime dependencies.

From the repository root, run:

```powershell
Push-Location apps/api/src/modules/video-steffisburg/python
$env:STREAMING_CONFIG_FILE = (Resolve-Path tests/video-test-config.json).Path
$env:STREAMING_STATE_DIR = Join-Path (Get-Location).Path "../../../../../../runtime/video-tests"
New-Item -ItemType Directory -Force -Path $env:STREAMING_STATE_DIR | Out-Null
py -3.13 -m unittest discover -s tests -v
Pop-Location
pnpm --filter @smart-church/api typecheck
pnpm --filter @smart-church/web typecheck
```
