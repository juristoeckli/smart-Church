# AMX Control

AMX Control is an optional Smart-Church module and is disabled by default. Installations that use AMX pull a separate AMX module image and AMX-enabled web image; standard Smart-Church images exclude the AMX server code and browser bundle. A server administrator enables the module in **Settings → Modules**; a site administrator configures the master under **Settings → Modules → AMX**. In **Settings → People & access**, a site administrator must grant **AMX room control → Use AMX controls** to each person who should see and operate the module. Site administrators can always operate it. Only site administrators can view or change controller settings. The API enforces the same grant on status and control requests, so hiding the menu is not the only access check.

The room actions use the channel mappings bundled with this integration. Enter the controller address under the AMX module settings for each installation; no site-specific IP address is shipped in the module.

The API uses the NetLinx Telnet terminal (TCP `23` by default) to send `PULSE <D:P:S>,<channel>` for the programmed touch panel device address. It also reads current levels with `DEVICE STATUS <D:P:S>` and displays the level values mapped in the TP4 project. These status requests are read-only. The API does not open ICSP, request a temporary ICSP device address, or change controller authentication/encryption settings. The module uses the programmed device address and channels so NetLinx receives the same button events.

If the controller Telnet terminal asks for a login, enter the existing NetLinx username and password in the module settings. The password is encrypted at rest with the AMX key (`SMART_CHURCH_AMX_ENCRYPTION_KEY`), falling back to the existing Smart-Church sync key or database URL key source. Saving credentials only stores them for this client; it does not enable, disable, or modify NetLinx authentication.

For the Steffisburg master, the panel is device `10001` on system `1`; the Home mode buttons use channels `11`–`16`. Channel and audio mappings are fixed module data sourced from the TP4 project.
