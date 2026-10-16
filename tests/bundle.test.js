import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const ASSETS = path.join(ROOT, "dist", "assets");

/**
 * 同一份 Vue 源码要出两种产物：
 *
 * - `pnpm run build` → `dist/`，发给浏览器、也是 funread light 套壳加载的那份。
 *   页面来源就是用户的服务器，`/api` 同源，cookie 会话原样生效。
 * - `pnpm run build:packaged` → `dist-packaged/`，打进 Android app。页面来源是
 *   `http://localhost`，请求跨站，凭据换成 `Authorization: Bearer <设备 token>`。
 *
 * 两者的分界是构建期常量 `__FUNREAD_PACKAGED__`（见 vite.config.ts 的 define）。
 * 这组断言守的就是这条界：**打包版的认证逻辑一个字都不许漏进浏览器那一份**。
 *
 * 为什么值得专门写一条测试：漏进去不会让构建失败、不会让页面报错，只会在某个
 * 条件下把同源 cookie 请求变成跨站 Bearer 请求 —— 而那一刻用户看到的是「突然要
 * 重新登录」。本机没有安卓设备，CI 也不跑真机，构建产物的内容是唯一能自动验证
 * 这件事的地方。
 */
function chunks() {
  if (!fs.existsSync(ASSETS)) return null;
  return fs
    .readdirSync(ASSETS)
    .filter((name) => name.endsWith(".js"))
    .map((name) => ({ name, text: fs.readFileSync(path.join(ASSETS, name), "utf8") }));
}

describe("浏览器那一份构建", () => {
  const built = chunks();
  //  `pnpm test` 可以单独跑（CI 里是 build 之后紧跟着 test）。没构建过就跳过，
  //  而不是失败 —— 否则一个干净 clone 上的 `pnpm test` 会无故红。
  const skip = built ? false : "dist/ 还没构建，先跑 pnpm run build";

  it("不带 Authorization 头：浏览器和 light 版靠同源 cookie", { skip }, () => {
    for (const chunk of built) {
      assert.ok(
        !chunk.text.includes("Authorization"),
        `${chunk.name} 里出现了 Authorization —— 打包版的 Bearer 分支没有被构建期折掉`,
      );
    }
  });

  it("不带打包版的本地存储键", { skip }, () => {
    for (const chunk of built) {
      assert.ok(
        !chunk.text.includes("funread.packaged"),
        `${chunk.name} 里出现了 funread.packaged.* —— 设备 token 的存储逻辑进了浏览器包`,
      );
    }
  });

  it("API 基址仍然是同源 /api/v1", { skip }, () => {
    assert.ok(
      built.some((chunk) => chunk.text.includes("/api/v1")),
      "一个 chunk 里都找不到 /api/v1，前端大概已经请求不到后端了",
    );
  });
});
