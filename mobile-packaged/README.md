# funread（打包版 Capacitor 客户端）

> Web 资源打进 app，启动不用网络；连哪台服务器、用什么凭据，装上之后自己填。

和 `../mobile/`（funread light）是**两个独立的 Capacitor 工程、两个包名**，可以装在
同一台手机上对比：

| | funread light（`../mobile/`） | funread 打包版（这里） |
| --- | --- | --- |
| Web 资源 | 不打包，`location.replace` 到用户服务器 | **打进 app** |
| 页面来源 | 用户的服务器 | `http://localhost` |
| 认证 | 同源 cookie 会话 | **`Authorization: Bearer <设备 token>`** |
| 离线启动 | 要网络（启动页探活） | 能，进去之后才需要网 |
| 包名 | `com.farfarfun.funread.light` | `com.farfarfun.funread` |
| 应用名 | funread light | funread |
| 最低 Android | 7.0（API 24） | 7.0（API 24） |
| 产物 | CI 的 `funread-light-debug-apk` | CI 的 `funread-packaged-debug-apk` |

打 `v*` tag 时两个 APK 都会传到 GitHub Release 上，可以直接下载安装。

## 它怎么工作

### `www/` 不在版本库里

webDir 就是 Vue 那套 SPA 的构建产物，由仓库根的 `pnpm run build:packaged` 生成
（`dist-packaged/`）再拷过来。light 版的 `www/` 是一个手写的启动页所以进版本库，
这边进了只会让每改一行 Vue 代码就多出一整套带 hash 的资源文件。

```bash
cd mobile-packaged
npm install
npm run build:www    # 根目录构建打包版 dist 再拷进 www/
npm run sync         # cap sync android
npm run open:android # 需要本机装了 Android Studio
```

**跳过 `build:www` 的话 `cap sync` 直接报 webDir 不存在。**

### 认证：Bearer，不是 cookie

页面来源变成 `http://localhost` 之后，请求用户自己的服务器就是**跨站**。后端的 CORS
是 `allow_credentials=False`（故意的），cookie 既发不出去也存不下来 —— 所以这版必须
用设备 token：

1. 首次启动停在 `/web/setup`，填服务器地址 + 账号口令；
2. 客户端调 `POST /api/v1/auth/tokens/issue`（这个端点**不需要会话**，就是为这一步加
   的）换一条长期 token；
3. 之后每个请求带 `Authorization: Bearer <token>`。

后端收到 Bearer 就**不回落 cookie**，所以 401 只有一个含义：这条 token 不认了。客户端
据此清掉本地凭据并退回配置页，见 `../src/api/client.ts`。

token 存在 WebView 的 localStorage 里，服务器地址**单独存**、不跟着一起清 —— 理由和
为什么不用 `@capacitor/preferences`，写在 `../src/api/packaged.ts` 顶部。

### `androidScheme: "http"`

不是默认的 `https`。两条理由，缺一条都走不通：

- 默认的 `https://localhost` 是安全上下文，从那里 `fetch` 一个 `http://` 的局域网地址
  会被当成混合内容拦掉 —— 而自建 funread 基本全是明文 http。
- `http://localhost` 正好是后端 CORS 默认放行的三个来源之一
  （`capacitor://localhost` / `ionic://localhost` / `http://localhost`），自托管的人
  不用为了装客户端先去改 config.toml。

### 明文 HTTP

和 light 版一样在 `AndroidManifest.xml` 里显式写了
`android:usesCleartextTraffic="true"`。API 28 起明文流量默认被
NetworkSecurityPolicy 挡掉，不开这一项 app 装上就是连不上，报错还只在 logcat 里。

### 路由用 history 模式，没改成 hash

Capacitor 的本地资源服务默认开着 `html5mode`：请求路径的最后一段不带 `.` 时一律回
`index.html`（见 `WebViewLocalServer.handleLocalRequest`）。所以 `/web`、
`/web/account`、`/admin/pool` 这些路径在 app 里能直接打开，Vue 那边不用为打包版切一套
hash 路由 —— 两种形态共用同一份路由表。

### 没有 `window.FunreadShell`

light 版用 `addJavascriptInterface` 往 WebView 上挂了一个「回到启动页」的原生入口，
因为它加载的是远端页面、Vue 够不着原生。打包版的页面来源是本地，「换服务器 / 重新
登录」就是 Vue 自己的一个路由（`/web/setup`），不需要这个接口，于是也没有那片对所有
来源可见的攻击面。

### 返回键

和 light 版同一套：WebView 能后退就后退，退到头 `finish()`。SPA 的 `pushState` 条目在
WebView 的前进后退列表里，所以「返回」就是回上一页。不弹 light 版那个「退出 / 切换
服务器」对话框 —— 打包版的切换入口在「我的」里，不用返回键兜底。

## CI

`.github/workflows/ci.yml` 的 `android-packaged` job：

```
pnpm install → pnpm run build:packaged → 拷进 www/ → npm ci → cap sync android → assembleDebug
```

比 light 版那条多了前两步（Web 构建是出包的前置条件），也多一条断言：构建完之后 grep
产物里有没有 `Authorization`。**漏掉 `--mode packaged` 不会让任何一步失败**，只会出一个
装上去满屏 404 的 APK，而本机没有安卓设备、CI 也不跑真机 —— 那一行 grep 是唯一拦得住
它的东西。反方向的断言在 `../tests/bundle.test.js`：浏览器那份构建里不许出现任何打包版
的痕迹。

## 没做的事

- **没有 iOS 工程。** light 版那边有一个（`cap add ios` 在 Linux 上也能生成），但从没编
  译过。这边连生成都没做：两个未经验证的 iOS 工程不比一个更有用。
- **release 签名与上架。** 现在只出 debug APK。
- **推送、系统级 TTS 之类的原生能力。**
- `android/` 里有一批文件按 Capacitor 模板自带的 `.gitignore` 不进版本库
  （`app/src/main/assets/public`、`capacitor.config.json`、`capacitor.plugins.json`、
  `res/xml/config.xml`、`capacitor-cordova-android-plugins/`），全靠 `cap sync` 生成 ——
  **跳过那一步 Gradle 连 `settings.gradle` 都读不下去。**
