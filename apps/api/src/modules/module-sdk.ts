import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Pool, PoolClient } from "pg";
import type { LocationPermission } from "@smart-church/contracts";
import type { ManagedWorkerDiagnostics } from "../runtime-diagnostics.js";

export type ModuleReplicationAdapter = {
  moduleId: string;
  moduleName: string;
  schemaVersion: string;
  getSchemaVersion?: (departmentId: string) => Promise<string>;
  isEnabled: () => boolean;
  inspect: (departmentId: string) => Promise<{ ready: boolean; blockers: string[]; recordCount: number }>;
  exportSnapshot: (client: PoolClient, departmentId: string) => Promise<unknown>;
  prepareSnapshotForPeer?: (snapshot: unknown, sealForPeer: (plaintext: string) => string) => Promise<unknown>;
  restoreSnapshotFromPeer?: (snapshot: unknown, openForLocal: (envelope: string) => string) => Promise<unknown>;
  restoreSnapshot: (client: PoolClient, departmentId: string, snapshot: unknown, context: ReplicationRestoreContext) => Promise<{ recordCount: number }>;
  verifySnapshot: (client: PoolClient, departmentId: string, snapshot?: unknown, context?: ReplicationRestoreContext) => Promise<{ ready: boolean; blockers: string[] }>;
};

export type ReplicationRestoreContext = {
  userIdMap: Map<string, string>;
  onCommit: (callback: () => Promise<void>) => void;
  onRollback: (callback: () => Promise<void>) => void;
};

export interface ModuleServerContext {
  activation: {
    isEnabled: () => boolean;
    onChange: (listener: (enabled: boolean) => void) => () => void;
  };
  realtime: {
    publish: (topic: string, departmentId: string, payload?: unknown) => void;
    onMessage: (topic: string, handler: (context: { userId: string; departmentId: string }, payload: unknown) => void | Promise<void>) => () => void;
  };
  workers: {
    register: (name: string, getDiagnostics: () => ManagedWorkerDiagnostics, restart?: () => void | Promise<void>) => () => void;
  };
  pool: Pool | null;
  isDatabaseReady: () => boolean;
  isDepartmentWritable: (departmentId: string) => Promise<boolean>;
  lockDepartmentForWrite: (client: PoolClient, departmentId: string) => Promise<boolean>;
  getDefaultDepartmentId: () => string;
  resolveDepartmentId: (request: FastifyRequest, reply: FastifyReply, requireSiteAdmin?: boolean, allowQueryLocation?: boolean, requiredPermission?: LocationPermission) => Promise<string | null>;
  validateMutation: (request: FastifyRequest, reply: FastifyReply) => boolean;
  getVideoWorker: () => {
    state: { state: string; error: string | null };
    request: (operation: string, data: Record<string, unknown>, departmentId: string, actor: string, timeout: number) => Promise<unknown>;
  } | null;
  email: EmailConnector;
  replication: {
    register: (adapter: Omit<ModuleReplicationAdapter, "moduleId" | "moduleName" | "isEnabled">) => () => void;
    list: () => ModuleReplicationAdapter[];
  };
}

type EmailContent = {
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
};

export type EmailMessage = EmailContent & (
  | { recipientUserId: string; recipientEmail?: never }
  | { recipientEmail: string; recipientUserId?: never }
);

export interface EmailConnector {
  isConfigured: (departmentId?: string) => Promise<boolean>;
  send: (message: EmailMessage, departmentId?: string) => Promise<{ messageId: string }>;
}

export interface ModuleLoaderContext extends Omit<ModuleServerContext, "workers" | "activation" | "replication"> {
  workers: {
    register: (id: string, name: string, getDiagnostics: () => ManagedWorkerDiagnostics, restart?: () => void | Promise<void>) => () => void;
  };
}

export interface ServerModuleManifest {
  id: string;
  version: string;
  name?: string;
  required?: boolean;
  enabledByDefault?: boolean;
  clientManaged?: boolean;
  dependencies?: {
    required?: string[];
    optional?: string[];
  };
  runtimeDependencies?: string[];
  serverEntry?: string;
}

