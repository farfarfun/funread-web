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

---

## 关于 farfarfun

[farfarfun](https://github.com/farfarfun) 是一个专注于实用工具库的开源组织，
涵盖云存储、数据处理、AI、多媒体与开发工具链等方向。

- 🏠 组织主页：<https://github.com/farfarfun>
- 📧 联系：farfarfun@qq.com

本项目基于 [MIT](LICENSE) 协议开源。
