import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ command }) => {
  const includeAmx = command === "serve" || process.env.SMART_CHURCH_INCLUDE_AMX === "1";
  return {
    plugins: [react(), {
      name: "optional-amx-module",
      enforce: "pre",
      transform(source: string, id: string) {
        if (includeAmx && id.endsWith("/module-registry.tsx")) {
          return source.replace('["./modules/*/module.tsx", "!./modules/amx/module.tsx"]', '"./modules/*/module.tsx"');
        }
        return null;
      },
    }, {
      name: "signage-bookmarks",
      configureServer(server) {
        server.middlewares.use((request, _response, next) => {
          if (/^\/signage-display\.html\/[A-Z2-9]{4}-[A-Z2-9]{4}\/?$/.test((request.url || "").split("?")[0])) request.url = "/signage-display.html";
          next();
        });
      },
    }],
    server: {
      proxy: {
        "/api": { target: process.env.VITE_API_PROXY_TARGET ?? "http://localhost:3001", ws: true },
      },
    },
  };
});
