import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

function optionalModuleCssEntry(): Plugin {
  return {
    name: "optional-module-entry-css",
    apply: "build" as const,
    generateBundle(_options, bundle) {
      const entry = Object.values(bundle).find((item) => item.type === "chunk" && item.isEntry);
      const importedCss = (entry as (typeof entry & { viteMetadata?: { importedCss?: Set<string> } }) | undefined)?.viteMetadata?.importedCss;
      const css = [...(importedCss ?? [])].map((fileName) => {
        const asset = bundle[fileName];
        if (!asset || asset.type !== "asset") return "";
        delete bundle[fileName];
        return typeof asset.source === "string" ? asset.source : new TextDecoder().decode(asset.source);
      }).filter(Boolean).join("\n");
      this.emitFile({ type: "asset", fileName: "module.css", source: css });
    },
  };
}

export default defineConfig(({ command }) => {
  const optionalWebModule = process.env.SMART_CHURCH_BUILD_OPTIONAL_WEB_MODULE;
  const reactRuntimeBuild = process.env.SMART_CHURCH_BUILD_REACT_RUNTIME === "1";
  const appRoot = process.cwd();
  return {
    base: optionalWebModule ? `/optional-modules/${optionalWebModule}/` : reactRuntimeBuild ? "/optional-modules/runtime/" : "/",
    plugins: [react(), ...(optionalWebModule ? [optionalModuleCssEntry()] : []), {
      name: "optional-module-development-registry",
      enforce: "pre",
      transform(source: string, id: string) {
        if (command === "serve" && id.endsWith("/module-registry.tsx")) {
          return source.replace('["./modules/*/module.tsx", "!./modules/amx/module.tsx", "!./modules/remote-desktop/module.tsx"]', '"./modules/*/module.tsx"');
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
    publicDir: optionalWebModule || reactRuntimeBuild ? false : undefined,
    build: optionalWebModule ? {
      outDir: resolve(appRoot, `dist-optional/${optionalWebModule}`),
      emptyOutDir: true,
      rollupOptions: {
        input: resolve(appRoot, `src/modules/${optionalWebModule}/module.tsx`),
        preserveEntrySignatures: "exports-only",
        external: ["react", "react/jsx-runtime"],
        output: { entryFileNames: "module.js", chunkFileNames: "assets/[name]-[hash].js", assetFileNames: "assets/[name]-[hash][extname]" },
      },
    } : reactRuntimeBuild ? {
      outDir: resolve(appRoot, "dist/optional-modules/runtime"),
      emptyOutDir: true,
      rollupOptions: {
        input: {
          react: resolve(appRoot, "src/react-runtime/react.ts"),
          "jsx-runtime": resolve(appRoot, "src/react-runtime/jsx-runtime.ts"),
        },
        preserveEntrySignatures: "exports-only",
        output: { entryFileNames: "[name].js", chunkFileNames: "assets/[name]-[hash].js" },
      },
    } : {
      rollupOptions: { external: ["react", "react/jsx-runtime", "react-dom/client"] },
    },
    server: {
      proxy: {
        "/api": { target: process.env.VITE_API_PROXY_TARGET ?? "http://localhost:3001", ws: true },
      },
    },
  };
});
