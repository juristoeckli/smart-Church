# Optional module packaging

Optional module code is shipped separately from the default application images. The split applies to container images, not the deployment tarball: the tarball includes the manager and small Compose overlays, while each module implementation is pulled from the container registry only when an administrator installs it.

## Default and optional images

| Image | Contents |
| --- | --- |
| `smart-church-api` | Core API and module loader. Its image does not contain the AMX or Remote desktop module files; the loader can load external modules from `/var/lib/smart-church/modules`. |
| `smart-church-web` | Standard web build. AMX and Remote desktop registrations and UI chunks are excluded. |
| `smart-church-module-amx` | AMX API files and its separate browser bundle, copied into the shared module volume by the Compose installer service. |
| `smart-church-module-remote-desktop` | Remote desktop API files and its separate browser bundle, copied into the shared module volume by the Compose installer service. |

Normal installations pull only the standard Smart-Church API and web images. The `deploy/compose.amx.yaml` and `deploy/compose.remote-desktop.yaml` overlays add independent module image installers. Each installer copies that module's API files and browser bundle into the shared module volume. The core web app loads each optional browser bundle by module ID at runtime, and the API loads the module server entry from the same volume. Optional module code is not embedded in the standard API or web images; installing both modules keeps their bundles separate.

This packaging split applies to AMX and Remote desktop. Other optional modules may be disabled installation-wide, but their code can still be present in the standard images until separately packaged.

## Install and update through the manager

On a running server, choose **Modules → Install / enable module** and select AMX or Remote desktop in `./deploy/manage.sh`. The manager:

1. Enables the selected module's Compose overlay so its installer can populate the shared module volume.
2. Pulls that module's API and browser bundle image for the installed Smart-Church version.
3. Starts the module image installer and API; Remote desktop also starts Guacamole services while enabled.
4. Enables the module installation-wide. Its settings and data remain scoped to each location.

After installation, configure AMX under **Settings → Modules → AMX** or Remote desktop under **Settings → Modules → Remote desktop**. Disabling a module disables it installation-wide but keeps its downloaded image and saved settings so it can be enabled again without another download. Remote desktop's Guacamole services stop when that module is disabled.

The manager's branch update flow checks for the core images and the images for installed optional modules before applying an update. The update script pulls matching module images along with the core services. If the branch image workflow has not published all images for the commit yet, wait for it to finish and retry the update.

The installer defaults optional modules to off. Module installation markers are internal deployment settings maintained by `manage.sh`; installation and enable/disable operations should use the manager instead of editing `.env` or invoking overlays manually.

## Build and release images

The root `Dockerfile` defines separate core API and web targets, a shared React runtime for independently loaded module bundles, and one installer image target per optional module. Each installer image includes that module's API files and its standalone Vite browser entry and assets. Release and branch workflows publish these images under matching release or commit/branch tags. The release deployment package includes the Compose overlays and manager helpers, not module implementation files.

When splitting another module from the default images, add a standalone browser bundle when it has client code, copy it with the module API files from its own installer image, update the Compose overlay, branch and release publishing, manager install/update handling, and this document. Keep standard images free of that module's server files and client chunks, and ensure its optional image tag matches the core version.
