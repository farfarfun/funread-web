import type {
  AccountSummary,
  BookInfo,
  CacheState,
  Chapter,
  ChapterContent,
  CheckProgress,
  CheckUpdatesAccepted,
  CollectReport,
  DownloadAccepted,
  DownloadProgress,
  ExploreKind,
  ExplorePage,
  ExploreSourcePage,
  PoolPage,
  PoolSource,
  RssArticleDetail,
  RssArticlePage,
  RssCategory,
  RssFavorite,
  RssSourcePage,
  ScanReport,
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
  const response = await fetch(`/api/v1${path}${query(params)}`, {
    ...rest,
    headers: { "Content-Type": "application/json", ...rest.headers },
  });
  if (!response.ok) {
    let detail = `请求失败（HTTP ${response.status}）`;
    try {
      const body = await response.json();
      if (typeof body.detail === "string") detail = body.detail;
    } catch {
      // Keep the HTTP fallback when the proxy returns a non-JSON error.
    }
    if (response.status === 401) throw new UnauthorizedError(detail);
    throw new Error(detail);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
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
  pool: (params: { source_type?: SourceType; q?: string; state?: string; limit?: number; offset?: number }) =>
    request<PoolPage>("/pool", { params }),
  patchPoolSource: (
    source_type: SourceType,
    url_id: number,
    payload: { enabled?: boolean; weight?: number; reset_failures?: boolean },
  ) => request<PoolSource>(`/pool/${source_type}/${url_id}`, { method: "PATCH", ...json(payload) }),

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
};