type DiscoveredModule = { id: string; root: string; manifest: ServerModuleManifest; entry: string };
const requiredServerModuleIds = new Set<string>();
const requiredModuleDependencies = new Map<string, string[]>();
const moduleActivation = new Map<string, boolean>();
const activationListeners = new Map<string, Set<(enabled: boolean) => void>>();
const replicationAdapters = new Map<string, ModuleReplicationAdapter>();

export function getModuleReplicationAdapters() {
  return [...replicationAdapters.values()];
}

export function registerPlatformReplicationAdapter(adapter: Omit<ModuleReplicationAdapter, "moduleName" | "isEnabled">) {
  if (replicationAdapters.has(adapter.moduleId)) throw new Error(`Replication adapter ${adapter.moduleId} is already registered.`);
  const registeredAdapter: ModuleReplicationAdapter = { ...adapter, moduleName: "Core site data", isEnabled: () => true };
  replicationAdapters.set(adapter.moduleId, registeredAdapter);
  return () => { if (replicationAdapters.get(adapter.moduleId) === registeredAdapter) replicationAdapters.delete(adapter.moduleId); };
}

export async function installSiteWriteFenceTriggers(pool: Pool) {
  const result = await pool.query<{ installed: boolean }>("SELECT to_regprocedure('public.enforce_site_write_fence()') IS NOT NULL AS installed");
  if (!result.rows[0]?.installed) return;
  await pool.query(`DO $fence$
  DECLARE table_record RECORD;
  BEGIN
    FOR table_record IN
      SELECT DISTINCT site_column.table_name
        FROM information_schema.columns site_column
       WHERE site_column.table_schema='public' AND site_column.table_name NOT LIKE 'sync_%' AND site_column.column_name='department_id'
         AND EXISTS (SELECT 1 FROM information_schema.tables table_info
                      WHERE table_info.table_schema=site_column.table_schema
                        AND table_info.table_name=site_column.table_name
                        AND table_info.table_type='BASE TABLE')
       ORDER BY site_column.table_name
    LOOP
      EXECUTE format('DROP TRIGGER IF EXISTS smart_church_site_write_fence ON public.%I', table_record.table_name);
      EXECUTE format('CREATE TRIGGER smart_church_site_write_fence BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.enforce_site_write_fence()', table_record.table_name);
    END LOOP;
  END
  $fence$`);
  const relatedFence = await pool.query<{ installed: boolean }>("SELECT to_regprocedure('public.enforce_related_site_write_fence()') IS NOT NULL AS installed");
  if (!relatedFence.rows[0]?.installed) return;
  await pool.query(`DO $related_fence$
  DECLARE
    relation_record RECORD;
    trigger_name TEXT;
  BEGIN
    FOR relation_record IN
      SELECT constraint_row.conname AS constraint_name,
             child.relname AS child_table,
             child_column.attname AS child_column,
             parent.relname AS parent_table,
             parent_column.attname AS parent_column
        FROM pg_constraint constraint_row
        JOIN pg_class child ON child.oid=constraint_row.conrelid
        JOIN pg_namespace child_ns ON child_ns.oid=child.relnamespace
        JOIN pg_class parent ON parent.oid=constraint_row.confrelid
        JOIN pg_namespace parent_ns ON parent_ns.oid=parent.relnamespace
        JOIN pg_attribute child_column ON child_column.attrelid=child.oid AND child_column.attnum=constraint_row.conkey[1]
        JOIN pg_attribute parent_column ON parent_column.attrelid=parent.oid AND parent_column.attnum=constraint_row.confkey[1]
       WHERE constraint_row.contype='f'
         AND cardinality(constraint_row.conkey)=1
         AND cardinality(constraint_row.confkey)=1
         AND child_ns.nspname='public'
         AND parent_ns.nspname='public'
         AND child_column.atttypid='uuid'::regtype
         AND parent_column.atttypid='uuid'::regtype
         AND child.relname NOT LIKE 'sync_%'
         AND EXISTS (SELECT 1 FROM pg_attribute column_row WHERE column_row.attrelid=parent.oid AND column_row.attname='department_id' AND NOT column_row.attisdropped)
    LOOP
      trigger_name := left('smart_church_related_write_fence_' || md5(relation_record.constraint_name), 63);
      EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', trigger_name, relation_record.child_table);
      EXECUTE format('CREATE TRIGGER %I BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.enforce_related_site_write_fence(%L,%L,%L)',
        trigger_name, relation_record.child_table, relation_record.child_column, relation_record.parent_table, relation_record.parent_column);
    END LOOP;
  END
  $related_fence$`);
}

