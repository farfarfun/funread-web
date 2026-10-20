import { clearSession, loadSession } from "./packaged";
import type {
  AccountSummary,
  BookInfo,
  CacheState,
  Chapter,
  ChapterContent,
  CheckProgress,
  CheckUpdatesAccepted,
  CollectReport,
  DeviceToken,
  DeviceTokenCreated,
  DownloadAccepted,
  DownloadProgress,
  ExploreKind,
  ExplorePage,
  ExploreSourcePage,
  ManagedUser,
  PoolPage,
  PoolOptimizeResult,
  PoolRules,
  PoolSource,
  RssArticleDetail,
  RssArticlePage,
  RssCategory,
  RssFavorite,
  RssHistoryItem,
  RssSourcePage,
  ScanReport,
  SourceTestAccepted,
  SourceTestProgress,
  SearchPage,
  SessionState,
  ShelfBook,
  ShelfGroup,
  Source,
  SourcePage,
  SourceRef,
  SourceType,
  Subscription,
  SwitchCandidate,
  SwitchSourcePage,
  SwitchSourceResult,
  TocOut,
  OpmlExport,
  OpmlImportResult,
} from "./types";

type Params = Record<string, string | number | boolean | null | undefined>;

/** 后端返回 401 时抛这个，路由守卫据此跳登录页而不是弹一个看不懂的报错。 */
export class UnauthorizedError extends Error {
  constructor(message = "需要登录") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

function query(params?: Params): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value !== null && value !== undefined && value !== "") search.set(key, String(value));
  }
  const value = search.toString();
  return value ? `?${value}` : "";
}

