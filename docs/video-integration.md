# Video & streaming module

The Video & streaming module ports the previous Smart-GfC workflow into the current app. Its React UI is in `apps/web/src/modules/video`; a supervised Node process bridges the Core's private localhost WebSocket to the Python device controller. Python listens only on its private JSON-lines pipe and never opens an HTTP port. Core authentication, location membership, site administrator checks, request size limits and session-bound CSRF validation protect its browser API.

## Enable it

The module is inactive until `STREAMING_CONFIG_FILE` points to a private JSON configuration. Copy `config/streaming.example.json` outside the repository, set the path in the API process environment, and restart the Core API. Python 3.10 or later must be available through `py -3` on Windows or `python3` on Linux; set `PYTHON_BINARY` to the executable path when it is elsewhere. Set `STREAMING_STATE_DIR` to a private writable directory for routing history and presets. If omitted, the configuration's directory is used.

Each `sites` entry must use the `department_id` UUID of the app location it serves. The same ID must not appear on two sites. The Video page shows the selected location ID while configuration is missing. Location membership is checked in Core, and the worker maps that trusted ID to the site's equipment; browser input cannot select a different config site. An unmapped location receives no device data or controls.

Keep the private config and state directory out of source control and backups intended for public sharing. Network keys stay in the private file. Public status is filtered by location and allowlists display and telemetry fields. To remove credentials from an XML export, use **Load current settings**; **Include secrets** is an explicit opt-in.

## Behaviour and safeguards

The API supervises one video worker process with a bounded restart policy and correlates requests over a loopback-only WebSocket authenticated by an unshared per-process token. Device requests have a size limit and timeout; timed-out operations are never retried automatically. The Python device controller keeps its device-specific timeouts, route read-back checks, output-lock checks, encoder start/stop cooldowns and explicit confirmation for power cycles and routing preset recalls. Monitoring does not issue control commands.

Automated verification uses mocks and simulated protocol devices only. Do not run a second controller against equipment already managed by the old project. Automated tests do not start streams, route live outputs, delete presets or power-cycle equipment.

From the repository root, run:

```powershell
Push-Location apps/api/src/modules/video/python
$env:STREAMING_CONFIG_FILE = (Resolve-Path tests/video-test-config.json).Path
$env:STREAMING_STATE_DIR = Join-Path (Get-Location).Path "../../../../../../runtime/video-tests"
New-Item -ItemType Directory -Force -Path $env:STREAMING_STATE_DIR | Out-Null
py -3.13 -m unittest discover -s tests -v
Pop-Location
pnpm --filter @smart-church/api typecheck
pnpm --filter @smart-church/web typecheck
```
