# Adding a module

Modules are self-contained drop-in extensions. Each module keeps the behavior and supporting pieces it needs—such as UI, API routes, settings, migrations, CLI hooks, Compose services, styles, and documentation—in its own folder. Features that do not apply to a module are not part of its contract. The app and deployment manager provide generic extension points; module-specific behavior does not belong in `App.tsx`, `server.ts`, or `deploy/manage.sh`.

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

## Optional API routes

Add `apps/api/src/modules/<id>/manifest.json` with a semantic version, required/default enablement flags, dependency lists, and a `serverEntry`:

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

`routes.ts` exports `registerModuleRoutes(app, context)`. The shared server context supplies the database pool, database readiness, default location, selected-location resolver, CSRF mutation validator, realtime `publish` and `onMessage` functions, a module activation status/change subscription, a namespaced worker-diagnostics registration hook, and the Video worker accessor. Publish module events after module-owned state changes, and register client commands with `onMessage`; validate payloads and location/member access in the module handler. Return unsubscribe callbacks and call them in an `onClose` hook. Use `context.workers.register("worker-name", () => diagnostics)` to expose a module-owned worker's status, uptime, memory, and error in server Settings. Keep the worker process, supervisor, and status provider in the module folder and stop it on close. After resolving the selected location, a route can read its grants from `request.activeDepartmentModulePermissions?.["<module-id>"]`; site administrators inherit module access. Validate the grant needed by each operation in the module's own routes. The API validates manifests before registering modules and orders registration by required dependencies. A malformed or unavailable optional module is logged and skipped; core server startup continues. Client-managed module API routes and realtime handlers are gated by the installation activation state. Subscribe to `context.activation.onChange` to stop background processes when an optional module is disabled, and check `context.activation.isEnabled()` before starting them. Required module IDs are also enforced by the module management API. Routes must still enforce authentication, location membership, module enablement, and the permissions declared by their feature.

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
