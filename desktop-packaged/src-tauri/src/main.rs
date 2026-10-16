//  Windows 上 release 构建不要再挂一个黑色控制台窗口。
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

//! funread 打包版的桌面壳。
//!
//! 和 `../../mobile-packaged/`（Android 打包版）是同一个形态：Web 资源
//! （`dist-packaged/`）打进 app，启动不用网络；连哪台服务器、用什么凭据，装上之后
//! 在应用里自己填，凭据是一条可吊销的设备 token。
//!
//! 和 Android 那版**唯一**的结构性差别是请求怎么发出去：那边 WebView 的来源是
//! `http://localhost`，正好在后端 CORS 的默认白名单里；桌面这边 Tauri 的来源是
//! `tauri://localhost`（Windows 上 `http://tauri.localhost`），既不在白名单里、
//! 在 WebKit 上发出去的 `Origin` 还是空的，加白名单也救不回来。所以 API 请求改从
//! Rust 这边发 —— 详细理由和取舍写在 `src/fetch-bridge.js` 顶部。
//!
//! Vue 那边一个字都没改：`dist-packaged/` 就是 Android 打包版正在用的同一份产物。

use std::collections::HashMap;
use std::sync::OnceLock;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::menu::{AboutMetadata, IsMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder, Wry};

const MAIN: &str = "main";

/// 注入进页面的 fetch 桥。单独放一个 `.js` 文件而不是写成 Rust 里的字符串字面量，
/// 是为了让 CI 能对它跑 `node --check` —— 这段脚本里写错一个字不会让任何一步构建
/// 失败，只会出一个装上之后每个请求都报错的包，而本机没有桌面环境验证不了。
const FETCH_BRIDGE: &str = include_str!("fetch-bridge.js");

/// 搜索这类接口是**跨源实时聚合**，后端自己就可能跑十几秒（见 `src/api/client.ts`
/// 里 `sourcesFor` 的注释）。默认超时按秒算的话，用户看到的会是一个和服务器
/// 毫无关系的「请求失败」。
const REQUEST_TIMEOUT: Duration = Duration::from_secs(180);

fn client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .timeout(REQUEST_TIMEOUT)
            .user_agent(concat!("funread-desktop/", env!("CARGO_PKG_VERSION")))
            .build()
            //  build() 只在 TLS 初始化失败时出错。退回默认客户端（超时变成无限）
            //  也比让整个 app 起不来强。
            .unwrap_or_default()
    })
}

#[derive(Deserialize)]
struct ProxyRequest {
    url: String,
    method: String,
    /// 浏览器已经按禁止头名单筛过一遍了（`Request.headers` 读出来的就是能发的那些）。
    headers: HashMap<String, String>,
    body: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProxyResponse {
    status: u16,
    status_text: String,
    /// 用数组而不是对象：同名响应头（`Set-Cookie` 之类）会被对象吃掉一条。
    headers: Vec<(String, String)>,
    body: String,
}

/// 代替 WebView 发一次请求。
///
/// 只接 http / https：这个命令虽然只对本地页面开放（远端来源够不着自定义命令，
/// 见 Tauri 的 ACL），但多一道 scheme 检查能挡住「用 `file://` 读本机文件」这类
/// 把它当通用下载器使的用法。
#[tauri::command]
async fn proxy_fetch(request: ProxyRequest) -> Result<ProxyResponse, String> {
    let url = reqwest::Url::parse(&request.url).map_err(|_| format!("地址不对：{}", request.url))?;
    if url.scheme() != "http" && url.scheme() != "https" {
        return Err("只支持 http:// 和 https:// 的地址。".to_string());
    }
    let method = reqwest::Method::from_bytes(request.method.as_bytes())
        .map_err(|_| format!("不认识的请求方法：{}", request.method))?;

    let mut builder = client().request(method, url);
    for (name, value) in &request.headers {
        builder = builder.header(name, value);
    }
    if let Some(body) = request.body {
        builder = builder.body(body);
    }

    let response = builder.send().await.map_err(|err| {
        //  这条文案会被 fetch-bridge.js 包成 TypeError 交回给 `client.ts`，
        //  和「网络挂了」时原生 fetch 的表现一致。
        if err.is_timeout() {
            format!("等了 {} 秒服务器还没回应。", REQUEST_TIMEOUT.as_secs())
        } else if err.is_connect() {
            "连不上这台服务器，看看地址、端口和网络。".to_string()
        } else {
            format!("请求没发出去：{err}")
        }
    })?;

    let status = response.status();
    let headers = response
        .headers()
        .iter()
        //  非 ASCII 的头值在 JS 的 Headers 里本来也放不进去，这里直接丢掉。
        .filter_map(|(name, value)| {
            value
                .to_str()
                .ok()
                .map(|value| (name.as_str().to_string(), value.to_string()))
        })
        .collect();
    let body = response
        .text()
        .await
        .map_err(|err| format!("读不完服务器的回应：{err}"))?;

    Ok(ProxyResponse {
        status: status.as_u16(),
        status_text: status.canonical_reason().unwrap_or("").to_string(),
        headers,
        body,
    })
}

//  版本号从 PackageInfo 取，不是 env!("CARGO_PKG_VERSION")。Cargo.toml 里那个
//  永远是 0.0.0 —— 真正的版本在 tauri.conf.json 的 `version` 里，指向仓库根的
//  package.json。写错的话「关于」框里会显示 0.0.0，而这是用户报问题时唯一能
//  指望他说出来的东西。
fn about_metadata(app: &AppHandle) -> AboutMetadata<'static> {
    AboutMetadata {
        name: Some("funread".into()),
        version: Some(app.package_info().version.to_string()),
        copyright: Some("MIT · farfarfun".into()),
        website: Some("https://github.com/farfarfun/funread-web".into()),
        website_label: Some("项目主页".into()),
        comments: Some(
            "Web 资源打在应用里，启动不用网络。\n\
             连哪台服务器、用什么凭据，在「我的 → 服务器」里改。"
                .into(),
        ),
        ..Default::default()
    }
}

