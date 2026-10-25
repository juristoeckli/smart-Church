import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Pool } from "pg";

export interface ModuleServerContext {
  pool: Pool | null;
  isDatabaseReady: () => boolean;
  getDefaultDepartmentId: () => string;
  resolveDepartmentId: (request: FastifyRequest, reply: FastifyReply, requireSiteAdmin?: boolean, allowQueryLocation?: boolean) => Promise<string | null>;
  validateMutation: (request: FastifyRequest, reply: FastifyReply) => boolean;
  getVideoWorker: () => {
    state: { state: string; error: string | null };
    request: (operation: string, data: Record<string, unknown>, departmentId: string, actor: string, timeout: number) => Promise<unknown>;
  } | null;
}

export interface ServerModuleManifest {
  id: string;
  serverEntry?: string;
}

export async function registerServerModules(app: FastifyInstance, context: ModuleServerContext) {
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
      if (manifest.serverEntry.includes("..") || !/^\.\/[-a-zA-Z0-9._]+\.ts$/.test(manifest.serverEntry)) throw new Error("The server entry must be a module-local TypeScript file.");
      const entry = resolve(moduleRoot, manifest.serverEntry.slice(2));
      if (!entry.startsWith(`${moduleRoot}${sep}`)) throw new Error("The server entry must stay inside its module folder.");
      const loaded = await import(pathToFileURL(entry).href) as { registerModuleRoutes?: (app: FastifyInstance, context: ModuleServerContext) => void };
      if (typeof loaded.registerModuleRoutes !== "function") throw new Error("The server entry must export registerModuleRoutes(app, context).");
      loaded.registerModuleRoutes(app, context);
      app.log.info({ module: manifest.id }, "Optional server module registered.");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      app.log.error({ err: error, module: directory.name }, "Optional server module could not be registered; the core server will continue.");
    }
  }
}
