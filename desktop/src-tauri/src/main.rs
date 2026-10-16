//  Windows 上 release 构建不要再挂一个黑色控制台窗口。
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

//! funread light 的桌面壳。
//!
//! 和 `../../mobile/`（Android light）是同一个形态：不打包任何 Web 资源，启动页
//! 问一个服务器地址，然后把整个窗口交给那台服务器上的页面。页面来源因此就是用户
//! 自己的服务器，`/api` 是同源请求，cookie 会话原样生效，后端一行都不用改。
//!
//! ## 为什么地址不写在 tauri.conf.json 里
//!
//! `build.frontendDist` / `build.devUrl` 和 Capacitor 的 `server.url` 一样是**构建期**
//! 配置：它在编译时就被 `tauri::generate_context!()` 固化进二进制，运行时改不了。
//! 而服务器地址恰恰是每个用户都不一样、构建期根本不知道的东西。
//!
//! 所以走的是和 Android 版同一条路：`frontendDist` 里只有一个 `www/index.html`
//! 启动页，拿到地址之后由 Rust 这边 `WebviewWindow::navigate()` 整窗口跳过去。
//!
//! ## 为什么探活放在 Rust 里
//!
//! Android 那版的启动页用 `fetch(..., { mode: "no-cors" })` 探活。桌面这边三个平台
//! 是三套 WebView（WebKitGTK / WebView2 / WKWebView），页面来源又是
//! `tauri://localhost` 这种非 http 的自定义协议 —— 跨源 `fetch` 在这些组合下的行为
//! 我没法在本机验证。而探活失败就等于「永远连不上」，是这个壳唯一的关键路径。
//!
//! Rust 这边连一个 TCP 都不经过 WebView，三个平台行为完全一致，而且能分清
//! 「域名解析不了」「连接被拒绝」「超时」—— 这正好就是用户要看的那三种错误。
//! 代价是它只验证「那个 host:port 上有人在听」，不验证对面是不是 funread；
//! 真连上之后页面自己会说话，而且启动页上还留了一个「仍然打开」。

use std::net::{TcpStream, ToSocketAddrs};
use std::time::Duration;

use tauri::menu::{AboutMetadata, IsMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Manager, Url, WebviewUrl, WebviewWindowBuilder, Wry};

const MAIN: &str = "main";

//  和 Android 启动页里的 PROBE_TIMEOUT 取同一个值：局域网里连得上的服务器远不到
//  一秒，超过这个数基本就是这台机器和服务器压根不在一个网络里。
const PROBE_TIMEOUT: Duration = Duration::from_secs(8);

/// 启动页在 WebView 里的地址。
///
/// 跳到用户服务器之后本地页面就不在历史里了（和 Android 版一样用的是「替换」而不是
/// 「压栈」），菜单里的「切换服务器」要能回来，就得记住这个地址。
struct Home(Url);

/// 打包后页面的来源。Windows 上是 `http://tauri.localhost`，其余平台是自定义协议
/// `tauri://localhost` —— 这是 Tauri 自己的规则，不是我们选的。
///
/// 正常情况下 `WebviewWindow::url()` 直接给出它，这里只是兜底：历史上 Windows 有过
/// 「窗口刚建好时 url() 还是 about:blank」的缺陷，真撞上的话「切换服务器」会变成一个
/// 死菜单项，而那是这个壳里最要紧的入口。
fn fallback_home() -> Url {
    let raw = if cfg!(windows) {
        "http://tauri.localhost/index.html"
    } else {
        "tauri://localhost/index.html"
    };
    //  常量字面量，parse 不可能失败。
    Url::parse(raw).expect("内置的启动页地址应当总是能解析")
}

