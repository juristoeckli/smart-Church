# Optional module packaging

AMX can be enabled for a location without requiring every installation to download its code. It is the first module split into separate container images. The split applies to container images, not the deployment tarball: the tarball includes the manager and a small Compose overlay, while the AMX implementation is pulled from the container registry only when an administrator installs AMX.

## Default images and AMX images

| Image | Contents |
| --- | --- |
| `smart-church-api` | Core API and module loader. Its image does not contain `apps/api/src/modules/amx`; the loader can load external modules from `/var/lib/smart-church/modules`. |
| `smart-church-web` | Standard web build. The AMX registration and UI chunks are excluded. |
| `smart-church-module-amx` | AMX API module files, copied into the API's shared modules volume by the Compose installer service. |
| `smart-church-web-amx` | Web build with the AMX registration and UI chunks included. |

Normal installations pull only the standard Smart-Church API and web images. The optional `deploy/compose.amx.yaml` overlay selects the AMX web image, adds the AMX module image, and mounts the module volume for the API. The AMX module image is not embedded in the API image, and the AMX web bundle is not embedded in the standard web image.

This packaging split currently applies to AMX only. Other optional modules may be disabled for a location, but their code is still present in the standard API or web images until they receive their own image packaging.

## Install and update through the manager

On a running server, choose **Modules → Install / enable module → AMX** in `./deploy/manage.sh`. The manager:

1. Enables the AMX Compose overlay in the installation configuration.
2. Pulls the AMX API and web images matching the installed Smart-Church version.
3. Starts the module image installer and the AMX-enabled stack.
4. Enables AMX for the primary location.

After installation, set the NetLinx address in Smart-Church under **Settings → Modules → AMX**. Disabling AMX in the manager disables it for the location but keeps the downloaded images and saved settings so it can be enabled again without another download.

The manager's branch update flow checks for the core images and, when AMX is installed, both AMX images before applying an update. The update script then pulls the AMX module image along with the core services. If the branch image workflow has not published all images for the commit yet, wait for it to finish and retry the update.

The installer defaults AMX to off. `SMART_CHURCH_USE_AMX_MODULE` is an internal deployment switch maintained by `manage.sh`; installation and enable/disable operations should use the manager instead of editing `.env` or invoking the overlay manually.

## Build and release images

The root `Dockerfile` defines separate `api`, `web`, `module-amx`, and `web-amx` targets. Release and branch workflows publish the core images for every build and publish the two AMX images under matching release or commit/branch tags. The release deployment package includes `deploy/compose.amx.yaml` so the manager can opt an installation into those images without distributing AMX code to all installations.

When splitting another module from the default images, update its API and web image targets (where it has web code), the Compose overlay, branch and release publishing, manager install/update handling, and this document. Keep a standard build free of that module's server files and web chunks, and ensure the optional image tags match the core version.