async function request<T>(path: string, init?: RequestInit & { params?: Params }): Promise<T> {
  const { params, ...rest } = init ?? {};
  //  打包版把 Web 资源打进了 app，页面来源是 `http://localhost`，请求用户自己的
  //  服务器属于**跨站** —— cookie 发不出去（后端 `allow_credentials=False`），
  //  所以基址来自用户填的地址、凭据是设备 token。
  //
  //  `__FUNREAD_PACKAGED__` 是构建期常量：浏览器和 funread light 那两份产物里它
  //  是字面量 false，下面整段折回原来的同源 `/api/v1` 和原来那个请求头，一个
  //  字节都不多。为什么是构建期而不是运行时探测，见 `./packaged.ts`。
  const session = __FUNREAD_PACKAGED__ ? loadSession() : null;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (session) headers.Authorization = `Bearer ${session.token}`;
  const response = await fetch(`${session ? session.server : ""}/api/v1${path}${query(params)}`, {
    ...rest,
    headers: { ...headers, ...rest.headers },
  });
  if (!response.ok) {
    let detail = `请求失败（HTTP ${response.status}）`;
    try {
      const body = await response.json();
      if (typeof body.detail === "string") detail = body.detail;
    } catch {
      // Keep the HTTP fallback when the proxy returns a non-JSON error.
    }
    if (response.status === 401) {
      //  后端收到 Bearer 之后**不回落 cookie**，所以打包版的 401 只有一个含义：
      //  这条 token 不认了（被吊销、账号停用、或者服务器换了库）。留着它只会让
      //  接下来每个页面各撞一次 401，直接丢掉 —— 路由守卫会把人带回配置页。
      if (__FUNREAD_PACKAGED__) clearSession();
      throw new UnauthorizedError(detail);
    }
    throw new Error(detail);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

/**
 * 用账号口令直接换一条设备 token（后端的 `POST /auth/tokens/issue`）。
 * **只有打包版的首次配置会走这里。**
 *
 * 不复用 `request()`：那条路的基址和凭据都取自已经存下的会话，而这一刻两者都还
 * 不存在 —— 服务器地址是用户刚敲进表单的。顺带也绕开了「401 就清掉本地 token」
 * 那条规则：这里的 401 是「口令不对」，不是「token 失效」。
 */
export async function issueDeviceToken(payload: {
  server: string;
  username: string;
  password: string;
  device_name: string;
}): Promise<DeviceTokenCreated> {
  const { server, ...body } = payload;
  let response: Response;
  try {
    response = await fetch(`${server}/api/v1/auth/tokens/issue`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    //  fetch 只在网络层失败时抛，而跨站请求被 CORS 挡掉在浏览器里也长这样 ——
    //  两种都是「这台服务器没按预期应答」，给一条能照着排查的文案。
    throw new Error(
      `连不上 ${server}。挨个看一眼：\n` +
        "· 服务器上的 funread 在跑吗\n" +
        "· 端口对吗（funread-web 默认 8811，funread-api 默认 18811，两个都行）\n" +
        "· 手机和服务器在同一个网络里吗",
    );
  }
  if (response.status === 401) throw new UnauthorizedError("账号或口令不对。");
  if (response.status === 404) {
    throw new Error(
      `${server} 上没有 /api/v1/auth/tokens/issue。\n` +
        "要么这个地址不是 funread，要么服务端太旧 —— 设备 token 是后加的，升级 funread-api 再试。",
    );
  }
  if (!response.ok) {
    let detail = `签发失败（HTTP ${response.status}）`;
    try {
      const parsed = await response.json();
      if (typeof parsed.detail === "string") detail = parsed.detail;
    } catch {
      // 非 JSON 的错误（比如反代给的 502 页面）保留 HTTP 兜底。
    }
    throw new Error(detail);
  }
  return response.json() as Promise<DeviceTokenCreated>;
}

const json = (body: unknown): RequestInit => ({ body: JSON.stringify(body) });

export const api = {
  // -------------------------------------------------------------- 采集源（B 端）
  listSources: (params: Params) => request<SourcePage>("/sources", { params }),
  supportedSourceTypes: () => request<SourceType[]>("/sources/supported"),
  createSource: (url: string) =>
    request<Source>("/sources", { method: "POST", ...json({ url }) }),
  updateSource: (id: number, enabled: boolean) =>
    request<Source>(`/sources/${id}`, { method: "PATCH", ...json({ enabled }) }),
  deleteSource: (id: number) => request<void>(`/sources/${id}`, { method: "DELETE" }),
  resetSourceCursor: (id: number) =>
    request<void>(`/sources/${id}/reset-cursor`, { method: "POST" }),
  collectSource: (id: number) =>
    request<CollectReport>(`/sources/${id}/collect`, { method: "POST" }),

  // -------------------------------------------------------------- 账户
  me: () => request<SessionState>("/auth/me"),
  accounts: () => request<AccountSummary>("/auth/accounts"),
  login: (username: string, password: string) =>
    request<SessionState>("/auth/login", { method: "POST", ...json({ username, password }) }),
  register: (username: string, password: string, code: string) =>
    request<SessionState>("/auth/register", {
      method: "POST",
      ...json({ username, password, code }),
    }),
  adminLogin: (password: string) =>
    request<SessionState>("/auth/admin/login", { method: "POST", ...json({ password }) }),
  logout: () => request<void>("/auth/logout", { method: "POST" }),

  //  设备 token。浏览器里靠 cookie 会话、打包版里靠自己那条 Bearer，后端两种都
  //  认，所以这一页在两种形态下都是活的 —— 手机丢了可以在电脑上吊销。
  devices: () => request<DeviceToken[]>("/auth/tokens"),
  revokeDevice: (token_id: number) =>
    request<void>(`/auth/tokens/${token_id}`, { method: "DELETE" }),

  //  人员管理。两个端点都要 ADMIN 身份，普通读者拿到的是 403。
  users: () => request<ManagedUser[]>("/auth/users"),
  updateUser: (user_id: number, patch: { role?: string; is_active?: boolean }) =>
    request<ManagedUser>(`/auth/users/${user_id}`, { method: "PATCH", ...json(patch) }),

  // -------------------------------------------------------------- 小说
  search: (params: { keyword: string; limit?: number; offset?: number; max_sources?: number }) =>
    request<SearchPage>("/reader/search", { params }),
  bookInfo: (params: { url_id: number; book_url: string; name?: string; author?: string }) =>
    request<BookInfo>("/reader/book", { params }),
  //  POST，不是 GET：引擎需要整个 BookInfo（含 variables）才能继续往下走。
  toc: (url_id: number, book: BookInfo) =>
    request<TocOut>("/reader/toc", { method: "POST", ...json({ url_id, book }) }),
  content: (payload: {
    url_id: number;
    chapter: Chapter;
    book?: BookInfo | null;
    book_key?: string;
  }) => request<ChapterContent>("/reader/content", { method: "POST", ...json(payload) }),
  //  这是一次**实时聚合搜索**，不是查库 —— 书架只记了当前在读的源。所以它慢
    //  （可能十几秒），而且返回搜索统计让界面能解释空列表。
    sourcesFor: (book_key: string) =>
    request<SwitchSourcePage>("/reader/sources", { params: { book_key } }),
  scan: (source_type: SourceType = "book", limit?: number) =>
    request<ScanReport>("/reader/scan", { method: "POST", params: { source_type, limit } }),

  // -------------------------------------------------------------- 发现页
  exploreSources: (params: { q?: string; limit?: number; offset?: number }) =>
    request<ExploreSourcePage>("/reader/explore/sources", { params }),
  exploreKinds: (url_id: number) =>
    request<ExploreKind[]>("/reader/explore/kinds", { params: { url_id } }),
  //  `url` 是 exploreKinds 给的不透明令牌，原样回传。
  explore: (params: { url_id: number; url: string; page?: number }) =>
    request<ExplorePage>("/reader/explore", { params }),

  // -------------------------------------------------------------- 候选源池（B 端）
  pool: (params: { source_type?: SourceType; q?: string; state?: string; sort?: string; limit?: number; offset?: number }) =>
    request<PoolPage>("/pool", { params }),
  patchPoolSource: (
    source_type: SourceType,
    url_id: number,
    payload: { enabled?: boolean; weight?: number; reset_failures?: boolean },
  ) => request<PoolSource>(`/pool/${source_type}/${url_id}`, { method: "PATCH", ...json(payload) }),
  poolRules: (source_type: SourceType, url_id: number) =>
    request<PoolRules>(`/pool/${source_type}/${url_id}/rules`),
  savePoolRules: (source_type: SourceType, url_id: number, rules: Record<string, unknown>, updated_at: string) =>
    request<PoolRules>(`/pool/${source_type}/${url_id}/rules`, { method: "PUT", ...json({ rules, updated_at }) }),
  optimizePoolRss: (url_id: number) =>
    request<PoolOptimizeResult>(`/pool/rss/${url_id}/optimize`, { method: "POST" }),
  patchPoolSources: (source_type: SourceType, url_ids: number[], enabled: boolean) =>
    request<{ updated: number }>(`/pool/batch/${source_type}`, {
      method: "PATCH",
      ...json({ url_ids, enabled }),
    }),
  patchPoolByLatestTest: (source_type: SourceType, outcome: "success" | "failure") =>
    request<{ updated: number }>(`/pool/batch/${source_type}/latest-test/${outcome}`, { method: "PATCH" }),

  //  批量测试。202 立刻返回，进度轮询 testProgress。
  testSources: (payload: { source_type?: SourceType; limit?: number; untested_only?: boolean; url_ids?: number[] }) =>
    request<SourceTestAccepted>("/pool/test", { method: "POST", ...json(payload) }),
  testAllSources: (source_type: SourceType) =>
    request<SourceTestAccepted>("/pool/test/all", { method: "POST", params: { source_type } }),
  testProgress: (task_id: string) => request<SourceTestProgress>(`/pool/test/${task_id}`),
  clearTestQueue: () => request<{ cancelled: number }>("/pool/test/queue", { method: "DELETE" }),
  resetScores: (source_type: SourceType, url_id?: number) =>
    request<{ reset: number }>(`/pool/test/${source_type}/scores`, {
      method: "DELETE",
      params: url_id === undefined ? {} : { url_id },
    }),

  // -------------------------------------------------------------- 书架
  //  `group` 不传 = 整个书架，传空串 = 只看未分组的 —— 这两者在后端是不同的查询。
  //  所以这里**不能**走 `params`：`query()` 会把空串当成「没传」丢掉（对 `q`、
  //  `title` 这些是对的），那样「未分组」就永远筛不出来。自己拼一次。
  shelf: (group?: string) =>
    request<ShelfBook[]>(
      group === undefined ? "/shelf" : `/shelf?group=${encodeURIComponent(group)}`,
    ),
  shelfGroups: () => request<ShelfGroup[]>("/shelf/groups"),
  assignShelfGroup: (book_keys: string[], group: string) =>
    request<{ affected: number }>("/shelf/groups/assign", {
      method: "POST",
      ...json({ book_keys, group }),
    }),
  renameShelfGroup: (old: string, next: string) =>
    request<{ affected: number }>("/shelf/groups/rename", {
      method: "POST",
      ...json({ old, new: next }),
    }),
  //  202 + task_id：一本书要两个请求，几十本就是几分钟，撑不过请求超时。
  checkShelfUpdates: (book_keys?: string[], interval = 1) =>
    request<CheckUpdatesAccepted>("/shelf/check-updates", {
      method: "POST",
      ...json({ book_keys: book_keys ?? null, interval }),
    }),
  checkUpdatesProgress: (task_id: string) =>
    request<CheckProgress>(`/shelf/check-updates/${task_id}`),
  addToShelf: (payload: Record<string, unknown>) =>
    request<{ book_key: string }>("/shelf", { method: "POST", ...json(payload) }),
  removeFromShelf: (book_key: string) =>
    request<void>(`/shelf/${book_key}`, { method: "DELETE" }),
  saveProgress: (
    book_key: string,
    payload: {
      chapter_index: number;
      chapter_url?: string;
      chapter_name?: string;
      char_offset?: number;
    },
  ) => request<void>(`/shelf/${book_key}/progress`, { method: "PUT", ...json(payload) }),
  //  返回进度被重新定位到了哪一章，以及定位方式 —— 界面要据此决定是「接着读」
  //  还是「提示可能有偏差」。
  switchSource: (book_key: string, url_id: number, book_url: string, remap_progress = true) =>
    request<SwitchSourceResult>(`/shelf/${book_key}/source`, {
      method: "POST",
      ...json({ url_id, book_url, remap_progress }),
    }),
  download: (book_key: string, url_id: number, chapters: Chapter[], interval = 0.5) =>
    request<DownloadAccepted>(`/shelf/${book_key}/download`, {
      method: "POST",
      ...json({ url_id, chapters, interval }),
    }),
  downloadProgress: (book_key: string, task_id: string) =>
    request<DownloadProgress>(`/shelf/${book_key}/download/${task_id}`),
  cached: (book_key: string) => request<CacheState>(`/shelf/${book_key}/cached`),
  clearCache: (book_key: string) =>
    request<CacheState>(`/shelf/${book_key}/cached`, { method: "DELETE" }),

  // -------------------------------------------------------------- 订阅源
  rssSources: (params: { q?: string; limit?: number; offset?: number }) =>
    request<RssSourcePage>("/rss/sources", { params }),
  subscriptions: () => request<Subscription[]>("/rss/subscriptions"),
  subscribeLegado: (url_id: number, title = "") =>
    request<Subscription>("/rss/subscriptions", {
      method: "POST",
      ...json({ kind: "legado", url_id, title }),
    }),
  subscribeFeed: (feed_url: string, title = "") =>
    request<Subscription>("/rss/subscriptions", {
      method: "POST",
      ...json({ kind: "feed", feed_url, title }),
    }),
  unsubscribe: (sub_id: string) =>
    request<void>(`/rss/subscriptions/${sub_id}`, { method: "DELETE" }),
  importOpml: (opml: string) =>
    request<OpmlImportResult>("/rss/subscriptions/import", { method: "POST", ...json({ opml }) }),
  exportOpml: () => request<OpmlExport>("/rss/subscriptions/export"),
  rssCategories: (sub_id: string) =>
    request<RssCategory[]>(`/rss/subscriptions/${sub_id}/categories`),
  rssArticles: (params: {
    sub_id: string;
    category?: string;
    next_url?: string;
    page?: number;
    limit?: number;
  }) => request<RssArticlePage>("/rss/articles", { params }),
  //  variables 必须回传：规则会在列表页 @put、在正文页 @get。丢掉它，
  //  用这个模式的源会静默读到空正文。JSON 编码塞进 query —— 这是个 GET，
  //  要保持 URL 可链接（刷新能回到同一篇）。
  rssArticle: (params: {
    sub_id: string;
    link: string;
    title?: string;
    variables?: Record<string, string>;
  }) => {
    const { variables, ...rest } = params;
    return request<RssArticleDetail>("/rss/article", {
      params: {
        ...rest,
        variables:
          variables && Object.keys(variables).length ? JSON.stringify(variables) : undefined,
      },
    });
  },
  markRead: (
    sub_id: string,
    article_key: string,
    read: boolean,
    meta: Partial<RssFavorite> = {},
  ) =>
    request<void>(`/rss/subscriptions/${sub_id}/articles/${article_key}/read`, {
      method: "PUT",
      ...json({ read, ...meta }),
    }),
  markFavorite: (
    sub_id: string,
    article_key: string,
    favorited: boolean,
    meta: Partial<RssFavorite> = {},
  ) =>
    request<void>(`/rss/subscriptions/${sub_id}/articles/${article_key}/favorite`, {
      method: "PUT",
      ...json({ favorited, ...meta }),
    }),
  readAll: (sub_id: string, article_keys: string[]) =>
    request<{ changed: number }>(`/rss/subscriptions/${sub_id}/read-all`, {
      method: "PUT",
      ...json({ article_keys }),
    }),
  favorites: (sub_id = "") => request<RssFavorite[]>("/rss/favorites", { params: { sub_id } }),
  history: (limit = 100) => request<RssHistoryItem[]>("/rss/history", { params: { limit } }),
};
