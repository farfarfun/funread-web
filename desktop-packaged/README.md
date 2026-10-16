# funread（Tauri 桌面打包版）

> Web 资源打进应用，启动不用网络；连哪台服务器、用什么凭据，装上之后自己填。

和 [`../mobile-packaged/`](../mobile-packaged/README.md) 是同一个形态，换了个平台，
装的也是**同一份** `dist-packaged/`。和 [`../desktop/`](../desktop/README.md)
（light）的应用标识、产物名都不同，**可以装在同一台机器上对比**。

| | funread light（`../desktop/`） | funread 打包版（这里） |
| --- | --- | --- |
| Web 资源 | 不打包，`navigate()` 到用户服务器 | **打进应用** |
| 页面来源 | 用户的服务器 | `tauri://localhost`（Windows 上 `http://tauri.localhost`） |
| 认证 | 同源 cookie 会话 | **`Authorization: Bearer <设备 token>`** |
| 离线启动 | 要网络 | 能，进去之后才需要网 |
| 应用标识 | `com.farfarfun.funread.light` | `com.farfarfun.funread` |
| 服务端要求 | 任意版本 | 要有 `POST /auth/tokens/issue` |

## `dist-packaged/` 能直接复用，但请求不能直接发

webDir 就是 Vue 那套 SPA 的打包版构建产物（仓库根的 `pnpm run build:packaged`），
**和 Android 打包版装的是同一份产物，Vue 源码一个字都没有为桌面改过**。

但请求发不出去。页面来源从 Capacitor 的 `http://localhost` 换成了 Tauri 的
`tauri://localhost`（Windows 上 `http://tauri.localhost`），于是：

- 这两个来源都**不在** funread-api 的 CORS 白名单里。那个列表是写死的三元组
  （`capacitor://localhost` / `ionic://localhost` / `http://localhost`），
  `allow_origin_regex` 没有传，没有正则也没有通配。
