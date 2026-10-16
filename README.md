# funread-web

[funread-api](https://github.com/farfarfun/funread-api)（依赖 [funread](https://github.com/farfarfun/funread) 核心库）的采集源管理界面。

| 组件 | 默认地址 |
| --- | --- |
| 前端（静态页面 + 内部 API 转发） | `http://127.0.0.1:8811` |
| `funread-api` 后端 | `http://127.0.0.1:18811` |

## 快速开始

```bash
# 终端 A
cd ../funread-api
uv run funread-api server run    # 库地址来自 ~/.farfarfun/funread/config.toml

# 终端 B
cd ../funread-web
pnpm install
pnpm dev
```

浏览器只请求同源 `/api`；Vite 默认转发到 `127.0.0.1:18811`。后端地址不同时，`pnpm dev`
下在 `.env.local` 里设 vite 的构建期变量 `FUNREAD_API_BASE_URL`；生产态服务端
（`funread-web server run`）用 `--backend` 或 config.toml 的 `[server] backend`。页面支持登记、筛选、排序、分页、启停、立即采集、重置刷新时间、
单条/批量删除以及操作队列反馈。

## 移动端：两个 Android 客户端

两套 Capacitor 工程、两个包名，**可以装在同一台手机上对比**。打 `v*` tag 时 CI 会把
两个 debug APK 都传到 [GitHub Release](https://github.com/farfarfun/funread-web/releases)
上，直接下载安装。

| | funread light（`mobile/`） | funread 打包版（`mobile-packaged/`） |
| --- | --- | --- |
| Web 资源 | 不打包，`location.replace` 到用户服务器 | **打进 app** |
| 页面来源 | 用户的服务器 | `http://localhost` |
| 认证 | 同源 cookie 会话 | **`Authorization: Bearer <设备 token>`** |
| 离线启动 | 要网络 | 能 |
| 包名 | `com.farfarfun.funread.light` | `com.farfarfun.funread` |
| 服务端要求 | 任意版本 | 要有 `POST /auth/tokens/issue` |

**light** 只带一个启动页，填完地址就把整个窗口交给那台服务器上的这同一个 `/web`。
页面来源是用户的服务器，`/api` 同源，cookie 会话原样生效 —— **后端一行都不用改**。
代价是启动必须有网络，这是预期行为。

**打包版**把 `dist` 装进 app，于是请求用户服务器成了跨站，cookie 发不出去
（后端 `allow_credentials=False`）。它改用设备 token：首次启动填地址 + 账号口令，
换一条长期凭据存在本机；「我的 → 我的设备」能看到所有设备并单条吊销。

```bash
cd mobile && npm install && npm run sync                    # light
cd mobile-packaged && npm install && npm run build:www && npm run sync   # 打包版
```

细节、踩过的坑、iOS 为什么未经验证，在各自的 README 里：
[mobile/README.md](mobile/README.md)、[mobile-packaged/README.md](mobile-packaged/README.md)。

### Vue 这边怎么区分两种形态

一份源码出两种产物，分界是构建模式：

- `pnpm run build` → `dist/`，给浏览器、也给 light 套壳加载。同源 `/api`，cookie。
- `pnpm run build:packaged` → `dist-packaged/`，打进 app。跨站基址 + Bearer。

判定用的是 `vite build --mode packaged` 注入的构建期常量 `__FUNREAD_PACKAGED__`，
不是运行时探测 —— 这样浏览器那份产物里连 `Authorization` 这个词都不会出现，
浏览器和 light 的行为分毫不变。理由写在
[`src/api/packaged.ts`](src/api/packaged.ts) 顶部，两个方向的断言分别在
`tests/bundle.test.js` 和 CI 的 `android-packaged` job 里。

两套原生工程都不进 npm 包：`package.json` 的 `files` 是白名单
（`bin`/`server`/`dist`），`tests/packaging.test.js` 盯着它别被改坏。

---

## 关于 farfarfun

[farfarfun](https://github.com/farfarfun) 是一个专注于实用工具库的开源组织，
涵盖云存储、数据处理、AI、多媒体与开发工具链等方向。

- 🏠 组织主页：<https://github.com/farfarfun>
- 📧 联系：farfarfun@qq.com

本项目基于 [MIT](LICENSE) 协议开源。
