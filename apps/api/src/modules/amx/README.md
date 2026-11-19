# AMX Control

AMX Control is an optional Smart-Church module, disabled by default. It reproduces the existing Modero room-selection screen and sends the six saved room actions to the NetLinx master. A server administrator enables the module in **Settings → Modules**; a site administrator configures it under **Settings → Modules → AMX Control**.

The inspected Modero panel is device `10001` at `10.2.14.11`; its master is device `0` at `10.2.14.10` on the panel-to-master connection port `1319`. The controller WebConsole reports an NI Master running firmware `v3.60.453` with `EBV_Steffisburg,Rev1.93.axs` loaded. The WebConsole exposed the active program name but did not provide its source or room command mappings. The module uses the master’s Telnet command port `23`. Enter one controller command for each room button. AMX documents the terminal command form as `SEND_COMMAND D:P:S,COMMAND`; the actual device IDs and command strings must match the installed NetLinx program. Unconfigured room buttons remain disabled.

The API only sends saved room actions, rejects command line breaks, waits for the Telnet prompt, and closes the connection after the response. This module does not implement Telnet authentication or TLS; restrict the master’s command port to a trusted network and allow access only from the Smart-Church API server.
