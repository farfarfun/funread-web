# funread-web

[funread](https://github.com/farfarfun/funread) 的采集源管理界面。

| 组件 | 默认地址 |
| --- | --- |
| 前端（静态页面 + 内部 API 转发） | `http://127.0.0.1:8811` |
| `funread-api` 后端 | `http://127.0.0.1:18811` |

```bash
# 终端 A
cd ../funread
FUNREAD_DATABASE_URL="sqlite:////tmp/funread-dev.db" uv run funread-api

# 终端 B
cd ../funread-web
pnpm install
pnpm dev
```

浏览器只请求同源 `/api`；Vite 默认转发到 `127.0.0.1:18811`。后端地址不同时，设置
`FUNREAD_API_BASE_URL`。页面支持登记、筛选、排序、分页、启停、立即采集、重置刷新时间、
单条/批量删除以及操作队列反馈。
