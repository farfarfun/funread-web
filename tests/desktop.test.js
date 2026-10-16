import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = fs.readFileSync(
  path.join(ROOT, "desktop-packaged/src-tauri/src/fetch-bridge.js"),
  "utf8",
);

/**
 * 桌面打包版注入进 WebView 的那段 fetch 桥。
 *
 * 它是这个仓库里**最没法靠眼睛验的一段代码**：装进 app 之后它换掉的是每一个 API
 * 请求，写错一个字就是满屏报错，而 CI 不跑 GUI、本机也没有桌面环境。`node --check`
 * 只拦得住语法错误。
 *
 * 好在它依赖的全是 Node 22 本来就有的 Web API（`Request` / `Response` / `Headers`），
 * 原生那一侧又只是一条返回 JSON 的命令 —— 把 `window` 和 `location` 当参数喂进去、
 * 把 Rust 那条命令换成一个假的，整段逻辑就能在这里真跑一遍。
 *
 * 这里**不验** Rust 那一半（`proxy_fetch`）：它要和 tauri 一起编译，而 tauri 在
 * Linux 上要 WebKitGTK 的开发库。那一半只能靠 CI 的编译 + 真机。
 */
function loadBridge({ invoke, native, origin = "http://tauri.localhost" }) {
  //  这段脚本是个引用自由变量 window / location 的 IIFE，所以直接把它们做成形参 ——
  //  比起 vm.createContext，少一层 realm，断言里的 Response 还是同一个类。
  const window = { fetch: native, __TAURI_INTERNALS__: { invoke } };
  const run = new Function("window", "location", SOURCE);
  run(window, { origin });
  return { window, fetch: window.fetch };
}

/** 假的原生那一侧：记下收到的请求，回一个能被 Response 接受的结构。 */
function fakeNative(reply) {
  const calls = [];
  const invoke = async (cmd, args) => {
    assert.equal(cmd, "proxy_fetch", "只应该调 proxy_fetch 这一条命令");
    calls.push(args.request);
    if (typeof reply === "function") return reply(args.request);
    return reply;
  };
  return { invoke, calls };
}

const OK = {
  status: 200,
  statusText: "OK",
  headers: [["content-type", "application/json"]],
  body: '{"ok":true}',
};

describe("桌面打包版的 fetch 桥", () => {
  it("打到用户服务器的请求交给原生，不走 WebView", async () => {
    const { invoke, calls } = fakeNative(OK);
    const { fetch } = loadBridge({
      invoke,
      native: () => assert.fail("绝对 http 地址不该落回原生 fetch"),
    });

    const response = await fetch("http://192.168.1.10:8811/api/v1/auth/me");

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "http://192.168.1.10:8811/api/v1/auth/me");
    assert.equal(calls[0].method, "GET");
    //  GET 不该去读请求体 —— 读了只会白起一个 Promise。
    assert.equal(calls[0].body, null);
    assert.equal(response.status, 200);
    assert.ok(response.ok);
    assert.deepEqual(await response.json(), { ok: true });
  });

  it("Authorization 和请求体原样带过去", async () => {
    const { invoke, calls } = fakeNative(OK);
    const { fetch } = loadBridge({ invoke, native: () => assert.fail("不该落回原生") });

    await fetch("http://192.168.1.10:8811/api/v1/shelf", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer deadbeef" },
      body: JSON.stringify({ book_key: "abc" }),
    });

    const sent = calls[0];
    assert.equal(sent.method, "POST");
    //  `Request.headers` 把名字统一成小写，Rust 那边照单转发，服务端不区分大小写。
    assert.equal(sent.headers.authorization, "Bearer deadbeef");
    assert.equal(sent.headers["content-type"], "application/json");
    assert.equal(sent.body, '{"book_key":"abc"}');
  });

  it("204 不会把 Response 构造函数炸掉", async () => {
    //  `new Response(body, { status: 204 })` 在 body 非空时直接抛。`client.ts` 的
    //  DELETE / PUT 一大片都回 204，这里漏一个判断就是「退订书架」之类全部报错。
    const { invoke } = fakeNative({ status: 204, statusText: "No Content", headers: [], body: "" });
    const { fetch } = loadBridge({ invoke, native: () => assert.fail("不该落回原生") });

    const response = await fetch("http://192.168.1.10:8811/api/v1/shelf/abc", {
      method: "DELETE",
    });

    assert.equal(response.status, 204);
    assert.ok(response.ok);
  });

  it("401 原样透出去，不在桥这一层吞掉", async () => {
    //  打包版靠 401 判断「这条 token 不认了」并退回配置页（见 src/api/client.ts）。
    //  桥这一层要是把非 2xx 当错误抛，那条路径就彻底断了。
    const { invoke } = fakeNative({
      status: 401,
      statusText: "Unauthorized",
      headers: [["content-type", "application/json"]],
      body: '{"detail":"需要登录"}',
    });
    const { fetch } = loadBridge({ invoke, native: () => assert.fail("不该落回原生") });

    const response = await fetch("http://192.168.1.10:8811/api/v1/auth/me");

    assert.equal(response.status, 401);
    assert.equal(response.ok, false);
    assert.deepEqual(await response.json(), { detail: "需要登录" });
  });

  it("原生那边报错时抛 TypeError，和网络挂掉时的 fetch 一样", async () => {
    //  `client.ts` 的 catch 分支就指望这一点：它给的是「挨个看一眼」那段排查文案，
    //  前提是失败长得像一次普通的网络失败，而不是一个字符串。
    const invoke = async () => {
      throw "连不上这台服务器，看看地址、端口和网络。";
    };
    const { fetch } = loadBridge({ invoke, native: () => assert.fail("不该落回原生") });

    await assert.rejects(() => fetch("http://192.168.1.10:8811/api/v1/auth/me"), {
      name: "TypeError",
      message: "连不上这台服务器，看看地址、端口和网络。",
    });
  });

  it("应用自己的资源走原生 fetch，不绕一圈原生", async () => {
    //  Windows 上页面来源本身就是 http://tauri.localhost，它和用户服务器长得一样是
    //  http://，只能靠 origin 比对分开。分错的话每个 JS/CSS 都要多绕一次 IPC。
    let nativeCalls = 0;
    const { invoke, calls } = fakeNative(OK);
    const { fetch } = loadBridge({
      invoke,
      origin: "http://tauri.localhost",
      native: async () => {
        nativeCalls += 1;
        return new Response("/* asset */");
      },
    });

    await fetch("http://tauri.localhost/assets/index-abc123.js");

    assert.equal(nativeCalls, 1);
    assert.equal(calls.length, 0, "本地资源不该走 proxy_fetch");
  });

  it("重复注入不会把自己套两层", async () => {
    //  注入脚本每次文档加载都会跑一遍。套两层之后第二层会把第一层当成「原生
    //  fetch」，每个请求多绕一跳，出错时堆栈完全读不懂。
    const { invoke, calls } = fakeNative(OK);
    const { window } = loadBridge({ invoke, native: () => assert.fail("不该落回原生") });
    const wrapped = window.fetch;

    const run = new Function("window", "location", SOURCE);
    run(window, { origin: "http://tauri.localhost" });

    assert.equal(window.fetch, wrapped, "第二次注入应当直接返回");
    await window.fetch("http://192.168.1.10:8811/api/v1/auth/me");
    assert.equal(calls.length, 1);
  });

  it("原生接口缺席时报一句人话，而不是 undefined is not a function", async () => {
    const window = { fetch: () => assert.fail("不该落回原生") };
    const run = new Function("window", "location", SOURCE);
    run(window, { origin: "http://tauri.localhost" });

    await assert.rejects(() => window.fetch("http://192.168.1.10:8811/api/v1/auth/me"), {
      name: "TypeError",
      message: /原生接口不可用/,
    });
  });
});