- 就算让用户去 `config.toml` 的 `[auth] cors_origins` 里把两个来源都加上，
  **Linux 和 macOS 上也救不回来**：WebKit 把 `tauri://` 当不透明来源，服务端收到的
  `Origin` 头是空的（[tauri#2327](https://github.com/tauri-apps/tauri/issues/2327)）。
  而 Linux 恰恰是这个客户端的主力平台。

### 所以 fetch 改走 Rust

`src-tauri/src/fetch-bridge.js` 作为窗口的 initialization script 注入，在页面自己的
任何脚本之前执行，把打到**绝对 http/https 地址**的 `fetch` 换成一条 Tauri 命令
（`proxy_fetch`，`src-tauri/src/main.rs`）。相对路径、本地资源一律走原生 fetch。

Rust 发出去的请求根本不在浏览器的 CORS 模型里：

- 三个平台行为一致，不受 `Origin` 头在 WebKit 上为空的影响；
- **用户服务器的配置一行都不用改**，和 Android 打包版的体验一致；
- 顺带绕开了 Chromium 的 Private Network Access —— Windows 上 WebView2 是 Chromium，
  从一个 `.localhost` 来源打 `192.168.x.x` 将来随时可能被它拦下来，而后端没有开
  `allow_private_network`。

为什么不改 Vue：`dist-packaged/` 是 Android 打包版正在用的同一份产物，已经发版了。
为了桌面在公共源码里引一个 Tauri 包（或者加一条运行时分叉），代价会落到浏览器和
Android 两份产物上 —— 和 `../src/api/packaged.ts` 顶部拒绝引 `@capacitor/preferences`
是同一个判断。换 `fetch` 是纯壳层的事。

边界，都是现在成立的：

- **`fetch` 在整个 Vue 源码里只有 `../src/api/client.ts` 两处调用**，都是 JSON。
  没有 WebSocket、没有 EventSource、没有 Service Worker。
- 响应体按文本处理。封面图走 `<img src>` —— 图片是跨源「可嵌入」资源，不经过 fetch，
  也就不受这条限制。
- 不带 cookie。打包版的凭据本来就是设备 token，后端 `allow_credentials=False` 也不
  接受 cookie。

注入的脚本单独放一个 `.js` 文件而不是写成 Rust 里的字符串字面量，是为了它能被**真正
跑起来验**：**里面写错一个字不会让任何一步构建失败**，只会出一个装上之后每个请求都
报错的包。

`../tests/desktop.test.js` 把 `window` / `location` 当参数喂进这段 IIFE、把 Tauri 那条
命令换成假的，于是整条链路能在 `node --test` 里真跑一遍 —— 200/401/204、Authorization
和请求体的转发、原生报错要包成 `TypeError`、本地资源不绕 IPC、重复注入不套两层。
同一个文件还交叉核对了 JS 和 Rust 之间那几个靠字符串对上的名字（命令名、菜单项 id），
它们对不上同样不会让任何一步构建失败。

**Rust 那一半（`proxy_fetch`）没有单元测试**：它要和 tauri 一起编译，而 tauri 在
Linux 上要 WebKitGTK 的开发库。那一半只有 CI 的编译保证。

## 认证：Bearer，不是 cookie

和 Android 打包版完全一样：

1. 首次启动停在 `/web/setup`，填服务器地址 + 账号口令；
2. 客户端调 `POST /api/v1/auth/tokens/issue`（这个端点不需要会话）换一条长期 token；
3. 之后每个请求带 `Authorization: Bearer <token>`。

后端收到 Bearer 就**不回落 cookie**，所以 401 只有一个含义：这条 token 不认了。
客户端据此清掉本地凭据并退回配置页，见 `../src/api/client.ts`。

### token 存在 WebView 的 localStorage 里

Vue 那边用的就是 `localStorage`（理由在 `../src/api/packaged.ts` 顶部）。桌面上它是
**持久**的：三个平台的 WebView 都按应用标识分配一个数据目录，退出时落盘。

两条已知的坑，都不影响这个应用：

- Linux 上多个 WebView 窗口之间的 localStorage 不同步（
  [tauri#10981](https://github.com/tauri-apps/tauri/issues/10981)）——
  这个应用只有一个窗口。
- 换 `useHttpsScheme` 或者换应用标识会改变存储位置，老数据读不到。所以这两项定下来
  之后就不要再动；真动了，用户重新填一次地址和口令即可（服务器地址另存一份，预填
  还在）。

## 路由用 history 模式，没改成 hash

Tauri 的资源协议在找不到对应文件时会回落到 `index.html`
（`get_asset` 里那串 `.or_else`），所以 `/web`、`/web/account`、`/admin/pool` 这些
路径在应用里直接打开、直接刷新都能用，Vue 那边不用为桌面切一套 hash 路由 —— 和
Capacitor 的 `html5mode` 是同一个效果。

## 没有「切换服务器」菜单

light 版的菜单里有一项「切换服务器」，因为它加载的是远端页面、Vue 够不着原生。打包版
的页面来源是本地，「换服务器 / 重新登录」就是 Vue 自己的一个路由（`/web/setup`），
入口在「我的」里。菜单只保留「编辑」（macOS 上没有它 `Cmd+C` / `Cmd+V` 在 WKWebView
里完全没反应）、「视图」和「关于」。

## 本地开发

```bash
# 需要 Rust（1.90+）和各平台的 WebView 开发库，见 https://v2.tauri.app/start/prerequisites/
pnpm install
pnpm run build:packaged          # 产出 dist-packaged/，这是 webDir
cd desktop-packaged
cargo tauri dev
cargo tauri build --bundles deb,appimage
```

**跳过 `build:packaged` 的话 `tauri build` 直接报 frontendDist 不存在。**
`dist-packaged/` 不在版本库里（它是构建产物）。

## CI 与签名

`.github/workflows/ci.yml` 的 `desktop` job，比 light 版那条多两步：先
`pnpm run build:packaged`，再 grep 产物里有没有 `Authorization` —— 漏掉
`--mode packaged` 不会让任何一步失败，只会出一个装上满屏 404 的包。反方向的断言在
`../tests/bundle.test.js`。

Linux 和 Windows 每次 push 都构建，**macOS 只在打 `v*` tag 时构建**（runner 按
10 倍计费）。

**所有产物都没有签名**，也没有做 macOS 公证。绕过方法见
[`../desktop/README.md`](../desktop/README.md#ci-与签名)。

## 没做的事

- 签名、公证、自动更新（`createUpdaterArtifacts` 是关的）。
- 记住窗口大小和位置。
- 把设备名猜得更准：`guessDeviceName()` 现在按 UA 猜，桌面 WebView 的 UA 里没有机型，
  会落到「funread 客户端」这个笼统的名字上。用户可以在配置页改。
