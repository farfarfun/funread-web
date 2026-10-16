import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));

/**
 * 这个仓库一身二用：既是 Vue 源码加 Capacitor 套壳（mobile/），又是
 * @farfarfun/funread-web 这个 npm 包。两者唯一的隔离手段就是 package.json 的
 * files 白名单 —— 它一旦被删掉或者改成通配，mobile/ 下那套几十兆的原生工程就会
 * 跟着发到 registry 上，而且发出去之前没有任何人会发现。
 */
describe("npm 发布范围", () => {
  it("files 是白名单，没写进去的一律不进 tarball", () => {
    assert.ok(Array.isArray(pkg.files) && pkg.files.length > 0, "files 必须是非空白名单");

    for (const entry of pkg.files) {
      assert.ok(!entry.startsWith("."), `files 里不该出现 ${entry}：相对路径的起点会把整个仓库圈进来`);
      assert.ok(!entry.includes("*"), `files 里不该出现通配 ${entry}`);
    }
  });

  it("mobile/ 不在发布范围内", () => {
    const tops = pkg.files.map((entry) => entry.replace(/^\.\//, "").split("/")[0]);
    assert.ok(!tops.includes("mobile"), "Capacitor 套壳是源码，不是 npm 包的运行时内容");
  });

  it("不同时维护 .npmignore", () => {
    //  npm 里 files 优先于 .npmignore，两者混用时哪条生效极难一眼看出来。
    //  这个仓库刻意只用 files。
    assert.ok(!fs.existsSync(path.join(ROOT, ".npmignore")), "只保留 files 一种机制");
  });
});
