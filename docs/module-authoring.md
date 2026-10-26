# Adding a module

Modules are drop-in extensions. A new module does not require edits to `App.tsx` or `server.ts`.

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

The component receives `department`, `departmentId`, `csrfToken`, `canManageSite`, a module-local `state` string, and `onStateChange`. Optional registration fields include `adminOnly`, `enabledByDefault`, `initialState`, `isAvailable(context)`, `navigation`, and `pageClassName`. A module with user-selectable access levels can also declare `accessLabel` and `accessLevels`; People & access displays these declarations without Core changes, and selections are available in `department.modulePermissions[<module-id>]`. Site administrators inherit module access. Use `isAvailable` to hide the module when a member has none of its required grants and `navigation` for module-owned sidebar subsections. The registry adds available modules to the Modules navigation, handles module hash routes and saved state, and renders each module inside a failure boundary. The module implementation is lazy-loaded so an unavailable module does not prevent the core workspace from rendering.

## Optional API routes

Add `apps/api/src/modules/<id>/manifest.json` with a `serverEntry` and a matching route module:

```json
{
  "id": "example-module",
  "name": "Example module",
  "serverEntry": "./routes.ts"
}
```

`routes.ts` exports `registerModuleRoutes(app, context)`. The shared server context supplies the database pool, database readiness, default location, selected-location resolver, CSRF mutation validator, and the Video worker accessor. After resolving the selected location, a route can read its grants from `request.activeDepartmentModulePermissions?.["<module-id>"]`; site administrators inherit module access. Validate the grant needed by each operation in the module's own routes. The API discovers manifests and registers each module independently. A malformed or unavailable optional module is logged and skipped; core server startup continues. Routes must still enforce authentication, location membership, module enablement, and the permissions declared by their feature.

The Video, Presenter, Sync, and System Laptop client modules use this registration contract. Video, Presenter, Community, ChurchTools Sync, and System Laptop API routes use the manifest loader.

## Enablement

The client module appears for a location when its `id` is present in `departments.enabled_modules`. During development, enable it for a location with:

```sql
UPDATE departments
SET enabled_modules = array_append(enabled_modules, 'example-module')
WHERE id = '<location-uuid>'
  AND NOT ('example-module' = ANY(enabled_modules));
```

Module code is trusted server code. Only install modules from sources you trust; the registry isolates loading failures, not module privileges.
