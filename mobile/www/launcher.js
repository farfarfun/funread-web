/**
 * funread light 的启动页。
 *
 * 这一版刻意不打包 Web 资源：Capacitor 只带这一个本地页面，拿到用户填的
 * 服务器地址后整窗口跳过去（location.replace）。页面来源因此就是用户自己的
 * 服务器，/api 是同源请求，后端的 cookie 会话原样生效，后端一行都不用改。
 *
 * 为什么不用 Capacitor 的 server.url：那是构建期配置，写进 capacitor.config
 * 和原生工程里，运行时改不了 —— 而服务器地址恰恰是每个用户都不一样的。
 */
(function () {
  var KEY_CURRENT = "funread.light.server";
  var KEY_RECENT = "funread.light.servers";
  var PROBE_TIMEOUT = 8000;

  var form = document.getElementById("form");
  var input = document.getElementById("url");
  var connectBtn = document.getElementById("connect");
  var cancelBtn = document.getElementById("cancel");
  var hint = document.getElementById("hint");
  var recentBox = document.getElementById("recent");
  var recentList = document.getElementById("recentList");

  //  带 setup=1 回来的是「改地址」，不能再自动跳走，否则永远回不到这一页。
  var setupMode = /[?&]setup=1\b/.test(location.search);

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
      /* 隐私模式下写不进去也不该挡住连接 */
    }
  }

  function say(text, tone) {
    hint.textContent = text || "";
    if (tone) hint.setAttribute("data-tone", tone);
    else hint.removeAttribute("data-tone");
  }

  /**
   * 把人手敲的东西收拾成一个能用的地址。
   * 用户大多只会敲 `192.168.1.10:8811`，默认补 http:// —— 自建服务基本都是
   * 明文 HTTP，补 https 反而是错的。
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
    if (!url.hostname) return { error: "地址里没有主机名，比如 192.168.1.10 或 read.example.com 。" };
    //  末尾斜杠统一掉，免得「用过的地址」里同一台服务器出现两条。
    var value = url.origin + url.pathname.replace(/\/+$/, "");
    return { value: value };
  }

  /**
   * 探活。跨源拿不到响应内容（服务器不会给我们发 CORS 头），所以用 no-cors：
   * 它读不出状态码，但「有没有人应答」这一件事是准的，而填错地址、服务器没开
   * 恰好就是这一类错误。
   */
  function probe(target) {
    var controller = typeof AbortController === "function" ? new AbortController() : null;
    var timer = setTimeout(function () {
      if (controller) controller.abort();
    }, PROBE_TIMEOUT);

    return fetch(target + "/", {
      method: "GET",
      mode: "no-cors",
      cache: "no-store",
      signal: controller ? controller.signal : undefined,
    })
      .then(function () {
        clearTimeout(timer);
        return true;
      })
      .catch(function (err) {
        clearTimeout(timer);
        throw err;
      });
  }

  function failureText(target, err) {
    var aborted = err && (err.name === "AbortError" || /abort/i.test(String(err.message || "")));
    var host = target;
    try {
      host = new URL(target).host;
    } catch (ignored) {
      /* 用原文兜底 */
    }
    if (aborted) {
      return (
        "连 " + host + " 超过 8 秒没反应。\n" +
        "多半是手机和服务器不在同一个网络里（比如手机还在用流量），或者地址里的 IP 已经变了。"
      );
    }
    return (
      "连不上 " + host + "。挨个看一眼：\n" +
      "· 服务器上的 funread-web 在跑吗\n" +
      "· 端口对吗（默认 8811，不是后端的 18811）\n" +
      "· 手机和服务器在同一个局域网 / 能走到同一个公网地址吗"
    );
  }

  function remember(target) {
    var list = read(KEY_RECENT, []);
    if (!Array.isArray(list)) list = [];
    list = list.filter(function (item) {
      return item !== target;
    });
    list.unshift(target);
    write(KEY_RECENT, list.slice(0, 5));
    write(KEY_CURRENT, target);
  }

  function go(target) {
    //  replace 而不是 assign：启动页不该留在历史里，否则用户在服务器首页
    //  按一次返回就莫名其妙回到了填地址的界面。要回来有专门的入口。
    location.replace(target + "/");
  }

  function connect(target, options) {
    var silent = options && options.silent;
    connectBtn.disabled = true;
    connectBtn.textContent = "连接中…";
    say(silent ? "正在连接 " + target + " …" : "正在确认 " + target + " 能不能连上…");

    probe(target)
      .then(function () {
        remember(target);
        say("连上了，正在打开…");
        go(target);
      })
      .catch(function (err) {
        connectBtn.disabled = false;
        connectBtn.textContent = "连接";
        input.value = target;
        say(failureText(target, err), "error");
        renderRecent();
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

  cancelBtn.addEventListener("click", function () {
    var current = read(KEY_CURRENT, "");
    if (current) go(current);
  });

  input.addEventListener("input", function () {
    if (hint.getAttribute("data-tone") === "error") say("");
  });

  var current = read(KEY_CURRENT, "");
  renderRecent();

  if (setupMode) {
    input.value = current || "";
    cancelBtn.hidden = !current;
    if (current) say("当前连的是 " + current + "。改完点「连接」。");
    //  自动聚焦会顶起软键盘挡住「用过的地址」，让用户自己点。
  } else if (current) {
    input.value = current;
    connect(current, { silent: true });
  }
})();
