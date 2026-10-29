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

The component receives `department`, `departmentId`, `csrfToken`, `canManageSite`, a module-local `state` string, and `onStateChange`. Optional registration fields include `adminOnly`, `enabledByDefault`, `initialState`, `isAvailable(context)`, `navigation`, `settings`, and `pageClassName`. The `settings` component receives the selected `departmentId`, `csrfToken`, and available departments and is hosted by the generic Settings page. A module with user-selectable access levels can also declare `accessLabel` and `accessLevels`; People & access displays these declarations without Core changes, and selections are available in `department.modulePermissions[<module-id>]`. Site administrators inherit module access. Use `isAvailable` to hide the module when a member has none of its required grants and `navigation` for module-owned sidebar subsections. The registry adds available modules to the Modules navigation, handles module hash routes and saved state, and renders each module inside a failure boundary. The module implementation is lazy-loaded so an unavailable module does not prevent the core workspace from rendering.

The optional `realtime` client context uses the core-owned authenticated WebSocket connection. Subscribe to module-owned topics such as `module:<id>:changed`; use `realtime:connected` to refresh after reconnect because events are transient and are not queued. Call `send(topic, payload)` only for commands handled by that module's API routes. Modules should not open their own socket or depend on another module's topics. Realtime is an invalidation/notification channel: fetch authoritative state from the module's API after receiving an event.

## Optional API routes

Add `apps/api/src/modules/<id>/manifest.json` with a `serverEntry` and a matching route module:

```json
{
  "id": "example-module",
  "name": "Example module",
  "serverEntry": "./routes.ts"
}
```

`routes.ts` exports `registerModuleRoutes(app, context)`. The shared server context supplies the database pool, database readiness, default location, selected-location resolver, CSRF mutation validator, realtime `publish` and `onMessage` functions, a namespaced worker-diagnostics registration hook, and the Video worker accessor. Publish module events after module-owned state changes, and register client commands with `onMessage`; validate payloads and location/member access in the module handler. Return unsubscribe callbacks and call them in an `onClose` hook. Use `context.workers.register("worker-name", () => diagnostics)` to expose a module-owned worker's status, uptime, memory, and error in server Settings. Keep the worker process, supervisor, and status provider in the module folder and stop it on close. After resolving the selected location, a route can read its grants from `request.activeDepartmentModulePermissions?.["<module-id>"]`; site administrators inherit module access. Validate the grant needed by each operation in the module's own routes. The API discovers manifests and registers each module independently. A malformed or unavailable optional module is logged and skipped; core server startup continues. Routes must still enforce authentication, location membership, module enablement, and the permissions declared by their feature.

The File Storage, Video, Presenter, Sync, and Remote desktop client modules use this registration contract. File Storage, Video, Presenter, Community, ChurchTools Sync, and Remote desktop API routes use the manifest loader. Module-local migrations can be placed in `apps/api/src/modules/<id>/migrations/` with names matching `NNN_description.sql`; the module loader applies them once and tracks them under that module ID. A module can expose a namespaced `configure_<id>_module` function from its own `manager.sh`; the terminal manager discovers these hooks and dispatches the module's CLI settings action.

## Enablement

The client module appears for a location when its `id` is present in `departments.enabled_modules`. During development, enable it for a location with:

```sql
UPDATE departments
SET enabled_modules = array_append(enabled_modules, 'example-module')
WHERE id = '<location-uuid>'
  AND NOT ('example-module' = ANY(enabled_modules));
```

Module code is trusted server code. Only install modules from sources you trust; the registry isolates loading failures, not module privileges.
