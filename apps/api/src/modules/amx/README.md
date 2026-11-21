# AMX Control

AMX Control is an optional Smart-Church module and is disabled by default. Installations that use AMX pull a separate AMX module image and AMX-enabled web image; standard Smart-Church images exclude the AMX server code and browser bundle. A server administrator enables the module in **Settings → Modules**; a site administrator configures the master under **Settings → Modules → AMX**. In **Settings → People & access**, a site administrator must grant **AMX room control → Use AMX controls** to each person who should see and operate the module. Site administrators can always operate it. Only site administrators can view or change controller settings. The API enforces the same grant on status and control requests, so hiding the menu is not the only access check.

The room actions use the channel mappings bundled with this integration. Enter the controller address under the AMX module settings for each installation; no site-specific IP address is shipped in the module.

The API uses ICSP (TCP `1319`) for control and current level feedback. For each action it registers a temporary client address, sends the TP4-mapped input-channel PUSH (`0x0084`) and RELEASE (`0x0085`) to the existing touch panel address `10001`, then disconnects. It requests read-only Device Status for level feedback. These ICSP operations do not change controller settings, authentication, or encryption. A live Stativ Mik 1 +/− test changed the mapped level through ICSP; the previous value was restored to within the meter's observed fluctuation.

Set the NetLinx master IP address under AMX settings. The ICSP service uses fixed TCP port `1319`; no Telnet credentials are needed.

For the Steffisburg master, the panel is device `10001` on system `1`; the Home mode buttons use channels `11`–`16`. Channel and audio mappings are fixed module data sourced from the TP4 project.
