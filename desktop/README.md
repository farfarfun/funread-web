# funread light（Tauri 桌面壳）

> 一个只做一件事的壳：打开**你自己那台** funread 服务器上的页面。

和 [`../mobile/`](../mobile/README.md) 是同一个形态，换了个平台。funread 是自托管的，
没有"官方服务器"可连，所以这个 app 装上之后第一件事是问你服务器地址（比如
`http://192.168.1.10:8811`）。填完之后它就把整个窗口交给那台服务器的页面，之后的
一切 —— 书架、阅读、离线缓存、登录态 —— 和你在桌面浏览器里打开同一个地址完全一样。

| | |
| --- | --- |
| 应用标识 | `com.farfarfun.funread.light` |
| 应用名 | funread light |
| 产物 | `funread-light-<tag>-linux.AppImage` / `.deb`、`-windows-setup.exe` / `.msi`、`-macos.dmg` |
| 最低系统 | Ubuntu 22.04 同期及以后 / Windows 10 1803+（要 WebView2）/ macOS 10.15 |

和打包版 [`../desktop-packaged/`](../desktop-packaged/README.md) 的应用标识、产物名
都不同，**可以装在同一台机器上对比**。

## 为什么是 Tauri，不是 Electron

Electron 每个 app 自带一份 Chromium，光运行时就 100MB 起步。Tauri 用系统 WebView
（Linux 的 WebKitGTK、Windows 的 WebView2、macOS 的 WKWebView），壳本身是个位数 MB。
对一个「打开你自己那台服务器」的自托管小工具，这个差距没有道理。

代价要说清楚：**Linux 上的渲染行为取决于用户装的 WebKitGTK 版本**。这正是产物固定在
ubuntu-22.04 上构建的原因 —— 它是标准源里就带 webkit2gtk-4.1 的第一个 LTS，也因此是
AppImage 的 glibc 基线。在更新的发行版上构建出来的 AppImage，老系统装不上。

另一个坑不成立，确认过了：Tauri 2 默认**没有** CSP（`app.security.csp` 是 null），
也**没有**导航白名单，所以加载明文 `http://` 的局域网地址不需要任何额外开关。
Android 那边要在 `AndroidManifest.xml` 里显式写 `usesCleartextTraffic`，桌面没有对应
的东西要开。

## 不打包 Web 资源，直接加载用户服务器

页面来源就是用户自己的服务器，于是 `/api` 是**同源**请求，后端现有的 cookie 会话原样
生效 —— **后端一行都不用改**。这是 light 版存在的全部理由。

代价是**启动必须有网络**。这是预期行为，不是待修的缺陷。要离线启动请装
[打包版](../desktop-packaged/README.md)。

### 地址是运行时的，`tauri.conf.json` 里的 URL 不是

`build.frontendDist` / `build.devUrl` 和 Capacitor 的 `server.url` 一样是**构建期**
配置：它在编译时被 `tauri::generate_context!()` 固化进二进制，运行时改不了。而服务器
地址恰恰是每个用户都不一样的东西。

所以走的是和 Android 版同一条路：`frontendDist` 里只有一个 `www/index.html` 启动页，
拿到地址之后由 Rust 这边 `WebviewWindow::navigate()` 整窗口跳过去。

## 和 Android light 不一样的两处

### 探活在 Rust 里，不在页面里

Android 那版的启动页用 `fetch(..., { mode: "no-cors" })` 探活。桌面这边三个平台是三套
WebView，页面来源又是 `tauri://localhost` 这种非 http 的自定义协议 —— 跨源 `fetch` 在
这些组合下的行为没法在本机验证，**而探活失败就等于永远连不上**，是这个壳唯一的关键
路径。

Rust 这边连一个 TCP 都不经过 WebView，三个平台行为完全一致，而且能分清「域名解析
不了」「连接被拒绝」「超时」—— 正好是用户要看的那三种错误。代价是它只验证
「那个 `host:port` 上有人在听」，不验证对面是不是 funread。所以启动页上还留了一个
**「仍然打开」**：有人会把 funread 挂在只认 HTTP 请求、不接受裸 TCP 探测的网关后面，
探活错判的代价是整个 app 用不了，而多一个按钮的代价只是多一个按钮。

### 「切换服务器」是原生菜单，不是注入的 JS 接口

Android 那边用 `addJavascriptInterface` 往 WebView 上挂了 `window.FunreadShell`，代价
是那个接口对**所有**加载进来的来源都可见。桌面上不需要这条路：菜单在窗口外面，远端
页面既看不见也碰不着。

三条回到启动页的路：

1. **菜单栏「文件 → 切换服务器」**（`Ctrl/Cmd + Shift + S`）。任何时候都有效，不依赖
   服务器上 funread-web 的版本。
2. **连不上的时候自动回来**。启动时探活失败就停在启动页并说明原因，不会卡在白屏。
3. 启动页会记住最近 5 个地址，家里一个、外网一个，点一下就切。

菜单里另有「后退 / 前进 / 重新加载」。这三项都是 `eval` 注入到页面里执行的 —— 此刻
窗口里是**远端**页面，Tauri 的窗口 API 管不到它的历史栈。

## 本地开发

```bash
# 需要 Rust（1.90+）和各平台的 WebView 开发库，见 https://v2.tauri.app/start/prerequisites/
# Linux: libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf
cd desktop
cargo install tauri-cli --version '^2'   # 或 npx @tauri-apps/cli
cargo tauri dev
cargo tauri build --bundles deb,appimage
```

`www/` 是手写的启动页，进版本库。没有 npm 工程 —— 这一版不需要任何前端构建。

## CI 与签名

`.github/workflows/ci.yml` 的 `desktop` job。Linux 和 Windows 每次 push 都构建，
**macOS 只在打 `v*` tag 时构建**（runner 按 10 倍计费）。要在非 tag 上验一次 macOS：
手动跑 workflow 时把 `desktop_macos` 勾上。

CI 不跑 GUI，所以启动页只过 `node --check`。另外 `../tests/desktop.test.js` 交叉核对了
启动页 `invoke()` 的命令名和 `main.rs` 里 `generate_handler!` 注册的那些、菜单项 id 和
它的处理分支、以及「切换服务器」和 `?setup=1` 这一对 —— 这些两边对不上都**不会**让
任何一步构建失败，只会出一个「按了没反应」的安装包。

**所有产物都没有签名**，也没有做 macOS 公证。用户第一次打开要绕过系统拦截：

- **Windows**：SmartScreen 弹「已保护你的电脑」→「更多信息」→「仍要运行」。
- **macOS**：双击会说「已损坏，无法打开」—— 这是隔离属性，不是真损坏。拖进「应用
  程序」后执行
  `xattr -dr com.apple.quarantine /Applications/funread-light.app`，
  或者在「系统设置 → 隐私与安全性」里点「仍要打开」。
- **Linux**：AppImage 要 `chmod +x` 才能跑；deb 用 `sudo apt install ./xxx.deb`。

## 没做的事

- 离线启动 —— 这是 light 版的定义性取舍，要它请装[打包版](../desktop-packaged/README.md)。
- 签名、公证、自动更新（`createUpdaterArtifacts` 是关的）。
- 记住窗口大小和位置。
- 托盘图标、系统级 TTS 之类的原生能力。
