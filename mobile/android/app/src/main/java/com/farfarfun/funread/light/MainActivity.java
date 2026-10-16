package com.farfarfun.funread.light;

import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import androidx.appcompat.app.AlertDialog;
import com.getcapacitor.BridgeActivity;

/**
 * funread light 的唯一 Activity。
 *
 * 和普通 Capacitor 应用不一样的地方在于：WebView 里装的不是打包进来的资源，而是
 * 用户自己那台服务器上的页面（启动页拿到地址后整窗口跳过去）。于是有两件事必须
 * 在原生这边做，JS 那边够不着：
 *
 * 1. 返回键。Capacitor 8 的核心已经完全不管返回键了（那块逻辑在 @capacitor/app
 *    插件里，而且只对带 Capacitor bridge 的本地页面有效），默认行为是直接 finish
 *    掉 Activity —— 翻了十章书按一下返回就退出，不能忍。
 * 2. 回到启动页的入口。跳到用户服务器之后页面来源已经是远端，Capacitor 的 JS
 *    bridge 不会注入到那个源上，所以得靠 addJavascriptInterface：它挂在 WebView
 *    上，对所有源都可见。
 */
public class MainActivity extends BridgeActivity {

    /** 带上 setup=1，启动页就知道这次是回来改地址的，不要再自动跳走。 */
    private static final String SETUP_PATH = "/index.html?setup=1";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        //  WebView 组件缺失时 BridgeActivity 会换一个提示布局并提前返回，
        //  这时候没有 bridge，照常往下跑就是 NPE。
        WebView webView = getBridge() == null ? null : getBridge().getWebView();
        if (webView == null) {
            return;
        }

        //  暴露给页面的只有「回到启动页」这一个动作，读不到任何数据、改不了任何
        //  状态。即使用户的服务器被人塞了脚本，最多也只能把 app 弹回填地址的界面。
        //
        //  注入发生在 super.onCreate() 之后，也就是启动页那次 loadUrl 已经发出去
        //  之后 —— 按 WebView 的约定，注入的对象要等下一次页面加载才可见。这里
        //  正好不影响：启动页自己不用它，而用户服务器的页面必然是下一次加载。
        webView.addJavascriptInterface(new ShellBridge(), "FunreadShell");

        //  后注册的回调先收到事件，所以这里能稳稳盖住父类（如果将来它又加回
        //  自己的返回键处理）。
        getOnBackPressedDispatcher()
            .addCallback(
                this,
                new OnBackPressedCallback(true) {
                    @Override
                    public void handleOnBackPressed() {
                        WebView current = getBridge() == null ? null : getBridge().getWebView();
                        if (current != null && current.canGoBack()) {
                            current.goBack();
                            return;
                        }
                        confirmExit();
                    }
                }
            );
    }

    /**
     * 已经退无可退了。
     *
     * 这里没有直接 finish，是因为跳到用户服务器用的是 location.replace，启动页
     * 不留在历史里 —— 返回键之外再没有别的路能回到填地址的界面。服务器连得上、
     * 但用户想换一台（家里一个地址、外网一个地址）的时候，这是唯一一个不依赖
     * 服务器端 funread-web 版本的入口。多按一次换一个不会走死的出口，值。
     */
    private void confirmExit() {
        new AlertDialog.Builder(this)
            .setTitle("退出 funread light？")
            .setMessage("已经是最前面一页了。想换一台服务器的话，从这里进。")
            .setPositiveButton("退出", (dialog, which) -> finish())
            .setNeutralButton("切换服务器", (dialog, which) -> openSetup())
            .setNegativeButton("取消", null)
            .show();
    }

    /** 把 WebView 拉回本地启动页。getLocalUrl() 就是 Capacitor 本地资源服务的根。 */
    private void openSetup() {
        if (getBridge() == null) {
            return;
        }
        final WebView webView = getBridge().getWebView();
        final String target = getBridge().getLocalUrl() + SETUP_PATH;
        //  @JavascriptInterface 的方法跑在 WebView 的 JS 线程上，loadUrl 必须
        //  回到主线程。
        webView.post(() -> webView.loadUrl(target));
    }

    /** 挂在 window.FunreadShell 上，给 Vue 那边的「切换服务器」用。 */
    public class ShellBridge {

        @JavascriptInterface
        public void openSetup() {
            MainActivity.this.openSetup();
        }
    }
}
