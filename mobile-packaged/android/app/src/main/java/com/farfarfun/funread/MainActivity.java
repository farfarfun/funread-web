package com.farfarfun.funread;

import android.os.Bundle;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.BridgeActivity;

/**
 * funread 打包版的唯一 Activity。
 *
 * 和 light 版（com.farfarfun.funread.light）的差别只在 WebView 里装的是什么：
 * 那边是一个填地址的启动页、然后整窗口跳到用户的服务器；这边 Web 资源就打在
 * assets/public 里，页面常驻 http://localhost，只有 API 请求出网。
 *
 * 于是 light 版那个 addJavascriptInterface 挂出来的 window.FunreadShell 这边不
 * 需要：页面来源是本地，「换服务器」「重新登录」都是 Vue 自己的一个路由
 * （/web/setup），不用从原生这边开门。少一个对所有来源可见的 JS 接口，
 * 少一片攻击面。
 *
 * 剩下唯一必须在原生做的事是返回键。
 */
public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        //  WebView 组件缺失时 BridgeActivity 会换一个提示布局并提前返回，
        //  这时候没有 bridge，照常往下跑就是 NPE。
        if (getBridge() == null || getBridge().getWebView() == null) {
            return;
        }

        //  Capacitor 8 的核心完全不管返回键（那块逻辑在 @capacitor/app 插件里），
        //  默认行为是直接 finish 掉 Activity —— 从书架点进一本书、再点进一章，
        //  按一下返回就退出整个 app。
        //
        //  SPA 的路由跳转走的是 history.pushState，WebView 的前进后退列表认这些
        //  条目，所以 canGoBack()/goBack() 就是「回上一页」。退到第一页再按才真
        //  退出 —— 这里不像 light 版那样弹「切换服务器」的对话框：打包版那个入口
        //  在「我的」里，不需要返回键兜底。
        getOnBackPressedDispatcher()
            .addCallback(
                this,
                //  后注册的回调先收到事件，所以这个能稳稳盖住父类的（如果将来
                //  Capacitor 又加回自己的返回键处理）。
                new OnBackPressedCallback(true) {
                    @Override
                    public void handleOnBackPressed() {
                        WebView webView = getBridge() == null ? null : getBridge().getWebView();
                        if (webView != null && webView.canGoBack()) {
                            webView.goBack();
                            return;
                        }
                        finish();
                    }
                }
            );
    }
}