/// 菜单比 light 版少一项「切换服务器」：打包版的页面是本地 SPA，换服务器 / 重新
/// 登录是 Vue 自己的一个路由（`/web/setup`），入口在「我的」里，不需要原生兜底。
fn build_menu(app: &AppHandle) -> tauri::Result<Menu<Wry>> {
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
            Some("关于 funread"),
            Some(about_metadata(app)),
        )?],
    )?;

    let mut items: Vec<&dyn IsMenuItem<Wry>> = Vec::new();

    //  macOS 的全局菜单栏里第一个子菜单就是「应用菜单」，不给的话系统会塞一个
    //  默认的进来，里面的「关于」是空的。
    #[cfg(target_os = "macos")]
    let app_menu = Submenu::with_items(
        app,
        "funread",
        true,
        &[
            &PredefinedMenuItem::about(app, Some("关于 funread"), Some(about_metadata(app)))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::services(app, Some("服务"))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::hide(app, Some("隐藏 funread"))?,
            &PredefinedMenuItem::hide_others(app, Some("隐藏其他"))?,
            &PredefinedMenuItem::show_all(app, Some("全部显示"))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::quit(app, Some("退出 funread"))?,
        ],
    )?;
    #[cfg(target_os = "macos")]
    items.push(&app_menu);

    #[cfg(not(target_os = "macos"))]
    let file = Submenu::with_items(
        app,
        "文件",
        true,
        &[&PredefinedMenuItem::quit(app, Some("退出"))?],
    )?;
    #[cfg(not(target_os = "macos"))]
    items.push(&file);

    items.push(&edit);
    items.push(&view);
    items.push(&help);

    Menu::with_items(app, &items)
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![proxy_fetch])
        .on_menu_event(|app, event| {
            let Some(window) = app.get_webview_window(MAIN) else {
                return;
            };
            match event.id().as_ref() {
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
            //  窗口在这里建而不是在 tauri.conf.json 里声明：配置里没有
            //  initialization script 这一项，而 fetch 桥**必须**在页面自己的脚本
            //  之前就位 —— 晚一步 Vue 已经抓着原生 fetch 了。
            WebviewWindowBuilder::new(app, MAIN, WebviewUrl::App("index.html".into()))
                .title("funread")
                .inner_size(1180.0, 820.0)
                .min_inner_size(420.0, 480.0)
                .center()
                //  阅读器在桌面上没有捏合缩放，Ctrl +/- 是唯一的字号兜底。
                .zoom_hotkeys_enabled(true)
                .initialization_script(FETCH_BRIDGE)
                .build()?;

            let menu = build_menu(app.handle())?;
            //  先建窗口再设菜单：set_menu 在 Windows / Linux 上是把菜单发给**已经
            //  存在**的窗口，顺序反过来这个窗口上就没有菜单栏。
            app.set_menu(menu)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("funread 启动失败");
}
