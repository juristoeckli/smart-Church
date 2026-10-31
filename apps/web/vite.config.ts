import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react(), {
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
});
