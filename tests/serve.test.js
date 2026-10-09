import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

import { APP_BASES, listen } from "../server/serve.js";

let root;
let backend;
let backendPort;
let server;
let port;
/** @type {{path: string, method: string, host: string, body: string}[]} */
let seen = [];

function fetchText(target, options = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request(target, { ...options }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => (body += chunk));
      response.on("end", () =>
        resolve({ status: response.statusCode, headers: response.headers, body }),
      );
    });
    request.on("error", reject);
    if (options.body) request.write(options.body);
    request.end();
  });
}

before(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "funread-web-dist-"));
  fs.mkdirSync(path.join(root, "assets"));
  fs.writeFileSync(path.join(root, "index.html"), "<!doctype html><title>spa</title>", "utf8");
  fs.writeFileSync(path.join(root, "assets", "app.js"), "export default 1;", "utf8");
  fs.writeFileSync(path.join(root, "favicon.ico"), "icon", "utf8");

  backend = http.createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      seen.push({
        path: request.url,
        method: request.method,
        host: request.headers.host,
        forwardedHost: request.headers["x-forwarded-host"],
        body,
      });
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ ok: true }));
    });
  });
  await new Promise((resolve) => backend.listen(0, "127.0.0.1", resolve));
  backendPort = backend.address().port;

  server = await listen({
    root,
    backend: `http://127.0.0.1:${backendPort}`,
    host: "127.0.0.1",
    port: 0,
  });
  port = server.address().port;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await new Promise((resolve) => backend.close(resolve));
  fs.rmSync(root, { recursive: true, force: true });
});

const url = (p) => `http://127.0.0.1:${port}${p}`;

describe("reverse proxy", () => {
  it("forwards /api verbatim, query string included", async () => {
    seen = [];
    const response = await fetchText(url("/api/v1/sources?limit=5&q=x"));
    assert.equal(response.status, 200);
    assert.deepEqual(JSON.parse(response.body), { ok: true });
    assert.equal(seen[0].path, "/api/v1/sources?limit=5&q=x");
  });

  it("forwards /healthz", async () => {
    seen = [];
    await fetchText(url("/healthz"));
    assert.equal(seen[0].path, "/healthz");
  });

  it("forwards the request body and method", async () => {
    seen = [];
    await fetchText(url("/api/v1/auth/login"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: '{"username":"a"}',
    });
    assert.equal(seen[0].method, "POST");
    assert.equal(seen[0].body, '{"username":"a"}');
  });

  it("rewrites Host and records the original", async () => {
    seen = [];
    await fetchText(url("/api/v1/x"));
    assert.equal(seen[0].host, `127.0.0.1:${backendPort}`);
    assert.equal(seen[0].forwardedHost, `127.0.0.1:${port}`);
  });

  it("never lets the SPA fallback shadow a backend path", async () => {
    seen = [];
    const response = await fetchText(url("/api/v1/does-not-exist"));
    // Reaches the backend rather than returning index.html.
    assert.equal(seen.length, 1);
    assert.notEqual(response.headers["content-type"], "text/html; charset=utf-8");
  });

  it("reports an unreachable backend as 502 with the reason", async () => {
    const isolated = await listen({
      root,
      backend: "http://127.0.0.1:1",
      host: "127.0.0.1",
      port: 0,
    });
    try {
      const response = await fetchText(
        `http://127.0.0.1:${isolated.address().port}/api/v1/sources`,
      );
      assert.equal(response.status, 502);
      assert.match(response.body, /unreachable/);
    } finally {
      await new Promise((resolve) => isolated.close(resolve));
    }
  });
});

describe("static serving", () => {
  it("redirects / to the reader, not the admin console", async () => {
    const response = await fetchText(url("/"));
    assert.equal(response.status, 302);
    assert.equal(response.headers.location, APP_BASES[0]);
    assert.equal(APP_BASES[0], "/web");
  });

  for (const route of ["/web", "/web/search", "/web/book/abc", "/admin", "/admin/sources"]) {
    it(`serves index.html for the client route ${route}`, async () => {
      const response = await fetchText(url(route));
      assert.equal(response.status, 200);
      assert.equal(response.headers["content-type"], "text/html; charset=utf-8");
      assert.match(response.body, /spa/);
    });
  }

  it("serves a real file in preference to the fallback", async () => {
    const response = await fetchText(url("/favicon.ico"));
    assert.equal(response.status, 200);
    assert.equal(response.body, "icon");
  });

  it("pins fingerprinted assets but not index.html", async () => {
    const asset = await fetchText(url("/assets/app.js"));
    assert.match(asset.headers["cache-control"], /immutable/);
    const page = await fetchText(url("/web"));
    assert.equal(page.headers["cache-control"], "no-cache");
  });

  it("404s a path outside every known base", async () => {
    assert.equal((await fetchText(url("/nope"))).status, 404);
  });

  it("rejects non-GET on a static path", async () => {
    const response = await fetchText(url("/web"), { method: "DELETE" });
    assert.equal(response.status, 405);
    assert.equal(response.headers.allow, "GET, HEAD");
  });

  it("refuses to escape the build root", async () => {
    for (const attempt of ["/../../etc/passwd", "/web/../../../etc/passwd", "/%2e%2e/%2e%2e/etc/passwd"]) {
      const response = await fetchText(url(attempt));
      assert.ok(response.status === 403 || response.status === 404, `${attempt} -> ${response.status}`);
      assert.ok(!response.body.includes("root:"), attempt);
    }
  });

  it("answers /readyz from its own state, not the backend's", async () => {
    seen = [];
    const response = await fetchText(url("/readyz"));
    assert.equal(response.status, 200);
    assert.equal(seen.length, 0);
  });

  it("reports 503 when the build output is missing", async () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), "funread-web-empty-"));
    const isolated = await listen({
      root: empty,
      backend: `http://127.0.0.1:${backendPort}`,
      host: "127.0.0.1",
      port: 0,
    });
    try {
      const base = `http://127.0.0.1:${isolated.address().port}`;
      assert.equal((await fetchText(`${base}/readyz`)).status, 503);
      assert.equal((await fetchText(`${base}/web`)).status, 503);
    } finally {
      await new Promise((resolve) => isolated.close(resolve));
      fs.rmSync(empty, { recursive: true, force: true });
    }
  });
});