/// 探活：只看 `host:port` 上有没有人在听。
///
/// 不发 HTTP 请求 —— 一个 TCP 握手就能区分开用户真正会遇到的三种失败，而且不用
/// 为此往三个平台的构建里拖一棵 HTTP 客户端 + TLS 的依赖树。
fn probe_blocking(raw: &str) -> Result<(), String> {
    let url = Url::parse(raw)
        .map_err(|_| "这个地址看不懂，正确的样子是 http://192.168.1.10:8811 。".to_string())?;
    let host = url
        .host_str()
        .ok_or_else(|| "地址里没有主机名，比如 192.168.1.10 或 read.example.com 。".to_string())?
        .to_string();
    let port = url
        .port_or_known_default()
        .ok_or_else(|| "这个地址没有端口，也猜不出默认端口。".to_string())?;

    //  DNS 解析和 connect 都是阻塞调用，所以这个函数只在 spawn_blocking 里跑
    //  （见下面的 probe 命令）。放在命令线程上会把界面卡住最多 8 秒。
    let addrs: Vec<_> = (host.as_str(), port)
        .to_socket_addrs()
        .map_err(|_| {
            format!(
                "解析不了主机名 {host}。挨个看一眼：\n\
                 · 名字拼对了吗（局域网里更稳妥的是直接填 IP）\n\
                 · 这台机器的 DNS / hosts 认得这个名字吗"
            )
        })?
        .collect();
    if addrs.is_empty() {
        return Err(format!("{host} 解析不出任何地址。"));
    }

    let mut last = String::new();
    for addr in &addrs {
        match TcpStream::connect_timeout(addr, PROBE_TIMEOUT) {
            Ok(_) => return Ok(()),
            Err(err) => last = err.to_string(),
        }
    }

    Err(format!(
        "连不上 {host}:{port}（{last}）。挨个看一眼：\n\
         · 服务器上的 funread-web 在跑吗\n\
         · 端口对吗（funread-web 默认 8811，funread-api 默认 18811，两个都行）\n\
         · 这台机器和服务器在同一个局域网 / 能走到同一个公网地址吗\n\
         · 服务器那边的防火墙放行这个端口了吗"
    ))
}

/// 探活。成功时什么都不做 —— 跳转是启动页随后单独发起的。
///
/// 探活和跳转刻意分成两条命令：跳转一旦开始，启动页的 JS 就随时可能被卸载，
/// 「把这个地址记进用过的列表」这种收尾动作在那之后不保证还能跑完。分开之后
/// 启动页的顺序是「探活 → 记地址 → 跳转」，和 Android 版那份完全一致。
#[tauri::command]
async fn probe(url: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || probe_blocking(&url))
        .await
        .map_err(|_| "探活任务意外退出了，重试一次看看。".to_string())?
}

/// 把整个窗口交给这个地址。
///
/// 启动页在探活失败时也会把这条路露出来（「仍然打开」）。留这个口子是因为探活
/// 毕竟是一个**近似**判断：有人会把 funread 挂在只认 HTTP 请求、不接受裸 TCP
/// 探测的网关后面。探活错判的代价是整个 app 用不了，而多一个按钮的代价只是多一
/// 个按钮。
#[tauri::command]
fn open(app: AppHandle, url: String) -> Result<(), String> {
    let target = Url::parse(&url)
        .map_err(|_| "这个地址看不懂，正确的样子是 http://192.168.1.10:8811 。".to_string())?;
    if target.scheme() != "http" && target.scheme() != "https" {
        return Err("只支持 http:// 和 https:// 开头的地址。".to_string());
    }
    let window = app
        .get_webview_window(MAIN)
        .ok_or_else(|| "主窗口已经关掉了。".to_string())?;
    window
        .navigate(target)
        .map_err(|err| format!("打不开这个地址：{err}"))
}

//  版本号从 PackageInfo 取，不是 env!("CARGO_PKG_VERSION")。Cargo.toml 里那个
//  永远是 0.0.0 —— 真正的版本在 tauri.conf.json 的 `version` 里，指向仓库根的
//  package.json。写错的话「关于」框里会显示 0.0.0，而这是用户报问题时唯一能
//  指望他说出来的东西。
fn about_metadata(app: &AppHandle) -> AboutMetadata<'static> {
    AboutMetadata {
        name: Some("funread light".into()),
        version: Some(app.package_info().version.to_string()),
        copyright: Some("MIT · farfarfun".into()),
        website: Some("https://github.com/farfarfun/funread-web".into()),
        website_label: Some("项目主页".into()),
        comments: Some(
            "只做一件事的壳：打开你自己那台 funread 服务器上的页面。\n\
             Web 资源不打包在这里，页面和登录态都来自你的服务器。"
                .into(),
        ),
        ..Default::default()
    }
}

