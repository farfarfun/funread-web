export type SourceType = "book" | "rss";

// ---------------------------------------------------------------- 采集源（B 端）

export interface Source {
  id: number;
  url: string;
  source_type: SourceType;
  source_count: number;
  enabled: boolean;
  consecutive_failures: number;
  last_error: string | null;
  last_success_at: string | null;
  increment_start: number | null;
  increment_stop: number | null;
  last_queried_at: string;
  created_at: string;
  updated_at: string;
}

export interface SourcePage {
  items: Source[];
  total: number;
  limit: number;
  offset: number;
}

export interface CollectReport {
  source_id: number;
  ok: boolean;
  source_count: number;
  error: string | null;
}

export interface ScanReport {
  source_type: SourceType;
  scanned: number;
  complete: number;
  needs_js: number;
  web_view: number;
  enabled: number;
}

// ---------------------------------------------------------------- 账户

export interface SessionState {
  auth_required: boolean;
  admin: boolean;
  reader_public: boolean;
  register_open: boolean;
  authenticated: boolean;
  user_id: number | null;
  username: string | null;
  /** 还没有任何账号、正在用隐式本地身份。前端据此决定要不要引导注册。 */
  local: boolean;
}

export interface AccountSummary {
  users: number;
  register_open: boolean;
  min_password_length: number;
}

// ---------------------------------------------------------------- 小说

export interface SourceRef {
  url_id: number;
  source_name: string;
  book_url: string;
}

export interface SearchBook {
  book_key: string;
  name: string;
  author: string;
  cover_url: string;
  intro: string;
  kind: string;
  word_count: string;
  last_chapter: string;
  sources: SourceRef[];
}

/**
 * 一轮 fan-out 的统计。
 *
 * 没有这组数字时，「搜不到」和「试的源全挂了」在界面上长得一模一样。书源池有
 * 5,606 个可用源而实跑可用率只有个位数百分比，所以「试了 24 个、2 个答了」
 * 是常态，界面必须能把这件事说出来。
 */
export interface SearchStats {
  sources_tried: number;
  sources_ok: number;
  /** 答出了结果的源数。搜索攒够这个数就停。 */
  hits: number;
  /** 需要 JS 而被跳过的源数。结构性不支持，换关键词也没用。 */
  js_skipped: number;
  failed: number;
  /** 搜了几波并发。 */
  waves: number;
  elapsed: number;
  /** 候选池真的搜完了。只有此时「没搜到」才是确定的结论。 */
  exhausted: boolean;
  stopped_by: "enough" | "budget" | "max_sources" | "exhausted" | "empty";
}

export interface SearchPage extends SearchStats {
  items: SearchBook[];
  total: number;
  limit: number;
  offset: number;
}

/** 换源列表里的一项：一个源 + 这本书在该源下的样子。 */
export interface SwitchCandidate extends SourceRef {
  name: string;
  author: string;
  last_chapter: string;
  /** 书名与作者都对得上。为 false 的**不该藏起来** —— 作者名写法差异很常见。 */
  exact: boolean;
  current: boolean;
}

export interface SwitchSourcePage extends SearchStats {
  items: SwitchCandidate[];
  total: number;
  book_key: string;
  name: string;
}

/**
 * 详情响应，同时也是 /toc 与 /content 的入参。
 *
 * **必须整体回传**：规则会在详情页用 `@put` 存变量、在目录/正文页用 `@get` 取。
 * 中途丢掉 `variables`，带变量的源就会静默读到空。
 */
export interface BookInfo {
  name: string;
  author: string;
  book_url: string;
  toc_url: string;
  kind: string;
  word_count: string;
  last_chapter: string;
  intro: string;
  cover_url: string;
  source_url: string;
  source_name: string;
  can_rename: boolean;
  variables: Record<string, string>;
}

export interface Chapter {
  index: number;
  name: string;
  url: string;
  update_time: string;
  is_vip: boolean;
  is_pay: boolean;
  variables: Record<string, string>;
}

export interface TocOut {
  items: Chapter[];
  total: number;
}

export interface ChapterContent {
  title: string;
  text: string;
  url: string;
  next_url: string;
}

// ---------------------------------------------------------------- 书架

export interface Progress {
  chapter_index: number;
  chapter_name: string;
  char_offset: number;
}

export interface ShelfBook {
  book_key: string;
  name: string;
  author: string;
  cover_url: string;
  intro: string;
  url_id: number | null;
  book_url: string;
  toc_url: string;
  last_chapter: string;
  updated_at: string;
  progress: Progress | null;
}

/**
 * 换源后进度落在哪一章。
 *
 * `method` 决定界面该怎么说：
 * - `exact` / `normalized` —— 按章节名定位到了，可以直接接着读；
 * - `position` —— 按比例估的，**必然不准**，要提示用户确认；
 * - `none` —— 新源的目录取不到，进度没动，要手动选章；
 * - `skipped` —— 本来就没有进度可搬。
 */
export interface SwitchSourceResult {
  method: "exact" | "normalized" | "position" | "none" | "skipped";
  chapter_index: number;
  chapter_name: string;
  total: number;
  is_approximate: boolean;
}

export interface DownloadProgress {
  task_id: string;
  state: "running" | "done" | "error";
  total: number;
  done: number;
  failed: number;
  detail: string;
}

export interface DownloadAccepted {
  book_key: string;
  queued: number;
  task_id: string;
}

export interface CacheState {
  book_key: string;
  chapter_indexes: number[];
  downloading: DownloadProgress | null;
}

// ---------------------------------------------------------------- 订阅源

export type SubscriptionKind = "legado" | "feed";

export interface RssSource {
  url_id: number;
  name: string;
  group: string;
  icon: string;
  needs_js: boolean;
  categories: string[];
}

export interface RssSourcePage {
  items: RssSource[];
  total: number;
  limit: number;
  offset: number;
}

export interface Subscription {
  sub_id: string;
  kind: SubscriptionKind;
  url_id: number;
  feed_url: string;
  title: string;
  icon: string;
  group: string;
  last_fetched_at: string;
  /** 上次刷新为什么是空的。界面必须区分「抓取失败」和「没有新内容」。 */
  last_error: string;
  read_count: number;
  preview?: number | null;
}

export interface RssCategory {
  name: string;
  url: string;
}

export interface RssArticle {
  article_key: string;
  title: string;
  link: string;
  pub_date: string;
  description: string;
  image: string;
  read: boolean;
  favorited: boolean;
  variables: Record<string, string>;
}

export interface RssArticlePage {
  items: RssArticle[];
  /** 回传给 `next_url` 取下一页。空串 = 没有了。 */
  next_url: string;
  category: string;
  /** false 表示这个源没有正文规则，界面该外跳浏览器而不是给空白阅读器。 */
  has_content: boolean;
}

export interface RssArticleDetail {
  article_key: string;
  title: string;
  link: string;
  pub_date: string;
  description: string;
  image: string;
  content_html: string;
}

export interface RssFavorite {
  sub_id: string;
  article_key: string;
  title: string;
  link: string;
  pub_date: string;
  image: string;
  read: boolean;
}
