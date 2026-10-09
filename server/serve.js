/**
 * The funread-web production server.
 *
 * It does two things, not one:
 *   - serves the Vite build output for /admin and /web (SPA fallback per base)
 *   - reverse-proxies /api/** and /healthz to funread-api
 *
 * The proxy is not optional. Without it the browser would talk to funread-api
 * directly and hit CORS -- and funread-api deliberately has no CORS middleware,
 * because opening the backend to arbitrary origins is a worse answer than
 * same-origin proxying.
 *
 * Node standard library only: no express, no http-proxy.
 */

import fs from "node:fs";
import http from "node:http";
import path from "node:path";

import { PROXY_PREFIXES } from "./config.js";

/** Base paths the SPA owns. `/` redirects to the first one. */
export const APP_BASES = ["/web", "/admin"];

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

function isProxyPath(pathname) {
  return PROXY_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function send(response, status, body, headers = {}) {
  response.writeHead(status, { "Content-Type": "text/plain; charset=utf-8", ...headers });
  response.end(body);
}

function proxy(request, response, backend) {
  const target = new URL(backend);
  const headers = { ...request.headers };
  // Rewrite Host to the backend's, and record the original for the backend's benefit.
  headers.host = target.host;
  headers["x-forwarded-host"] = request.headers.host ?? "";
  headers["x-forwarded-proto"] = "http";

  const upstream = http.request(
    {
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || (target.protocol === "https:" ? 443 : 80),
      method: request.method,
      path: request.url,
      headers,
    },
    (upstreamResponse) => {
      response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
      upstreamResponse.pipe(response);
    },
  );

  upstream.on("error", (error) => {
    if (response.headersSent) {
      response.destroy();
      return;
    }
    // 502 with the reason: a blank failure here is indistinguishable from the
    // SPA being broken, which sends people debugging the wrong process.
    send(response, 502, `backend ${backend} unreachable: ${error.message}\n`);
  });

  request.pipe(upstream);
}

function resolveStatic(root, pathname) {
  // Reject anything that escapes the root after normalisation, including the
  // encoded forms -- decodeURIComponent happens before this check.
  const relative = path.normalize(pathname).replace(/^(\.\.[/\\])+/, "");
  const candidate = path.join(root, relative);
  const resolvedRoot = path.resolve(root);
  if (!path.resolve(candidate).startsWith(resolvedRoot)) return null;
  return candidate;
}

function serveFile(response, filePath, { immutable = false } = {}) {
  const extension = path.extname(filePath).toLowerCase();
  const stream = fs.createReadStream(filePath);
  stream.on("open", () => {
    response.writeHead(200, {
      "Content-Type": MIME_TYPES[extension] ?? "application/octet-stream",
      // Vite fingerprints everything under /assets, so those are safe to pin.
      "Cache-Control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
    });
    stream.pipe(response);
  });
  stream.on("error", () => send(response, 404, "not found\n"));
}

/**
 * @param {{root: string, backend: string}} options
 */
export function createRequestHandler({ root, backend }) {
  const indexPath = path.join(root, "index.html");

  return function handle(request, response) {
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    } catch {
      send(response, 400, "bad request\n");
      return;
    }

    // 1. Backend paths. Checked first so no SPA fallback can ever shadow them.
    if (isProxyPath(pathname)) {
      proxy(request, response, backend);
      return;
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      send(response, 405, "method not allowed\n", { Allow: "GET, HEAD" });
      return;
    }

    // 2. The service's own liveness, distinct from the backend's /healthz.
    if (pathname === "/readyz") {
      const ready = fs.existsSync(indexPath);
      send(response, ready ? 200 : 503, ready ? "ok\n" : "build output missing\n");
      return;
    }

    // 3. Bare root goes to the reader, not the admin console.
    if (pathname === "/") {
      send(response, 302, "", { Location: APP_BASES[0] });
      return;
    }

    // 4. A real file on disk wins.
    const candidate = resolveStatic(root, pathname);
    if (candidate === null) {
      send(response, 403, "forbidden\n");
      return;
    }
    let stats = null;
    try {
      stats = fs.statSync(candidate);
    } catch {
      stats = null;
    }
    if (stats?.isFile()) {
      serveFile(response, candidate, { immutable: pathname.startsWith("/assets/") });
      return;
    }

    // 5. Anything under a known base is a client-side route -> index.html.
    const base = APP_BASES.find((b) => pathname === b || pathname.startsWith(`${b}/`));
    if (base) {
      if (!fs.existsSync(indexPath)) {
        send(response, 503, "build output missing; run `pnpm build`\n");
        return;
      }
      serveFile(response, indexPath);
      return;
    }

    send(response, 404, "not found\n");
  };
}

/**
 * Start listening. Resolves once bound, rejects on a bind error so the caller
 * can report it instead of hanging.
 *
 * @returns {Promise<import("node:http").Server>}
 */
export function listen({ root, backend, host, port }) {
  const server = http.createServer(createRequestHandler({ root, backend }));
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.removeListener("error", reject);
      resolve(server);
    });
  });
}
