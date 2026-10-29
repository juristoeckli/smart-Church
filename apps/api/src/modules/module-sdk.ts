import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Pool } from "pg";
import type { LocationPermission } from "@smart-church/contracts";
import type { ManagedWorkerDiagnostics } from "../runtime-diagnostics.js";

export interface ModuleServerContext {
  realtime: {
    publish: (topic: string, departmentId: string, payload?: unknown) => void;
    onMessage: (topic: string, handler: (context: { userId: string; departmentId: string }, payload: unknown) => void | Promise<void>) => () => void;
  };
  workers: {
    register: (name: string, getDiagnostics: () => ManagedWorkerDiagnostics) => () => void;
  };
  pool: Pool | null;
  isDatabaseReady: () => boolean;
  getDefaultDepartmentId: () => string;
  resolveDepartmentId: (request: FastifyRequest, reply: FastifyReply, requireSiteAdmin?: boolean, allowQueryLocation?: boolean, requiredPermission?: LocationPermission) => Promise<string | null>;
  validateMutation: (request: FastifyRequest, reply: FastifyReply) => boolean;
  getVideoWorker: () => {
    state: { state: string; error: string | null };
    request: (operation: string, data: Record<string, unknown>, departmentId: string, actor: string, timeout: number) => Promise<unknown>;
  } | null;
}

export interface ModuleLoaderContext extends Omit<ModuleServerContext, "workers"> {
  workers: {
    register: (id: string, name: string, getDiagnostics: () => ManagedWorkerDiagnostics) => () => void;
  };
}

export interface ServerModuleManifest {
  id: string;
  name?: string;
  serverEntry?: string;
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

  for (const directory of directories) {
    if (!directory.isDirectory()) continue;
    const moduleRoot = resolve(modulesRoot, directory.name);
    try {
      const manifest = JSON.parse(await readFile(join(moduleRoot, "manifest.json"), "utf8")) as ServerModuleManifest;
      if (!manifest.serverEntry) continue;
      if (manifest.id !== directory.name || !/^[a-z0-9][a-z0-9-]*$/.test(manifest.id)) throw new Error("The module ID must match its folder name and use lowercase letters, numbers, and hyphens.");
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
            const applied = await client.query("SELECT version FROM schema_migrations WHERE version = $1", [version]);
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
      }
      if (manifest.serverEntry.includes("..") || !/^\.\/[-a-zA-Z0-9._]+\.ts$/.test(manifest.serverEntry)) throw new Error("The server entry must be a module-local TypeScript file.");
      const entry = resolve(moduleRoot, manifest.serverEntry.slice(2));
      if (!entry.startsWith(`${moduleRoot}${sep}`)) throw new Error("The server entry must stay inside its module folder.");
      const loaded = await import(pathToFileURL(entry).href) as { registerModuleRoutes?: (app: FastifyInstance, context: ModuleServerContext) => void };
      if (typeof loaded.registerModuleRoutes !== "function") throw new Error("The server entry must export registerModuleRoutes(app, context).");
      const moduleContext: ModuleServerContext = {
        ...context,
        workers: {
          register: (name, getDiagnostics) => context.workers.register(`${manifest.id}:${name}`, `${manifest.name ?? manifest.id} · ${name}`, getDiagnostics),
        },
      };
      loaded.registerModuleRoutes(isolateOptionalModule(app, manifest.id), moduleContext);
      app.log.info({ module: manifest.id }, "Optional server module registered.");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      app.log.error({ err: error, module: directory.name }, "Optional server module could not be registered; the core server will continue.");
    }
  }
}
