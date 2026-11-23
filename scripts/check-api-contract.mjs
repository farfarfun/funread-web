/**
 * 轻量契约校验脚本：校验前端 `src/api/client.ts` 中调用的 `/api/v1/...` 路径
 * 是否全部存在于后端导出的 OpenAPI 文档中，防止前后端接口漂移。
 *
 * 零外部依赖：直接读取 `docs/development/<pkg>/openapi/001-openapi.yaml`。
 * 用法：`pnpm run check:contract`
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = path.resolve(WEB_ROOT, "../..");
const CLIENT_PATH = path.join(WEB_ROOT, "src/api/client.ts");

const OPENAPI_FILES = [
  path.join(REPO_ROOT, "docs/development/reader-client/openapi/001-openapi.yaml"),
  path.join(REPO_ROOT, "docs/development/rss-subscription/openapi/001-openapi.yaml"),
];

function extractOpenApiPaths(yamlText) {
  const paths = new Set();
  for (const line of yamlText.split(/\r?\n/)) {
    const match = /^  (\/api\/v1\/[^\s:]+):/.exec(line);
    if (match) paths.add(match[1].replace(/^\/api\/v1/, ""));
  }
  return paths;
}

function normalizePath(raw) {
  // 去掉 query 部分，将模板变量 `${...}` 归一化为 `{}`
  return raw
    .split("?")[0]
    .replace(/\$\{[^}]+\}/g, "{}")
    .replace(/\{[^}]+\}/g, "{}");
}

const specPaths = new Set();
let foundSpecs = 0;
for (const file of OPENAPI_FILES) {
  if (!fs.existsSync(file)) continue;
  foundSpecs += 1;
  for (const p of extractOpenApiPaths(fs.readFileSync(file, "utf8"))) {
    specPaths.add(normalizePath(p));
  }
}

if (!foundSpecs) {
  console.log("未找到本地 OpenAPI 规范（独立仓库模式），跳过契约检查。");
  process.exit(0);
}

const clientSource = fs.readFileSync(CLIENT_PATH, "utf8");
const clientPaths = new Set();
for (const match of clientSource.matchAll(/request(?:<[^>]*>)?\(\s*[`"'](\/[^`"']+)[`"']/g)) {
  clientPaths.add(normalizePath(match[1]));
}

// 仅校验覆盖在两份已导出规范前缀下的端点（/reader, /shelf, /rss）
const checkedPrefixes = ["/reader", "/shelf", "/rss"];
const missing = [];
for (const p of clientPaths) {
  if (!checkedPrefixes.some((prefix) => p === prefix || p.startsWith(`${prefix}/`))) continue;
  if (!specPaths.has(p)) missing.push(p);
}

if (missing.length) {
  console.error("以下前端调用路径未出现在导出的 OpenAPI 规范中（请重跑 export_openapi.py）：");
  for (const p of missing) console.error(`  - ${p}`);
  process.exit(1);
}

console.log(`契约校验通过：已核对 ${clientPaths.size} 条前端请求路径（规范含 ${specPaths.size} 条）。`);