export function getRequiredServerModuleIds() {
  return [...requiredServerModuleIds];
}

export function getRequiredModuleDependencies() {
  return Object.fromEntries([...requiredModuleDependencies].map(([id, dependencies]) => [id, [...dependencies]]));
}

export function isServerModuleEnabled(id: string) {
  return moduleActivation.get(id) ?? requiredServerModuleIds.has(id);
}

export function setServerModuleEnabled(id: string, enabled: boolean) {
  const next = enabled || requiredServerModuleIds.has(id);
  const previous = isServerModuleEnabled(id);
  moduleActivation.set(id, next);
  if (previous !== next) for (const listener of activationListeners.get(id) ?? []) listener(next);
}

export function onServerModuleActivationChange(id: string, listener: (enabled: boolean) => void) {
  const listeners = activationListeners.get(id) ?? new Set<(enabled: boolean) => void>();
  listeners.add(listener);
  activationListeners.set(id, listeners);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) activationListeners.delete(id);
  };
}

function validateManifest(value: unknown, directoryName: string): ServerModuleManifest {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("The module manifest must be an object.");
  const manifest = value as Partial<ServerModuleManifest>;
  if (manifest.id !== directoryName || typeof manifest.id !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(manifest.id)) {
    throw new Error("The module ID must match its folder name and use lowercase letters, numbers, and hyphens.");
  }
  if (typeof manifest.version !== "string" || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(manifest.version)) {
    throw new Error("The module manifest must declare a semantic version.");
  }
  if (manifest.name !== undefined && (typeof manifest.name !== "string" || !manifest.name.trim())) throw new Error("The module name must be a non-empty string.");
  if (manifest.required !== undefined && typeof manifest.required !== "boolean") throw new Error("The required flag must be a boolean.");
  if (manifest.enabledByDefault !== undefined && typeof manifest.enabledByDefault !== "boolean") throw new Error("The enabledByDefault flag must be a boolean.");
  if (manifest.clientManaged !== undefined && typeof manifest.clientManaged !== "boolean") throw new Error("The clientManaged flag must be a boolean.");
  const dependencies = manifest.dependencies ?? {};
  if (!dependencies || typeof dependencies !== "object" || Array.isArray(dependencies)) throw new Error("Dependencies must contain required and optional module ID lists.");
  for (const [kind, list] of Object.entries({ required: dependencies.required ?? [], optional: dependencies.optional ?? [] })) {
    if (!Array.isArray(list) || list.some((id) => typeof id !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(id))) throw new Error(`The ${kind} dependencies must be valid module IDs.`);
    if (new Set(list).size !== list.length || list.includes(manifest.id)) throw new Error(`The ${kind} dependencies must be unique and cannot include the module itself.`);
  }
  if ((dependencies.required ?? []).some((id) => (dependencies.optional ?? []).includes(id))) throw new Error("A module dependency cannot be both required and optional.");
  if (manifest.runtimeDependencies !== undefined && (!Array.isArray(manifest.runtimeDependencies) || manifest.runtimeDependencies.some((item) => typeof item !== "string" || !item.trim()))) {
    throw new Error("Runtime dependencies must be non-empty strings.");
  }
  return { ...manifest, dependencies } as ServerModuleManifest;
}

