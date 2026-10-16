/**
 * 打包版客户端的「连哪台服务器、拿什么凭据」。
 *
 * ## 为什么用构建模式区分形态，而不是运行时探测
 *
 * 判断当前跑在哪种环境，靠的是 `vite build --mode packaged` 注入的常量
 * `__FUNREAD_PACKAGED__`（见 `vite.config.ts` 的 define），不是 `window.Capacitor`
 * 在不在这类运行时特征。三条理由：
 *
 * 1. 运行时探测会把这段代码留在**所有**产物里。浏览器和 funread light 套壳拿到的
 *    是同一份 `dist/`，它们现在靠同源 cookie 工作得好好的 —— 一次探测错判（或者
 *    哪天 Capacitor 改成往远端页面也注入 bridge）就会让它们静默切到 token 模式、
 *    整个登录态崩掉，而这种故障只在真机上才看得见。常量折叠之后那两份产物里连
 *    `Authorization` 这个词都不会出现，`tests/bundle.test.js` 盯着这件事。
 * 2. 两种形态的差别不止认证一处：打包版启动要先过配置页，401 之后回的是配置页
 *    而不是 Web 登录页（那条路在跨站下拿不到 cookie，走不通）。这些是路由层的
 *    分叉，运行时开关意味着路由表得能中途变形。
 * 3. light 版加载的是**远端**页面，Capacitor 的 JS bridge 本来就不会注入到那个源
 *    上，`window.Capacitor` 在那里恰好不存在 —— 运行时探测等于把两套形态的隔离
 *    押在「Capacitor 当前碰巧不做某件事」上。
 *
 * ## 为什么 token 存 localStorage，不用 @capacitor/preferences
 *
 * Preferences 插件写的是原生 SharedPreferences，确实比 WebView 的 localStorage 更
 * 难被清掉一点（「清除缓存」动不了 localStorage，「清除存储」两者一起清，差别只在
 * 极少数厂商 ROM 的清理策略上）。但用它就得在 Vue 源码里 import 一个 Capacitor
 * 包，而这份源码同时要产出发给浏览器的 `dist/`、还要作为 `@farfarfun/funread-web`
 * 发到 npm 上。为打包版往公共依赖里塞 Capacitor，代价大于收益。
 *
 * 更要紧的是：**token 丢了本来就必须能重新走一遍配置**。它会被服务端吊销、会因为
 * 账号停用或换库而失效，这条恢复路径无论如何都得有、而且得好走。既然如此，存储再
 * 结实一档也换不掉任何一条代码路径。
 *
 * 所以这里做的是让「丢了」不疼：**服务器地址单独存一份**，不跟着 token 一起清 ——
 * 重新配置时地址是预填好的，用户只要再输一次口令。
 */

/** 本机这一台设备的凭据。`server` 和 `token` 是一对，换服务器必然要换 token。 */
export interface PackagedSession {
  /** 用户服务器的根地址，形如 `http://192.168.1.10:8811`，末尾不带斜杠。 */
  server: string;
  /** 设备 token 明文。服务端只存 sha256，所以这里是世上唯一的一份。 */
  token: string;
  /** 这条 token 在 `GET /auth/tokens` 里的 id，设备管理页据此标出「当前设备」。 */
  token_id: number;
  username: string;
  device_name: string;
}

const KEY_SESSION = "funread.packaged.session";
const KEY_SERVERS = "funread.packaged.servers";
const MAX_RECENT = 5;

//  读一次就记住。`request()` 每个请求都要它，不值得每次都走一遍
//  localStorage + JSON.parse。`undefined` 表示还没读过，`null` 表示读过、没有。
let cache: PackagedSession | null | undefined;

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    //  隐私模式、存储被禁、或者上一版写坏的 JSON。一律当成「没有」。
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    //  写不进去不该挡住这次使用 —— 本次会话内内存里那份照样生效。
  }
}

