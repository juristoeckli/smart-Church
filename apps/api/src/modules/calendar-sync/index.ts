import type { FastifyInstance } from "fastify";
import type { ModuleServerContext } from "../module-sdk.js";
import { registerCalendarSyncRoutes } from "./routes.js";

export function registerModuleRoutes(app: FastifyInstance, context: ModuleServerContext) {
  registerCalendarSyncRoutes(app, context);
}
