/**
 * 把 `window.fetch` 里打到用户服务器的那部分请求改从 Rust 发出去。
 *
 * 这个文件由 `main.rs` 用 `include_str!` 读进来，作为窗口的 initialization script
 * 注入 —— 它在页面自己的任何脚本之前执行，所以 Vue 拿到的 `fetch` 已经是换过的。
 *
 * ## 为什么必须换掉
 *
 * 打包版的页面来源是 Tauri 的本地协议：macOS / Linux 上是 `tauri://localhost`，
 * Windows 上是 `http://tauri.localhost`。请求用户自己的服务器因此是**跨站**，
 * WebView 照常走 CORS —— 而 funread-api 的 `allow_origins` 是一个写死的三元组
 * （`capacitor://localhost` / `ionic://localhost` / `http://localhost`），没有正则、
 * 没有通配。
 *
 * 更要命的是 `tauri://` 这种非 http 的自定义协议：WebKit 把它当不透明来源，发出去
 * 的 `Origin` 头在服务端那边收到的是空的（Tauri #2327）。也就是说**即便**让用户去
 * 改 `config.toml` 把 `tauri://localhost` 加进白名单，Linux 和 macOS 上也匹配不上
 * —— 而 Linux 恰恰是这个客户端的主力平台。
 *
 * Rust 这边发请求根本不在浏览器的 CORS 模型里，三个平台行为一致，用户的服务器一行
 * 配置都不用改。顺带也绕开了 Chromium 的 Private Network Access：Windows 上
 * WebView2 是 Chromium，从一个 `.localhost` 来源打 `192.168.x.x` 将来随时可能被
 * 它拦下来。
 *
 * ## 为什么不改 Vue 那边
 *
 * `dist-packaged/` 是 Android 打包版正在用的同一份产物，已经发版了。为了桌面在
 * 公共源码里引一个 Tauri 包（或者加一条运行时分叉），代价会落到浏览器和 Android
 * 两份产物上 —— 和 `src/api/packaged.ts` 顶部拒绝引 `@capacitor/preferences` 是同
 * 一个判断。换 `fetch` 是纯壳层的事，Vue 一个字都不用动。
 *
 * ## 边界
 *
 * - 只接管**绝对的 http / https** 地址。相对路径、本地资源、`data:` 一律走原生，
 *   否则连页面自己的 JS/CSS 都得绕一圈。
 * - 响应体按文本处理。funread 的 API 全是 JSON；封面图走的是 `<img src>`，图片是
 *   跨源白名单之外的「可嵌入」资源，根本不经过 fetch，也就不受这条限制。
 * - 不带 cookie。打包版的凭据本来就是 `Authorization: Bearer <设备 token>`，
 *   后端的 `allow_credentials=False` 也不接受 cookie。
 */
;(function () {
  //  注入脚本在每次文档加载时都会跑一遍。重复包一层会让每个请求多绕一跳，
  //  而且第二层会把第一层当成「原生 fetch」，出错时堆栈完全读不懂。
  if (window.__FUNREAD_FETCH_BRIDGE__) return;
  window.__FUNREAD_FETCH_BRIDGE__ = true;

  var nativeFetch = window.fetch.bind(window);

  function invoke(payload) {
    var internals = window.__TAURI_INTERNALS__;
    if (!internals || typeof internals.invoke !== "function") {
      return Promise.reject(new Error("funread 客户端的原生接口不可用。"));
    }
    return internals.invoke("proxy_fetch", { request: payload });
  }

  window.fetch = function (input, init) {
    var request;
    try {
      //  用 Request 把 (url | Request, init) 的各种写法统一成一个对象：地址、
      //  方法、请求头、请求体的归一化规则全交给 WebView 自己，我们不去猜。
      request = new Request(input, init);
    } catch (err) {
      return nativeFetch(input, init);
    }

    var url = request.url;
    if (!/^https?:\/\//i.test(url)) return nativeFetch(input, init);
    //  Windows 上页面来源本身就是 http://tauri.localhost，那些是本地资源。
    if (url.indexOf(location.origin + "/") === 0) return nativeFetch(input, init);

    var headers = {};
    request.headers.forEach(function (value, name) {
      headers[name] = value;
    });

    //  GET / HEAD 不可能有请求体，读它只会白白起一个 Promise。
    var body =
      request.method === "GET" || request.method === "HEAD"
        ? Promise.resolve(null)
        : request.text();

    return body
      .then(function (text) {
        return invoke({
          url: url,
          method: request.method,
          headers: headers,
          body: text,
        });
      })
      .then(function (result) {
        var responseHeaders = new Headers();
        result.headers.forEach(function (pair) {
          try {
            responseHeaders.append(pair[0], pair[1]);
          } catch (err) {
            /* 禁止由脚本设置的响应头，跳过就是了 */
          }
        });
        //  这三个状态码在 Response 构造函数里必须是空体，给了内容会直接抛。
        //  `request()` 里的 204 分支正好会走到这儿。
        var empty = result.status === 204 || result.status === 205 || result.status === 304;
        return new Response(empty ? null : result.body, {
          status: result.status,
          statusText: result.statusText,
          headers: responseHeaders,
        });
      })
      .catch(function (err) {
        //  Rust 那边的错误是字符串。包成 TypeError 之后，调用方拿到的东西和
        //  「网络挂了」时的原生 fetch 一模一样 —— `client.ts` 的 catch 分支据此
        //  给出那段「挨个看一眼」的排查文案，不用为桌面再加一条分支。
        throw new TypeError(typeof err === "string" ? err : String((err && err.message) || err));
      });
  };
})();
