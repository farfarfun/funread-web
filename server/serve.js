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
import https from "node:https";
import path from "node:path";
import zlib from "node:zlib";

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

const COMPRESSIBLE_EXTENSIONS = new Set([
  ".html",
  ".js",
  ".mjs",
  ".css",
  ".json",
  ".svg",
  ".webmanifest",
  ".txt",
  ".map",
]);

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "SAMEORIGIN",
  "Referrer-Policy": "strict-origin-when-cross-origin",
};

function isProxyPath(pathname) {
  return PROXY_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function send(response, status, body, headers = {}) {
  response.writeHead(status, {
    ...SECURITY_HEADERS,
    "Content-Type": "text/plain; charset=utf-8",
    ...headers,
  });
  response.end(body);
}

function proxy(request, response, backend) {
  const target = new URL(backend);
  const headers = { ...request.headers };
  // Rewrite Host to the backend's, and record the original for the backend's benefit.
  headers.host = target.host;
  headers["x-forwarded-host"] = request.headers.host ?? "";
  headers["x-forwarded-proto"] = request.headers["x-forwarded-proto"] || "http";

  const upstream = (target.protocol === "https:" ? https : http).request(
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

  // 客户端提前断开时立刻销毁上游连接，避免慢搜索/长查询在后端继续空跑
  const abortUpstream = () => {
    if (!upstream.destroyed) upstream.destroy();
  };
  request.on("aborted", abortUpstream);
  response.on("close", () => {
    if (!response.writableEnded) abortUpstream();
  });

  upstream.on("error", (error) => {
    if (response.destroyed || response.writableEnded) return;
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
  const resolvedCandidate = path.resolve(candidate);
  // 必须带路径分隔符校验，避免同前缀兄弟目录（如 /dist-secret）绕过
  if (
    resolvedCandidate !== resolvedRoot &&
    !resolvedCandidate.startsWith(`${resolvedRoot}${path.sep}`)
  ) {
    return null;
  }
  return resolvedCandidate;
}

function selectEncoding(request, extension, size) {
  if (size < 256 || !COMPRESSIBLE_EXTENSIONS.has(extension)) return null;
  const accept = String(request.headers["accept-encoding"] || "").toLowerCase();
  if (/\bbr\b/.test(accept)) return "br";
  if (/\bgzip\b/.test(accept)) return "gzip";
  return null;
}

function makeEtag(stats) {
  return `W/"${stats.size.toString(16)}-${Math.trunc(stats.mtimeMs).toString(16)}"`;
}

function serveFile(request, response, filePath, stats, { immutable = false } = {}) {
  const extension = path.extname(filePath).toLowerCase();
  const etag = makeEtag(stats);
  const cacheControl = immutable ? "public, max-age=31536000, immutable" : "no-cache";
  const baseHeaders = {
    ...SECURITY_HEADERS,
    "Content-Type": MIME_TYPES[extension] ?? "application/octet-stream",
    "Cache-Control": cacheControl,
    ETag: etag,
    Vary: "Accept-Encoding",
  };

  if (request.headers["if-none-match"] === etag) {
    response.writeHead(304, baseHeaders);
    response.end();
    return;
  }

  const encoding = selectEncoding(request, extension, stats.size);
  const headers = encoding
    ? { ...baseHeaders, "Content-Encoding": encoding }
    : { ...baseHeaders, "Content-Length": String(stats.size) };

  if (request.method === "HEAD") {
    response.writeHead(200, headers);
    response.end();
    return;
  }

  const stream = fs.createReadStream(filePath);
  stream.on("open", () => {
    response.writeHead(200, headers);
    if (encoding === "br") {
      stream.pipe(zlib.createBrotliCompress()).pipe(response);
    } else if (encoding === "gzip") {
      stream.pipe(zlib.createGzip()).pipe(response);
    } else {
      stream.pipe(response);
    }
  });
  stream.on("error", () => {
    if (!response.headersSent) send(response, 404, "not found\n");
    else response.destroy();
  });
}

function safeStat(filePath) {
  try {
    return fs.statSync(filePath);
  } catch {
    return null;
  }
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
    const stats = safeStat(candidate);
    if (stats?.isFile()) {
      serveFile(request, response, candidate, stats, {
        immutable: pathname.startsWith("/assets/"),
      });
      return;
    }

    // 5. Anything under a known base is a client-side route -> index.html.
    const base = APP_BASES.find((b) => pathname === b || pathname.startsWith(`${b}/`));
    if (base) {
      const indexStats = safeStat(indexPath);
      if (!indexStats?.isFile()) {
        send(response, 503, "build output missing; run `pnpm build`\n");
        return;
      }
      serveFile(request, response, indexPath, indexStats);
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
