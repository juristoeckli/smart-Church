import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("./dist/", import.meta.url)));
const optionalModulesRoot = resolve(process.env.SMART_CHURCH_OPTIONAL_MODULES_DIR ?? "/app/optional-modules/.web");
const port = Number(process.env.PORT ?? 8080);
const host = process.env.HOST ?? "0.0.0.0";
const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"], [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"], [".jpeg", "image/jpeg"], [".jpg", "image/jpeg"],
  [".js", "text/javascript; charset=utf-8"], [".json", "application/json; charset=utf-8"],
  [".png", "image/png"], [".svg", "image/svg+xml"], [".webp", "image/webp"],
  [".woff", "font/woff"], [".woff2", "font/woff2"],
]);

const server = createServer(async (request, response) => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { Allow: "GET, HEAD" }).end();
    return;
  }

  let pathname;
  try { pathname = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname); }
  catch { response.writeHead(400).end(); return; }

  const optionalMatch = pathname.match(/^\/optional-modules\/([a-z0-9][a-z0-9-]*)\/(.+)$/);
  if (optionalMatch) {
    const moduleRoot = optionalMatch[1] === "runtime"
      ? resolve(root, "optional-modules/runtime")
      : resolve(optionalModulesRoot, optionalMatch[1]);
    const optionalTarget = resolve(moduleRoot, optionalMatch[2]);
    if (!optionalTarget.startsWith(`${moduleRoot}${sep}`)) { response.writeHead(400).end(); return; }
    try {
      const details = await stat(optionalTarget);
      if (!details.isFile()) { response.writeHead(404).end(); return; }
    } catch { response.writeHead(404).end(); return; }
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Cache-Control", /-[a-zA-Z0-9_-]{8,}\.[a-z0-9]+$/i.test(optionalMatch[2]) ? "public, max-age=31536000, immutable" : "no-cache");
    response.setHeader("Content-Type", contentTypes.get(extname(optionalTarget).toLowerCase()) ?? "application/octet-stream");
    if (request.method === "HEAD") { response.writeHead(200).end(); return; }
    createReadStream(optionalTarget).on("error", () => response.destroy()).pipe(response);
    return;
  }

  const playerBookmark = /^\/signage-display\.html\/[A-Z2-9]{4}-[A-Z2-9]{4}\/?$/.test(pathname);
  const requested = resolve(root, playerBookmark ? "signage-display.html" : `.${pathname}`);
  let target = requested.startsWith(`${root}${sep}`) || requested === root ? requested : resolve(root, "index.html");
  try {
    const details = await stat(target);
    if (details.isDirectory()) target = resolve(target, "index.html");
    await stat(target);
  } catch {
    if (extname(pathname)) { response.writeHead(404).end(); return; }
    target = resolve(root, "index.html");
  }

  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  response.setHeader("Content-Type", contentTypes.get(extname(target).toLowerCase()) ?? "application/octet-stream");
  if (target.includes(`${sep}assets${sep}`)) response.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  else response.setHeader("Cache-Control", "no-cache");
  if (request.method === "HEAD") { response.writeHead(200).end(); return; }
  createReadStream(target).on("error", () => response.destroy()).pipe(response);
});

server.listen(port, host, () => process.stdout.write(`Smart-Church web listening on ${host}:${port}\n`));
