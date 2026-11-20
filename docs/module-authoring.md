# Adding a module

Modules are independently developed packages. A module ID and manifest describe its API process and optional browser bundle; Core loads installed manifests at runtime instead of requiring a Core registry entry. Keep module-specific behavior, settings, migrations, styles, workers, and documentation inside the module package. Features that do not apply to a module are not part of its contract.

## Client module

Create `apps/web/src/modules/<id>/module.tsx` and export a `moduleRegistration`:

```tsx
import { lazy } from "react";
import { Puzzle } from "lucide-react";
import type { ModuleRegistration } from "../../module-registry";

export const moduleRegistration: ModuleRegistration = {
  id: "example-module",
  name: "Example module",
  icon: Puzzle,
  adminOnly: true,
  component: lazy(() => import("./ExampleModule").then(({ ExampleModule }) => ({ default: ExampleModule }))),
};
```

The component receives `department`, `departmentId`, `csrfToken`, the active user `language`, `canManageSite`, a module-local `state` string, and `onStateChange`. Optional registration fields include `adminOnly`, `enabledByDefault`, `initialState`, `isAvailable(context)`, `navigation`, `settings`, and `pageClassName`. The `settings` component receives the selected `departmentId`, `csrfToken`, and available departments and is hosted by the generic Settings page. A module with user-selectable access levels can also declare `accessLabel` and `accessLevels`; People & access displays these declarations without Core changes, and selections are available in `department.modulePermissions[<module-id>]`. Site administrators inherit module access. Use `isAvailable` to hide the module when a member has none of its required grants and `navigation` for module-owned sidebar subsections. The registry adds available modules to the Modules navigation, handles module hash routes and saved state, and renders each module inside a failure boundary. The module implementation is lazy-loaded so an unavailable module does not prevent the core workspace from rendering.

Modules can declare localized UI copy with `translations`. English is the fallback for a missing language or key, then the registration's `name` is used for a missing English name. The module host applies exact phrase matches from this map to static text and common accessibility attributes (`aria-label`, `aria-description`, `title`, `placeholder`, and `alt`) in the module page, navigation, and settings. The active user language is also available as `language` in the module component context, so module-owned screens can use the same translation map for dynamic messages:

```tsx
export const moduleRegistration: ModuleRegistration = {
  id: "example-module",
  name: "Example module",
  translations: {
    en: { name: "Example module", greeting: "Welcome" },
    de: { name: "Beispielmodul", greeting: "Willkommen" },
    fr: { name: "Module exemple", greeting: "Bienvenue" },
    it: { name: "Modulo di esempio", greeting: "Benvenuto" },
  },
  // ...icon and component
};
```

Use `moduleTranslation(moduleRegistration.translations, language, "greeting")` in module-owned UI; it returns the selected translation or its English fallback. The registry uses the `name` translation for module navigation, page headings, and module management.

The optional `realtime` client context uses the core-owned authenticated WebSocket connection. Subscribe to module-owned topics such as `module:<id>:changed`; use `realtime:connected` to refresh after reconnect because events are transient and are not queued. Call `send(topic, payload)` only for commands handled by that module's API routes. Modules should not open their own socket or depend on another module's topics. Realtime is an invalidation/notification channel: fetch authoritative state from the module's API after receiving an event.

Core-bundled modules are used for first-party development only. Installed modules load their browser registration from `/optional-modules/<id>/module.js`; Core does not need a new import, ID list, or UI registry change when a module is added.

## External package format

Develop external modules in a separate repository and publish a `.tar.gz` package with this layout:

```text
manifest.json
worker.js
web/
  module.js
  module.css
  assets/...
```

`manifest.json` must declare `id`, `name`, `version`, and `workerEntry` (for example, `"workerEntry": "./worker.js"`). It may declare `accessGrants` and dependencies. `web/module.js` is required so the module can participate in the shared module registry; `module.css` and `assets/` are optional. Do not use `serverEntry` in an external package: it imports code into the Core API process and defeats crash isolation. The `worker.js` process binds to the loopback `HOST` and `PORT` supplied by Core and serves `GET /healthz`. Core proxies `/api/modules/<id>/*` to it after authentication, location access, declared grant, module activation, and CSRF checks. The worker must require the `x-smart-church-module-token` header and use Core's `x-smart-church-module-department`, `x-smart-church-module-actor`, and `x-smart-church-module-grants` values as trusted request context. `SMART_CHURCH_MODULE_DATA_DIR` is a persistent writable directory dedicated to this module ID; scope records inside it by the supplied department ID. Core does not currently give external workers a database, replication, or realtime publishing capability. Do not expose the worker port or pass browser cookies to it. See [Third-party worker protocol](THIRD_PARTY_WORKER_PROTOCOL.md) for the request limits and lifecycle.

The manager installs package files into the shared module volume: the manifest and worker files go in the module directory, while `web/` contents are served at `/optional-modules/<id>/`. Installation does not itself grant module access; a Server Administrator enables it installation-wide in Settings → Modules. Uninstall removes executable package files and leaves module-owned database data intact.

## Optional API routes

For a first-party bundled module, add `apps/api/src/modules/<id>/manifest.json` with a semantic version, required/default enablement flags, dependency lists, and a `serverEntry`:

```json
{
  "id": "example-module",
  "name": "Example module",
  "version": "1.0.0",
  "required": false,
  "enabledByDefault": false,
  "dependencies": {
    "required": [],
    "optional": []
  },
  "serverEntry": "./routes.ts"
}
```

Module IDs must match their folder names. Required dependencies must be bundled and successfully registered before the dependent module; a missing required dependency prevents that module from activating. Optional dependencies never block activation and are logged as unavailable when absent. Dependency cycles are rejected. Use `runtimeDependencies` for external services or programs such as Guacamole; those are separate from Smart-Church module dependencies. Required modules stay enabled and are seeded for new locations.

For these bundled modules, `routes.ts` exports `registerModuleRoutes(app, context)` and can use the Core server context. This legacy in-process contract is for built-in first-party modules only. External modules use `workerEntry`; Core validates the request and grants before proxying it to the isolated process.

The File Storage, Video, Presenter, Sync, and Remote desktop client modules use this registration contract. File Storage, Video, Presenter, Community, ChurchTools Sync, and Remote desktop API routes use the manifest loader. Module-local migrations can be placed in `apps/api/src/modules/<id>/migrations/` with names matching `NNN_description.sql`; the module loader applies them once and tracks them under that module ID. A module can expose a namespaced `configure_<id>_module` function from its own `manager.sh`; the terminal manager discovers these hooks and dispatches the module's CLI settings action.

## Enablement

Client module activation is installation-wide. A Server Administrator controls it in Settings → Modules; the API stores it in `installation_modules` and mirrors enabled client module IDs into each location profile for compatibility. Module data, permissions, and settings remain location-scoped. During development, enable an installed client module with:

```sql
UPDATE installation_modules
   SET enabled = TRUE, updated_at = now()
 WHERE installation_id = (SELECT id FROM installations WHERE is_current = TRUE)
   AND module_id = 'example-module'
   AND client_managed = TRUE
   AND required = FALSE;
```

Module code is trusted server code. Only install modules from sources you trust; the registry isolates loading failures, not module privileges.
