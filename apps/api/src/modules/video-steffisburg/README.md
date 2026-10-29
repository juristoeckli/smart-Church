# Video & streaming — Steffisburg

This deployment-specific module includes `streaming.steffisburg.json` with the
Steffisburg video and streaming configuration and the linked sites used by its
streaming routes. The addresses in this file are private network addresses.

Enable the module by including this directory's `compose.yaml` as an overlay
when starting the Smart-Church stack. Set the variables shown in `.env.example`
in the deployment's protected `.env` file. The included configuration path is
the default; override `SMART_CHURCH_STREAMING_CONFIG_PATH` only if you store a
custom copy elsewhere.

The UniFi API key must stay in
`SMART_CHURCH_VIDEO_STEFFISBURG_UNIFI_API_KEY` in `.env`; do not put it in the
JSON configuration. DS-700 host, port, and client MAC values can be overridden
with the module-prefixed variables in `.env.example`.

The generic `streaming.example.json` remains available as a template for other
sites. This module's settings are specific to the Steffisburg deployment.

Server administrators can edit router, encoder, and device IP addresses for a
location under Settings → Modules → Video & streaming. The first time the
settings are opened, the module captures the existing private configuration
addresses as that location's defaults. Saved address overrides are kept in the
module's database table and applied to worker requests; selecting **Reset to
defaults** restores the captured values.

The Video overview shows the three Steffisburg encoders, warns when a remote
encoder is live, and provides power-cycle controls for the Seewinkel and
Sonnenhof Shelly Pro 1 relays. Planned streams are stored by this module and
use the current or next service's title, speaker, theme, and time.

YouTube scheduling is optional. To enable it, create an OAuth 2.0 web client in
Google Cloud, enable the YouTube Data API v3, and register the exact callback
URL `https://<Smart-Church-origin>/api/auth/modules/video-steffisburg/youtube/callback`.
Enter the OAuth Client ID and Client Secret in Settings → Modules → Video & streaming.
The module encrypts the client secret before storing it. Set the exact redirect
URL and a long random token encryption key from this module's `.env.example` in
the protected deployment `.env`, then recreate the API container. The module
encrypts the channel refresh token before storing it. A user with stream administrator access can then connect the channel from
Video → Overview. Creating a planned
stream schedules a YouTube broadcast with the selected visibility; **Control
in Studio** opens that broadcast directly. The module does not change an
encoder's stream key or start the broadcast.
