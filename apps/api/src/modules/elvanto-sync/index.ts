import type { FastifyInstance } from "fastify";
import type { ModuleServerContext } from "../module-sdk.js";
import { registerModuleRoutes as registerElvantoRoutes } from "./routes.js";
import { registerElvantoSongLibraryRoutes } from "./song-library-routes.js";

export function registerModuleRoutes(app: FastifyInstance, context: ModuleServerContext) {
  registerElvantoRoutes(app, context, "elvanto");
  registerElvantoSongLibraryRoutes(app, context);
}
