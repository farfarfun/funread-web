# funread light（Capacitor 套壳移动端）

> 一个只做一件事的壳：打开**你自己那台** funread 服务器上的页面。

funread 是自托管的，没有"官方服务器"可连，所以这个 app 装上之后第一件事是问你
服务器地址（比如 `http://192.168.1.10:8811`）。填完之后它就把整个窗口交给那台
服务器的页面，之后的一切 —— 书架、阅读、离线缓存、登录态 —— 和你在手机浏览器
里打开同一个地址完全一样。

| | |
| --- | --- |
| 包名 | `com.farfarfun.funread.light` |
| 应用名 | funread light |
| 最低 Android | 7.0（API 24） |
| 产物 | CI 的 `funread-light-debug-apk` artifact |

## 为什么是这样做的

### 不打包 Web 资源，直接加载用户服务器

页面来源就是用户自己的服务器，于是 `/api` 是**同源**请求，后端现有的 cookie
会话原样生效 —— **后端一行都不用改**。这是 light 版存在的全部理由。

代价是**启动必须有网络**。这是预期行为，不是待修的缺陷。要离线启动得把 Web 资源
打进包里，那样页面来源变成 `http://localhost`，`/api` 就成了跨源请求，cookie
会话失效，得改用设备 token —— 那一版现在做出来了，在
[`../mobile-packaged/`](../mobile-packaged/README.md)，包名 `com.farfarfun.funread`，
和 light 版两个包名不同，可以装在同一台手机上对比。

### 启动页是本地页面，不是 Capacitor 的 `server.url`

Capacitor 的 `server.url` 是**构建期**配置：它写死在 `capacitor.config.json` 和
原生工程里，运行时改不了。而服务器地址恰恰是每个用户都不一样的东西，构建期根本
不知道。

所以走的是另一条路：`webDir` 里只有一个 `www/index.html` 启动页，拿到用户填的
地址后 `location.replace()` 整窗口跳过去。简单、可靠、地址想改就改。

配套的两个关键配置，少一个都跑不起来：

- `server.allowNavigation: ["*"]` —— 不加的话 Capacitor 会把跳转当外链丢给系统
  浏览器，app 里永远是一片空白。地址由用户现填，构建期没法枚举白名单。
- `server.androidScheme: "http"` —— 默认的 `https://localhost` 下，启动页用
  `fetch` 探活 `http://` 的局域网地址会被当成混合内容拦掉。

### 明文 HTTP

局域网自托管全是 `http://`。Android 从 API 28 起默认拒绝明文流量，WebView 也
照拦，**不处理的话 app 装上就是连不上，报错还只在 logcat 里**。

两处都做了：`AndroidManifest.xml` 里显式写了 `android:usesCleartextTraffic="true"`，
iOS 的 `Info.plist` 里放开了 ATS 的 `NSAllowsArbitraryLoads`。

## 怎么改服务器地址

跳过去之后就脱离本地页面了，所以留了三条路回来：

1. **「我的」→ 切换服务器**。原生那边用 `addJavascriptInterface` 往 WebView 上挂了
   `window.FunreadShell.openSetup()`，Vue 探测到就多显示这一行。只有 Android 有。
2. **在最前面一页按返回键**，弹出的对话框里选「切换服务器」。这条路不依赖服务器上
   funread-web 的版本，服务器再老也有效。
3. **连不上的时候自动回来**。启动时探活失败就停在启动页并说明原因，不会卡在白屏。

启动页会记住最近 5 个地址，家里一个、外网一个，点一下就切。

## 返回键

Capacitor 8 的核心完全不管返回键（那块逻辑在 `@capacitor/app` 插件里，而且只对
带 Capacitor bridge 的本地页面有效），默认行为是直接 finish 掉 Activity ——
翻到第十章按一下返回就退出 app。

现在的行为：WebView 能后退就后退，退到头了弹一个「退出 / 切换服务器 / 取消」。
没有直接退出，是因为跳转用的是 `location.replace`，启动页不在历史里，返回键之外
再没有别的路回到填地址的界面。

## 本地开发

```bash
cd mobile
npm install          # 独立的一套依赖，不挂进根目录的 pnpm workspace
npm run sync         # 把 www/ 和配置同步进原生工程
npm run open:android # 需要本机装了 Android Studio
```

`mobile/` 是一套自带 `package-lock.json` 的独立 npm 工程。不用 pnpm：Capacitor 的
CLI 要顺着 node_modules 走到 `@capacitor/android` 里的原生源码
（`capacitor.settings.gradle` 直接引的就是那个相对路径），pnpm 的符号链接布局在这条
路上历来容易出岔子。

`android/` 里有一批文件按 Capacitor 模板自带的 `.gitignore` 不进版本库
（`app/src/main/assets/public`、`capacitor.config.json`、`capacitor.plugins.json`、
`res/xml/config.xml`、`capacitor-cordova-android-plugins/`），全靠 `cap sync` 生成
—— **跳过这一步 Gradle 连 `settings.gradle` 都读不下去**。

## CI

`.github/workflows/ci.yml` 的 `android` job：`npm ci` → `npx cap sync android` →
`./gradlew assembleDebug`，产物传成 artifact，可以直接下载安装。

**iOS 工程（`mobile/ios/`）未经任何编译验证。** 它是 `cap add ios` 用 SPM 模板
生成的（所以在 Linux 上也能生成、能提交），但跑 iOS 的 CI 要 macos runner，为一个
还没人用的壳不值得。另外 `window.FunreadShell` 是 Android 的
`addJavascriptInterface` 实现的，iOS 上没有对应实现，「我的」里的切换服务器入口
在 iOS 上不会出现 —— iOS 上要改地址，目前只能靠"连不上时自动回启动页"。

## 不在这个版本里的东西

- 离线启动 —— 这是 light 版的定义性取舍，要它请装
  [打包版](../mobile-packaged/README.md)
- 推送、分享、系统级 TTS 之类的原生能力
- release 签名与上架流程（现在只出 debug APK）