/// 菜单是这个壳在「跳到远端页面之后」唯一还属于我们自己的界面。
///
/// Android 版把「切换服务器」用 `addJavascriptInterface` 挂成了
/// `window.FunreadShell`，代价是那个接口对**所有**加载进来的来源都可见。桌面上不
/// 需要这条路：原生菜单在窗口外面，远端页面既看不见也碰不着它。
fn build_menu(app: &AppHandle) -> tauri::Result<Menu<Wry>> {
    let switch = MenuItem::with_id(
        app,
        "switch-server",
        "切换服务器…",
        true,
        Some("CmdOrCtrl+Shift+S"),
    )?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = PredefinedMenuItem::quit(app, Some("退出"))?;

    let mut file_items: Vec<&dyn IsMenuItem<Wry>> = vec![&switch];
    //  macOS 上退出归 app 菜单，再在「文件」里放一个是多余的。
    if !cfg!(target_os = "macos") {
        file_items.push(&separator);
        file_items.push(&quit);
    }
    let file = Submenu::with_items(app, "文件", true, &file_items)?;

    //  macOS 的 WKWebView 不自带剪贴板快捷键：没有这个「编辑」菜单，Cmd+C / Cmd+V
    //  在页面里按下去没有任何反应。Windows / Linux 上它只是顺带提供了鼠标入口。
    let edit = Submenu::with_items(
        app,
        "编辑",
        true,
        &[
            &PredefinedMenuItem::undo(app, Some("撤销"))?,
            &PredefinedMenuItem::redo(app, Some("重做"))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, Some("剪切"))?,
            &PredefinedMenuItem::copy(app, Some("复制"))?,
            &PredefinedMenuItem::paste(app, Some("粘贴"))?,
            &PredefinedMenuItem::select_all(app, Some("全选"))?,
        ],
    )?;

    let view = Submenu::with_items(
        app,
        "视图",
        true,
        &[
            &MenuItem::with_id(app, "back", "后退", true, Some("Alt+ArrowLeft"))?,
            &MenuItem::with_id(app, "forward", "前进", true, Some("Alt+ArrowRight"))?,
            &MenuItem::with_id(app, "reload", "重新加载", true, Some("CmdOrCtrl+R"))?,
        ],
    )?;

    let help = Submenu::with_items(
        app,
        "帮助",
        true,
        &[&PredefinedMenuItem::about(
            app,
            Some("关于 funread light"),
            Some(about_metadata(app)),
        )?],
    )?;

    let mut items: Vec<&dyn IsMenuItem<Wry>> = Vec::new();

    //  macOS 的全局菜单栏里第一个子菜单就是「应用菜单」，不给的话系统会塞一个
    //  默认的进来，里面的「关于」是空的。
    #[cfg(target_os = "macos")]
    let app_menu = Submenu::with_items(
        app,
        "funread light",
        true,
        &[
            &PredefinedMenuItem::about(app, Some("关于 funread light"), Some(about_metadata(app)))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::services(app, Some("服务"))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::hide(app, Some("隐藏 funread light"))?,
            &PredefinedMenuItem::hide_others(app, Some("隐藏其他"))?,
            &PredefinedMenuItem::show_all(app, Some("全部显示"))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::quit(app, Some("退出 funread light"))?,
        ],
    )?;
    #[cfg(target_os = "macos")]
    items.push(&app_menu);

    items.push(&file);
    items.push(&edit);
    items.push(&view);
    items.push(&help);

    Menu::with_items(app, &items)
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![probe, open])
        .on_menu_event(|app, event| {
            let Some(window) = app.get_webview_window(MAIN) else {
                return;
            };
            match event.id().as_ref() {
                "switch-server" => {
                    let mut url = app.state::<Home>().0.clone();
                    //  带 setup=1 回去的是「改地址」：启动页看到它就不再自动跳走，
                    //  否则按一次这个菜单只会原地弹回当前服务器。
                    url.set_query(Some("setup=1"));
                    let _ = window.navigate(url);
                }
                //  下面三条都用 eval 而不是原生 API：此刻窗口里多半是**远端**页面，
                //  Tauri 的窗口 API 管不到它的历史栈，而 eval 注入的脚本在任何来源的
                //  页面里都照常执行。
                "back" => {
                    let _ = window.eval("history.back()");
                }
                "forward" => {
                    let _ = window.eval("history.forward()");
                }
                "reload" => {
                    let _ = window.eval("location.reload()");
                }
                _ => {}
            }
        })
        .setup(|app| {
            //  窗口在这里建，不在 tauri.conf.json 里：建完要立刻把它的地址记下来
            //  （见 Home），配置里声明的窗口在 setup 之前就建好了，拿地址要多绕一圈。
            let window = WebviewWindowBuilder::new(app, MAIN, WebviewUrl::App("index.html".into()))
                .title("funread light")
                .inner_size(1180.0, 820.0)
                .min_inner_size(420.0, 480.0)
                .center()
                .build()?;

            let home = window
                .url()
                .ok()
                .filter(|url| url.host_str().is_some() && url.scheme() != "about")
                .unwrap_or_else(fallback_home);
            app.manage(Home(home));

            let menu = build_menu(app.handle())?;
            //  先建窗口再设菜单：set_menu 在 Windows / Linux 上是把菜单发给**已经
            //  存在**的窗口，顺序反过来这个窗口上就没有菜单栏。
            app.set_menu(menu)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("funread light 启动失败");
}
