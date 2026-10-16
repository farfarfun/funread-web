/**
 * funread light 桌面版的启动页。
 *
 * 和 `../../mobile/www/launcher.js` 是同一个形态、同一套归一化规则，但**没有合并**
 * 成一份：
 *
 * - 探活和跳转在这里是两条 Tauri 命令（`probe` / `open`），Android 那边是
 *   `fetch(..., {mode:"no-cors"})` + `location.replace`。换掉的理由写在
 *   `../src-tauri/src/main.rs` 顶部 —— 一句话是三个平台三套 WebView，跨源 fetch
 *   的行为没法在本机验证，而探活失败就等于整个壳用不了。
 * - 「怎么回到这一页」两边不一样：手机上是返回键 + 服务器页面里的入口，桌面上是
 *   原生菜单。文案跟着变。
 * - Android 那份是已经发版的东西，不该为了桌面再动它。
 *
 * 真正共享的只有二十行归一化逻辑，为它牵一条构建依赖不划算 —— 和
 * `../../src/api/packaged.ts` 里 `normalizeServer()` 那段注释是同一个判断。
 */
(function () {
  var KEY_CURRENT = "funread.light.server";
  var KEY_RECENT = "funread.light.servers";
  var MAX_RECENT = 5;

  var form = document.getElementById("form");
  var input = document.getElementById("url");
  var connectBtn = document.getElementById("connect");
  var anywayBtn = document.getElementById("anyway");
  var cancelBtn = document.getElementById("cancel");
  var hint = document.getElementById("hint");
  var recentBox = document.getElementById("recent");
  var recentList = document.getElementById("recentList");

  //  带 setup=1 回来的是「切换服务器」，不能再自动跳走，否则按一次菜单只会原地
  //  弹回当前服务器，永远回不到这一页。
  var setupMode = /[?&]setup=1\b/.test(location.search);

  /** 最近一次探活失败的那个地址，「仍然打开」用它。 */
  var pending = "";

  /**
   * 调一条 Rust 命令。
   *
   * `__TAURI_INTERNALS__` 由 Tauri 在**本地**页面上注入（远端页面拿不到，这正是
   * 我们要的）。它自带排队：IPC 还没就绪时调用会等，不会丢。
   */
  function invoke(cmd, args) {
    var internals = window.__TAURI_INTERNALS__;
    if (!internals || typeof internals.invoke !== "function") {
      return Promise.reject(
        "这个页面不是在 funread light 里打开的，连不上原生那一侧。",
      );
    }
    return internals.invoke(cmd, args);
  }

  function read(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (err) {
      return fallback;
    }
  }

  function write(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (err) {
      /* 存储被禁的话写不进去，但不该挡住这一次连接 */
    }
  }

  function say(text, tone) {
    hint.textContent = text || "";
    if (tone) hint.setAttribute("data-tone", tone);
    else hint.removeAttribute("data-tone");
  }

  /**
   * 把人手敲的东西收拾成一个能用的地址。
   * 用户大多只会敲 `192.168.1.10:8811`，默认补 http:// —— 自建服务基本都是明文
   * HTTP，补 https 反而是错的。
   */
  function normalize(raw) {
    var text = (raw || "").trim();
    if (!text) return { error: "先填一个服务器地址。" };
    if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(text)) text = "http://" + text;

    var url;
    try {
      url = new URL(text);
    } catch (err) {
      return { error: "这个地址看不懂，正确的样子是 http://192.168.1.10:8811 。" };
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return { error: "只支持 http:// 和 https:// 开头的地址。" };
    }
    if (!url.hostname) {
      return { error: "地址里没有主机名，比如 192.168.1.10 或 read.example.com 。" };
    }
    //  末尾斜杠统一掉，免得「用过的地址」里同一台服务器出现两条。
    return { value: url.origin + url.pathname.replace(/\/+$/, "") };
  }

  function remember(target) {
    var list = read(KEY_RECENT, []);
    if (!Array.isArray(list)) list = [];
    list = list.filter(function (item) {
      return item !== target;
    });
    list.unshift(target);
    write(KEY_RECENT, list.slice(0, MAX_RECENT));
    write(KEY_CURRENT, target);
  }

  function busy(on, label) {
    connectBtn.disabled = on;
    connectBtn.textContent = on ? label || "连接中…" : "连接";
  }

  function failed(target, message) {
    pending = target;
    busy(false);
    input.value = target;
    anywayBtn.hidden = false;
    say(String(message), "error");
    renderRecent();
  }

  /** 探活 → 记地址 → 跳转。顺序和 Android 版一致，理由见 main.rs 里 probe 的注释。 */
  function connect(target, options) {
    var silent = options && options.silent;
    anywayBtn.hidden = true;
    busy(true);
    say(silent ? "正在连接 " + target + " …" : "正在确认 " + target + " 能不能连上…");

    invoke("probe", { url: target }).then(
      function () {
        remember(target);
        say("连上了，正在打开…");
        go(target);
      },
      function (err) {
        failed(target, err);
      },
    );
  }

  /** 不探活直接跳。成功的话这个页面马上就被卸载了，所以先把地址记下来。 */
  function go(target) {
    remember(target);
    busy(true, "打开中…");
    invoke("open", { url: target }).catch(function (err) {
      failed(target, err);
    });
  }

  function renderRecent() {
    var list = read(KEY_RECENT, []);
    if (!Array.isArray(list) || !list.length) {
      recentBox.hidden = true;
      recentList.textContent = "";
      return;
    }
    recentBox.hidden = false;
    recentList.textContent = "";
    list.forEach(function (item) {
      var row = document.createElement("div");
      row.className = "recent__item";

      var link = document.createElement("button");
      link.type = "button";
      link.className = "recent__url";
      link.textContent = item;
      link.addEventListener("click", function () {
        input.value = item;
        connect(item);
      });

      var drop = document.createElement("button");
      drop.type = "button";
      drop.className = "recent__drop";
      drop.textContent = "删除";
      drop.addEventListener("click", function () {
        var next = read(KEY_RECENT, []).filter(function (one) {
          return one !== item;
        });
        write(KEY_RECENT, next);
        renderRecent();
      });

      row.appendChild(link);
      row.appendChild(drop);
      recentList.appendChild(row);
    });
  }

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    var result = normalize(input.value);
    if (result.error) {
      say(result.error, "error");
      return;
    }
    connect(result.value);
  });

  anywayBtn.addEventListener("click", function () {
    if (pending) go(pending);
  });

  cancelBtn.addEventListener("click", function () {
    var current = read(KEY_CURRENT, "");
    if (current) go(current);
  });

  input.addEventListener("input", function () {
    anywayBtn.hidden = true;
    if (hint.getAttribute("data-tone") === "error") say("");
  });

  var current = read(KEY_CURRENT, "");
  renderRecent();

  if (setupMode) {
    input.value = current || "";
    cancelBtn.hidden = !current;
    if (current) say("当前连的是 " + current + "。改完点「连接」。");
    input.focus();
  } else if (current) {
    input.value = current;
    connect(current, { silent: true });
  } else {
    input.focus();
  }
})();
