/**
 * 两端共用一个 SPA，但分别挂在 `/admin` 与 `/web` 下。
 *
 * 两端各自懒加载分包（见 `vite.config.ts` 的 manualChunks）：手机端打开 `/web`
 * 不该顺带下载后台那张 800 行的数据表格和 Naive UI 的 DataTable。
 *
 * 生产态的路由兜底由 `server/serve.js` 负责 —— 它按 base 做 SPA fallback，
 * 并且把 `/api` 与 `/healthz` 排在最前面反代掉，所以这里的路由永远不会被后端
 * 路径撞上。
 */

import type { RouteRecordRaw } from "vue-router";
import { createRouter, createWebHistory } from "vue-router";

import { loadSession } from "../api/packaged";
import { useAuth } from "../composables/useAuth";

const WebLayout = () => import("../layouts/WebLayout.vue");
const AdminLayout = () => import("../layouts/AdminLayout.vue");

const routes: RouteRecordRaw[] = [
  //  根地址给读者，不给管理台。
  { path: "/", redirect: "/web" },

  {
    path: "/web",
    component: WebLayout,
    children: [
      {
        path: "",
        name: "shelf",
        component: () => import("../views/web/ShelfView.vue"),
        meta: { tab: "shelf", title: "书架" },
      },
      {
        //  发现 = 按分类浏览（不知道要什么时）；搜索 = 知道要什么时。
        //  两者后端完全不同（浏览是单源，搜索是跨源 fan-out），所以分两页。
        path: "explore",
        name: "explore",
        component: () => import("../views/web/ExploreView.vue"),
        meta: { tab: "discover", title: "发现" },
      },
      {
        path: "search",
        name: "search",
        component: () => import("../views/web/SearchView.vue"),
        meta: { tab: "discover", title: "搜索" },
      },
      {
        path: "book/:bookKey",
        name: "book",
        component: () => import("../views/web/BookView.vue"),
        meta: { title: "书籍详情" },
      },
      {
        //  正文页沉浸式：不要底部 TabBar，也不要顶栏。
        path: "read/:bookKey",
        name: "read",
        component: () => import("../views/web/ChapterView.vue"),
        meta: { immersive: true, title: "阅读" },
      },
      {
        path: "rss",
        name: "rss",
        component: () => import("../views/web/RssView.vue"),
        meta: { tab: "rss", title: "订阅" },
      },
      {
        path: "rss/favorites",
        name: "rss-favorites",
        component: () => import("../views/web/FavoritesView.vue"),
        meta: { tab: "rss", title: "收藏" },
      },
      {
        path: "rss/history",
        name: "rss-history",
        component: () => import("../views/web/HistoryView.vue"),
        meta: { tab: "rss", title: "阅读历史" },
      },
      {
        path: "rss/sources",
        name: "rss-sources",
        component: () => import("../views/web/RssSourcesView.vue"),
        meta: { title: "订阅源目录" },
      },
      {
        path: "rss/:subId",
        name: "rss-feed",
        component: () => import("../views/web/RssFeedView.vue"),
        meta: { title: "文章列表" },
      },
      {
        path: "rss/:subId/article",
        name: "rss-article",
        component: () => import("../views/web/RssArticleView.vue"),
        meta: { immersive: true, title: "文章" },
      },
      {
        path: "account",
        name: "account",
        component: () => import("../views/web/AccountView.vue"),
        meta: { tab: "account", title: "我的" },
      },
      {
        //  设备 token 的管理。两种形态下都要有：打包版里管的是自己，浏览器里
        //  管的是别处那些 —— 手机丢了的时候，能操作的设备恰恰不是手机。
        path: "devices",
        name: "devices",
        component: () => import("../views/web/DevicesView.vue"),
        meta: { tab: "account", title: "我的设备" },
      },
      {
        path: "login",
        name: "login",
        component: () => import("../views/web/LoginView.vue"),
        meta: { public: true, bare: true, title: "登录" },
      },
      {
        path: "register",
        name: "register",
        component: () => import("../views/web/RegisterView.vue"),
        meta: { public: true, bare: true, title: "注册" },
      },

      //  打包版独有：没有服务器地址 + 设备 token 之前，别的页面一个都打不开。
      //  `__FUNREAD_PACKAGED__` 是构建期字面量，浏览器和 funread light 那两份
      //  产物里这一条连同组件一起在构建期被删掉（`false ? [...] : []`）。
      ...(__FUNREAD_PACKAGED__
        ? ([
            {
              path: "setup",
              name: "packaged-setup",
              component: () => import("../views/packaged/SetupView.vue"),
              meta: { public: true, bare: true, title: "连接服务器" },
            },
          ] as RouteRecordRaw[])
        : []),
    ],
  },

  {
    path: "/admin",
    component: AdminLayout,
    children: [
      { path: "", redirect: "/admin/sources" },
      {
        path: "sources",
        name: "admin-sources",
        component: () => import("../views/admin/SourcesView.vue"),
        meta: { admin: true, title: "采集源管理" },
      },
      {
        //  和 /admin/sources 不是一回事：那一页管产出源列表的 URL，
        //  这一页管采集下来的单个源的可用性与启停。
        path: "pool",
        name: "admin-pool",
        component: () => import("../views/admin/PoolView.vue"),
        meta: { admin: true, title: "候选源池" },
      },
      {
        path: "users",
        name: "admin-users",
        component: () => import("../views/admin/UsersView.vue"),
        meta: { admin: true, title: "人员管理" },
      },
      {
        path: "login",
        name: "admin-login",
        component: () => import("../views/admin/AdminLoginView.vue"),
        meta: { public: true, bare: true, title: "管理端登录" },
      },
    ],
  },

  //  无论什么未知路径都回读者首页，不显示一个空白页。
  { path: "/:pathMatch(.*)*", redirect: "/web" },
];