export function loadSession(): PackagedSession | null {
  if (cache === undefined) {
    const raw = readJson<Partial<PackagedSession> | null>(KEY_SESSION, null);
    //  只认两个字段都在的记录：半截的会话比没有会话更难排查（基址是空串时
    //  请求会打到 `http://localhost/api/v1`，报的是一个和认证毫无关系的 404）。
    cache =
      raw && typeof raw.server === "string" && raw.server && typeof raw.token === "string" && raw.token
        ? {
            server: raw.server,
            token: raw.token,
            token_id: Number(raw.token_id) || 0,
            username: String(raw.username ?? ""),
            device_name: String(raw.device_name ?? ""),
          }
        : null;
  }
  return cache;
}

export function saveSession(session: PackagedSession): void {
  cache = session;
  writeJson(KEY_SESSION, session);
  rememberServer(session.server);
}

/**
 * 退出 / token 失效。**只清凭据，不清地址** —— 地址在 KEY_SERVERS 里另存一份，
 * 重新配置时还能预填，见本文件顶部。
 */
export function clearSession(): void {
  cache = null;
  try {
    localStorage.removeItem(KEY_SESSION);
  } catch {
    //  清不掉也没办法；内存里那份已经是 null，本次运行不会再带上它。
  }
}

export function recentServers(): string[] {
  const list = readJson<unknown>(KEY_SERVERS, []);
  if (!Array.isArray(list)) return [];
  return list.filter((item): item is string => typeof item === "string" && !!item).slice(0, MAX_RECENT);
}

export function rememberServer(server: string): void {
  writeJson(KEY_SERVERS, [server, ...recentServers().filter((item) => item !== server)].slice(0, MAX_RECENT));
}

export function forgetServer(server: string): void {
  writeJson(KEY_SERVERS, recentServers().filter((item) => item !== server));
}

/**
 * 把人手敲的东西收拾成一个能用的地址。
 *
 * 和 `mobile/www/launcher.js` 里那份是同一套规则（默认补 `http://` 而不是
 * `https://` —— 自建服务基本都是明文；末尾斜杠统一掉，免得「用过的地址」里同一台
 * 服务器出现两条）。两份实现没合并：那边是启动页里不经构建的 ES5 脚本，这边是
 * 进 Vue 包的 TS，为了共用一个二十行的函数牵一条构建依赖不划算。
 */
export function normalizeServer(raw: string): { value?: string; error?: string } {
  let text = (raw || "").trim();
  if (!text) return { error: "先填一个服务器地址。" };
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(text)) text = `http://${text}`;

  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return { error: "这个地址看不懂，正确的样子是 http://192.168.1.10:8811 。" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { error: "只支持 http:// 和 https:// 开头的地址。" };
  }
  if (!url.hostname) {
    return { error: "地址里没有主机名，比如 192.168.1.10 或 read.example.com 。" };
  }
  return { value: url.origin + url.pathname.replace(/\/+$/, "") };
}

/**
 * 猜一个设备名，用户可以改。
 *
 * Android WebView 的 UA 里带机型（`Linux; Android 13; Pixel 7 Build/…; wv`），
 * 取得到就用它 —— 设备管理页上「Pixel 7」比「Android 设备」有用得多。拿不到就
 * 退回一个笼统的名字，不去引 `@capacitor/device`：为一个默认值加一个原生插件，
 * 而这个值本来就让用户改。
 */
export function guessDeviceName(): string {
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent || "";
  const model = /Android\s+[\d.]+;\s*([^;)]+)/.exec(ua)?.[1] ?? "";
  const cleaned = model.replace(/\s+Build\/.*$/i, "").trim();
  if (cleaned && cleaned.toLowerCase() !== "k") return cleaned;
  //  Android 12 起 WebView 默认把机型替换成字面量 "K"（UA reduction），
  //  这种时候机型根本拿不到，别把 "K" 当设备名写进服务端的列表里。
  if (/Android/i.test(ua)) return "Android 设备";
  if (/iPhone|iPad|iPod/i.test(ua)) return "iOS 设备";
  return "funread 客户端";
}