const read = (relative) => fs.readFileSync(path.join(ROOT, relative), "utf8");
const unique = (list) => [...new Set(list)].sort();

/** `tauri::generate_handler![a, b]` 里注册了哪些命令。 */
function registeredCommands(rust) {
  const match = /generate_handler!\[([^\]]*)\]/.exec(rust);
  assert.ok(match, "main.rs 里应当有 generate_handler![...]");
  return unique(
    match[1]
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean),
  );
}

/** JS 那边 `invoke("name", ...)` 调了哪些命令。 */
function calledCommands(js) {
  return unique([...js.matchAll(/\binvoke\(\s*["']([a-z_]+)["']/g)].map((m) => m[1]));
}

/**
 * JS 和 Rust 之间那几个靠字符串对上的名字。
 *
 * 命令名、菜单项 id —— 两边对不上不会让任何一步构建失败（`node --check` 和
 * `cargo build` 各看各的），只会出一个「按了没反应」或者「每个请求都报 Command
 * not found」的安装包。本机没有桌面环境，CI 也不跑 GUI，这几条断言是唯一拦得住
 * 它的东西。
 */
describe("桌面壳：JS 和 Rust 之间的字符串", () => {
  it("light 启动页调的命令，main.rs 里都注册了", () => {
    const registered = registeredCommands(read("desktop/src-tauri/src/main.rs"));
    const called = calledCommands(read("desktop/www/launcher.js"));

    assert.deepEqual(registered, ["open", "probe"]);
    assert.deepEqual(called, registered);
  });

  it("打包版的 fetch 桥调的命令，main.rs 里都注册了", () => {
    const registered = registeredCommands(read("desktop-packaged/src-tauri/src/main.rs"));
    const called = calledCommands(read("desktop-packaged/src-tauri/src/fetch-bridge.js"));

    assert.deepEqual(registered, ["proxy_fetch"]);
    assert.deepEqual(called, registered);
  });

  for (const project of ["desktop", "desktop-packaged"]) {
    it(`${project} 的菜单项 id 都有对应的处理分支`, () => {
      const rust = read(`${project}/src-tauri/src/main.rs`);
      //  只有自定义项要自己处理，PredefinedMenuItem 的行为由系统给。
      const ids = unique(
        [...rust.matchAll(/MenuItem::with_id\(\s*app,\s*"([a-z-]+)"/g)].map((m) => m[1]),
      );
      //  on_menu_event 里的 `"back" => {`
      const handled = unique([...rust.matchAll(/^\s*"([a-z-]+)" => \{/gm)].map((m) => m[1]));

      assert.ok(ids.length > 0, "至少应当有一个自定义菜单项");
      assert.deepEqual(handled, ids);
    });
  }

  it("light 的「切换服务器」和启动页的 setup=1 是一对", () => {
    //  菜单带着 ?setup=1 跳回启动页，启动页据此停下来不自动跳走。两边改一边，
    //  表现是「按了切换服务器，一瞬间又被弹回当前服务器」。
    assert.match(read("desktop/src-tauri/src/main.rs"), /set_query\(Some\("setup=1"\)\)/);
    assert.match(read("desktop/www/launcher.js"), /setup=1/);
  });
});
