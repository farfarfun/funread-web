import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));

//  仓库里的 Capacitor 工程，一个套壳版一个打包版。每加一个都要确认它没被圈进
//  npm 包 —— 它们各自带一套几十兆的原生工程和 gradle wrapper。
const NATIVE_DIRS = ["mobile", "mobile-packaged"];

/**
 * 这个仓库一身二用：既是 Vue 源码加两套 Capacitor 工程（mobile/、
 * mobile-packaged/），又是 @farfarfun/funread-web 这个 npm 包。两者唯一的隔离手段
 * 就是 package.json 的 files 白名单 —— 它一旦被删掉或者改成通配，那两套原生工程
 * 就会跟着发到 registry 上，而且发出去之前没有任何人会发现。
 */
describe("npm 发布范围", () => {
  it("files 是白名单，没写进去的一律不进 tarball", () => {
    assert.ok(Array.isArray(pkg.files) && pkg.files.length > 0, "files 必须是非空白名单");

    for (const entry of pkg.files) {
      assert.ok(!entry.startsWith("."), `files 里不该出现 ${entry}：相对路径的起点会把整个仓库圈进来`);
      assert.ok(!entry.includes("*"), `files 里不该出现通配 ${entry}`);
    }
  });

  it("两套 Capacitor 工程都不在发布范围内", () => {
    const tops = pkg.files.map((entry) => entry.replace(/^\.\//, "").split("/")[0]);
    for (const dir of NATIVE_DIRS) {
      assert.ok(!tops.includes(dir), `${dir}/ 是源码，不是 npm 包的运行时内容`);
    }
  });

  it("发布的是浏览器那份构建，不是打包版那份", () => {
    //  dist-packaged/ 里的 API 基址取自用户在 app 里填的服务器地址，拿它当
    //  `funread-web server run` 的静态资源端出去，浏览器打开就是一片白 ——
    //  那份构建里根本没有「同源 /api」这条路。
    const tops = pkg.files.map((entry) => entry.replace(/^\.\//, "").split("/")[0]);
    assert.ok(tops.includes("dist"), "dist 必须在白名单里，否则包里没有前端资源");
    assert.ok(!tops.includes("dist-packaged"), "dist-packaged 是 Android app 的资源，不该发出去");
  });

  it("不同时维护 .npmignore", () => {
    //  npm 里 files 优先于 .npmignore，两者混用时哪条生效极难一眼看出来。
    //  这个仓库刻意只用 files。
    assert.ok(!fs.existsSync(path.join(ROOT, ".npmignore")), "只保留 files 一种机制");
  });
});
