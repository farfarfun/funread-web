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
  if (to.meta.public) return true;

  const auth = useAuth();
  const state = await auth.ensure();

  if (to.meta.admin) {
    //  管理端认的是单口令那套 session，读者账号不算。
    if (state?.admin) return true;
    return { name: "admin-login", query: { next: to.fullPath } };
  }

  if (state?.authenticated) return true;
  //  没有任何账号且注册开着 → 直接去注册页，省掉一次「登录失败再找注册入口」。
  if (state && !state.authenticated && state.register_open) {
    return { name: "register", query: { next: to.fullPath } };
  }
  return { name: "login", query: { next: to.fullPath } };
});

export default router;
