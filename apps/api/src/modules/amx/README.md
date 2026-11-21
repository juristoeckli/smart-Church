# AMX Control

AMX Control is an optional Smart-Church module and is disabled by default. Installations that use AMX pull a separate AMX module image and AMX-enabled web image; standard Smart-Church images exclude the AMX server code and browser bundle. A server administrator enables the module in **Settings → Modules**; a site administrator configures the master under **Settings → Modules → AMX**.

The room actions use the channel mappings bundled with this integration. Enter the controller address under the AMX module settings for each installation; no site-specific IP address is shipped in the module.

The API uses the NetLinx Telnet terminal (TCP `23` by default) to send `PULSE <D:P:S>,<channel>` for the physical touch panel's device address. It never opens ICSP, requests a temporary ICSP device address, or changes controller authentication/encryption settings. The module does not require the physical touch panel to be connected as a relay, but uses its programmed device address and channels so NetLinx receives the same button event.

If the controller Telnet terminal asks for a login, enter the existing NetLinx username and password in the module settings. The password is encrypted at rest with the AMX key (`SMART_CHURCH_AMX_ENCRYPTION_KEY`), falling back to the existing Smart-Church sync key or database URL key source. Saving credentials only stores them for this client; it does not enable, disable, or modify NetLinx authentication.

For the Steffisburg master, the panel is device `10001` on system `1`; the Home mode buttons use channels `11`–`16`. Channel and audio mappings are fixed module data sourced from the TP4 project.