export const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior(to, from, saved) {
    //  正文页自己管滚动位置（要按 char_offset 恢复），别和路由抢。
    if (to.meta.immersive) return false;
    return saved ?? { top: 0 };
  },
});

router.beforeEach(async (to) => {
  document.title = to.meta.title ? `${to.meta.title} · funread` : "funread";

  //  打包版：没有 (服务器地址, 设备 token) 这一对，任何请求都没地方发 ——
  //  连 `/auth/me` 都会打到 `http://localhost/api/v1` 上变成一个和认证毫无关系
  //  的 404。所以这一条排在 `meta.public` 前面：登录页、注册页在这个形态下同样
  //  打不开（它们靠同源 cookie，跨站根本走不通）。
  if (__FUNREAD_PACKAGED__ && to.name !== "packaged-setup" && !loadSession()) {
    return { name: "packaged-setup", query: { next: to.fullPath } };
  }

  if (to.meta.public) return true;

  const auth = useAuth();
  const state = await auth.ensure();

  //  打包版的凭据是设备 token，不是 cookie 会话。后端给了 Bearer 就不回落
  //  cookie，所以「未登录」只可能是这条 token 不认了（`request()` 已经在 401
  //  时把它清掉了）。该回的是填地址 + 账号的配置页，不是 Web 登录页。
  if (__FUNREAD_PACKAGED__ && !state?.authenticated) {
    return { name: "packaged-setup", query: { next: to.fullPath } };
  }

  if (to.meta.admin) {
    //  管理端认**账号角色**：`state.admin` 现在等价于后端的 `require_reader_admin`，
    //  两边同一个判据，不会出现「界面让进、接口全 403」。
    if (state?.admin) return true;
    //  两种拒绝要分开。没登录的引导去登录，登完会回到这里；已经登录了的再登一次
    //  也还是进不来 —— 那是权限不够，得明说，不能让人在登录页反复试。
    if (state?.authenticated) return { name: "admin-login" };
    return { name: "login", query: { next: to.fullPath } };
  }

  if (state?.authenticated) return true;
  //  没有任何账号且注册开着 → 直接去注册页，省掉一次「登录失败再找注册入口」。
  if (state && !state.authenticated && state.register_open) {
    return { name: "register", query: { next: to.fullPath } };
  }
  return { name: "login", query: { next: to.fullPath } };
});

export default router;
