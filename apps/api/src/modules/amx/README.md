# AMX Control

AMX Control is an optional Smart-Church module and is disabled by default. It shows six room controls and connects directly to the NetLinx master over ICSP TCP; it does not use the touch panel as a relay. Installations that use AMX pull a separate AMX module image and AMX-enabled web image; standard Smart-Church images exclude the AMX server code and browser bundle. A server administrator enables the module in **Settings → Modules**; a site administrator configures the master under **Settings → Modules → AMX**.

The room actions use the channel mappings bundled with this integration. Enter the controller address under the AMX module settings for each installation; no site-specific IP address is shipped in the module.

The API opens an ICSP session on TCP `1319`, ignores pre-registration device-info broadcasts, requests and acknowledges a temporary ICSP device address, then sends input-channel ON and OFF status messages for the configured `D:P:S,channel` mapping. The temporary address is released when the connection closes. The module does not use Telnet, does not configure controller authentication, and does not require the physical touch panel to be connected.

AMX's ICSP channel messages are proprietary and use framed binary packets with a checksum. The implementation confirms the temporary device registration before sending a room event, then sends both the channel push and release. Configure ICSP access on the controller as required by your installation; this module never changes controller authentication or encryption settings.
