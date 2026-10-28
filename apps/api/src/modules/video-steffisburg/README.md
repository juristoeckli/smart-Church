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