function isolateOptionalModule(instance: FastifyInstance, moduleId: string): FastifyInstance {
  return new Proxy(instance, {
    get(target, property) {
      if (property === "register") {
        const register = Reflect.get(target, property, target) as (...args: unknown[]) => unknown;
        return (plugin: unknown, ...options: unknown[]) => {
          if (typeof plugin !== "function") return Reflect.apply(register, target, [plugin, ...options]);
          const guardedPlugin = async (child: FastifyInstance, pluginOptions: unknown) => {
            try {
              await Reflect.apply(plugin, undefined, [isolateOptionalModule(child, moduleId), pluginOptions]);
            } catch (error) {
              child.log.error({ err: error, module: moduleId }, "Optional module setup failed; the rest of Smart-Church will continue.");
            }
          };
          return Reflect.apply(register, target, [guardedPlugin, ...options]);
        };
      }

      if (property === "addHook") {
        const addHook = Reflect.get(target, property, target) as (...args: unknown[]) => unknown;
        return (hookName: string, hook: (...args: unknown[]) => unknown) => {
          if (!["onReady", "onListen", "onClose", "preClose"].includes(hookName)) {
            return Reflect.apply(addHook, target, [hookName, hook]);
          }
          const guardedHook = async function (this: unknown, ...args: unknown[]) {
            try {
              return await Reflect.apply(hook, this, args);
            } catch (error) {
              target.log.error({ err: error, module: moduleId, hook: hookName }, "Optional module lifecycle hook failed; the rest of Smart-Church will continue.");
            }
          };
          return Reflect.apply(addHook, target, [hookName, guardedHook]);
        };
      }

      const value = Reflect.get(target, property, target) as unknown;
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

export async function registerServerModules(app: FastifyInstance, context: ModuleLoaderContext) {
  const { readdir, readFile } = await import("node:fs/promises");
  const { dirname, join, resolve, sep } = await import("node:path");
  const { fileURLToPath, pathToFileURL } = await import("node:url");
  const modulesRoot = join(dirname(fileURLToPath(import.meta.url)));
  const directories = await readdir(modulesRoot, { withFileTypes: true });

  const discovered: DiscoveredModule[] = [];
  const invalid = new Set<string>();
  const manifestIds = new Set<string>();
  for (const directory of directories) {
    if (!directory.isDirectory()) continue;
    const moduleRoot = resolve(modulesRoot, directory.name);
    try {
      const manifest = validateManifest(JSON.parse(await readFile(join(moduleRoot, "manifest.json"), "utf8")) as unknown, directory.name);
      if (manifestIds.has(manifest.id)) throw new Error(`Duplicate module ID ${manifest.id}.`);
      manifestIds.add(manifest.id);
      if (manifest.required) requiredServerModuleIds.add(manifest.id);
      requiredModuleDependencies.set(manifest.id, manifest.dependencies?.required ?? []);
      if (!manifest.serverEntry) continue;
      if (manifest.serverEntry.includes("..") || !/^\.\/[-a-zA-Z0-9._]+\.ts$/.test(manifest.serverEntry)) throw new Error("The server entry must be a module-local TypeScript file.");
      const entry = resolve(moduleRoot, manifest.serverEntry.slice(2));
      if (!entry.startsWith(`${moduleRoot}${sep}`)) throw new Error("The server entry must stay inside its module folder.");
      discovered.push({ id: manifest.id, root: moduleRoot, manifest, entry });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      invalid.add(directory.name);
      app.log.error({ err: error, module: directory.name }, "Optional server module manifest is invalid; the core server will continue.");
    }
  }

  const byId = new Map(discovered.map((module) => [module.id, module]));
  for (const module of discovered) {
    const required = module.manifest.dependencies?.required ?? [];
    const unavailable = required.filter((id) => !byId.has(id));
    if (unavailable.length) {
      invalid.add(module.id);
      app.log.error({ module: module.id, dependencies: unavailable }, "Server module requires a module that is not installed; skipping activation.");
    }
  }

  const ordered: DiscoveredModule[] = [];
  const pending = new Map([...byId].filter(([id]) => !invalid.has(id)));
  while (pending.size) {
    let progressed = false;
    for (const [id, module] of pending) {
      const dependencies = module.manifest.dependencies?.required ?? [];
      if (dependencies.some((dependency) => pending.has(dependency))) continue;
      if (dependencies.some((dependency) => invalid.has(dependency))) {
        invalid.add(id);
        app.log.error({ module: id }, "A required module dependency failed validation; skipping activation.");
      } else {
        ordered.push(module);
      }
      pending.delete(id);
      progressed = true;
    }
    if (!progressed) {
      for (const [id] of pending) {
        invalid.add(id);
        app.log.error({ module: id }, "A module dependency cycle was found; skipping activation.");
      }
      break;
    }
  }

  const registered = new Set<string>();
  if (context.pool && context.isDatabaseReady()) {
    const installation = await context.pool.query<{ id: string }>("SELECT id FROM installations WHERE is_current = TRUE");
    const installationId = installation.rows[0]?.id;
    if (!installationId) throw new Error("The installation identity could not be loaded before module registration.");
    for (const module of discovered) {
      await context.pool.query(
        `INSERT INTO installation_modules (installation_id,module_id,version,enabled,required,client_managed)
         VALUES ($1,$2,$3,$4 OR EXISTS(SELECT 1 FROM departments WHERE installation_id=$1 AND $2=ANY(enabled_modules)),$5,$6)
         ON CONFLICT (installation_id,module_id) DO UPDATE
           SET version=EXCLUDED.version,
               required=EXCLUDED.required,
               client_managed=EXCLUDED.client_managed,
               enabled=CASE
                 WHEN EXCLUDED.required THEN TRUE
                 WHEN EXCLUDED.module_id='sync' AND installation_modules.version='0.1.7' THEN FALSE
                 ELSE installation_modules.enabled
               END,
               updated_at=now()`,
        [installationId, module.id, module.manifest.version, Boolean(module.manifest.required || module.manifest.enabledByDefault), Boolean(module.manifest.required), module.manifest.clientManaged ?? true],
      );
    }
    const activationRows = await context.pool.query<{ module_id: string; enabled: boolean }>(
      "SELECT module_id,enabled FROM installation_modules WHERE installation_id=$1",
      [installationId],
    );
    moduleActivation.clear();
    for (const row of activationRows.rows) setServerModuleEnabled(row.module_id, row.enabled);
    await context.pool.query(
      `UPDATE departments AS department
          SET enabled_modules=COALESCE((
                SELECT array_agg(module.module_id ORDER BY module.module_id)
                  FROM installation_modules AS module
                 WHERE module.installation_id=department.installation_id
                   AND module.client_managed=TRUE AND module.enabled=TRUE
              ), ARRAY['file-storage','notifications']::TEXT[]),
              updated_at=now()`
    );
  }
  for (const module of ordered) {
    const { id: moduleId, root: moduleRoot, manifest, entry } = module;
    try {
      if (context.pool && context.isDatabaseReady()) {
        const migrationsRoot = join(moduleRoot, "migrations");
        let migrationFiles: string[] = [];
        try {
          migrationFiles = (await readdir(migrationsRoot)).filter((file) => /^\d+_[a-z0-9_-]+\.sql$/.test(file)).sort();
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
        for (const file of migrationFiles) {
          const version = `${manifest.id}:${file}`;
          const client = await context.pool.connect();
          try {
            await client.query("BEGIN");
            await client.query("SELECT pg_advisory_xact_lock(hashtext('smart-church-module-migrations'))");
            const legacyVersion = moduleId === "elvanto-sync" ? `churchtools-sync:${file}` : null;
            const applied = await client.query("SELECT version FROM schema_migrations WHERE version = $1 OR ($2::text IS NOT NULL AND version = $2)", [version, legacyVersion]);
            if (!applied.rowCount) {
              await client.query(await readFile(join(migrationsRoot, file), "utf8"));
              await client.query("INSERT INTO schema_migrations (version) VALUES ($1)", [version]);
            }
            await client.query("COMMIT");
          } catch (error) {
            await client.query("ROLLBACK");
            throw error;
          } finally { client.release(); }
        }
        await installSiteWriteFenceTriggers(context.pool);
      }
      const loaded = await import(pathToFileURL(entry).href) as { registerModuleRoutes?: (app: FastifyInstance, context: ModuleServerContext) => void };
      if (typeof loaded.registerModuleRoutes !== "function") throw new Error("The server entry must export registerModuleRoutes(app, context).");
      const registerModuleRoutes = loaded.registerModuleRoutes;
      const moduleContext: ModuleServerContext = {
        ...context,
        activation: {
          isEnabled: () => manifest.required || manifest.clientManaged === false || isServerModuleEnabled(moduleId),
          onChange: (listener) => manifest.required || manifest.clientManaged === false ? () => undefined : onServerModuleActivationChange(moduleId, listener),
        },
        realtime: {
          publish: (topic, departmentId, payload) => {
            if (manifest.required || manifest.clientManaged === false || isServerModuleEnabled(moduleId)) context.realtime.publish(topic, departmentId, payload);
          },
          onMessage: (topic, handler) => context.realtime.onMessage(topic, (messageContext, payload) => {
            if (manifest.required || manifest.clientManaged === false || isServerModuleEnabled(moduleId)) return handler(messageContext, payload);
          }),
        },
        workers: {
          register: (name, getDiagnostics, restart) => context.workers.register(`${manifest.id}:${name}`, `${manifest.name ?? manifest.id} · ${name}`, getDiagnostics, restart),
        },
        replication: {
          register: (adapter) => {
            if (replicationAdapters.has(moduleId)) throw new Error(`Module ${moduleId} already registered its replication adapter.`);
            const registeredAdapter: ModuleReplicationAdapter = {
              ...adapter,
              moduleId,
              moduleName: manifest.name ?? moduleId,
              isEnabled: () => manifest.required || manifest.clientManaged === false || isServerModuleEnabled(moduleId),
            };
            replicationAdapters.set(moduleId, registeredAdapter);
            return () => { if (replicationAdapters.get(moduleId) === registeredAdapter) replicationAdapters.delete(moduleId); };
          },
          list: getModuleReplicationAdapters,
        },
      };
      app.register(async (scope) => {
        const unavailableRequired = (manifest.dependencies?.required ?? []).filter((dependency) => !registered.has(dependency));
        if (unavailableRequired.length) {
          scope.log.error({ module: moduleId, dependencies: unavailableRequired }, "Required module dependencies failed to register; skipping activation.");
          return;
        }
        const unavailableOptional = (manifest.dependencies?.optional ?? []).filter((dependency) => !registered.has(dependency));
        if (unavailableOptional.length) scope.log.warn({ module: moduleId, dependencies: unavailableOptional }, "Optional module dependencies are unavailable.");
        if (!manifest.required && manifest.clientManaged !== false) {
          scope.addHook("preHandler", async (_request, reply) => {
            if (isServerModuleEnabled(moduleId)) return;
            return reply.code(404).send({ error: "This module is not enabled for this installation." });
          });
        }
        try {
          registerModuleRoutes(isolateOptionalModule(scope, manifest.id), moduleContext);
          registered.add(moduleId);
          scope.log.info({ module: manifest.id }, "Optional server module registered.");
        } catch (error) {
          replicationAdapters.delete(moduleId);
          scope.log.error({ err: error, module: moduleId }, "Optional module setup failed; the rest of Smart-Church will continue.");
        }
      });
    } catch (error) {
      app.log.error({ err: error, module: moduleId }, "Optional server module could not be registered; the core server will continue.");
    }
  }
}
