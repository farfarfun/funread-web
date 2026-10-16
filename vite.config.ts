import vue from "@vitejs/plugin-vue";
import { NaiveUiResolver } from "unplugin-vue-components/resolvers";
import Components from "unplugin-vue-components/vite";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  //  `vite build --mode packaged` 出的是**打进 Android app 的那一份**：页面来源
  //  变成 http://localhost，`/api` 不再同源，于是基址取自用户填的服务器地址、
  //  凭据换成设备 token。其余所有构建（dev、浏览器、funread light 套壳）这里都是
  //  false，相关代码在构建期整段折掉。
  //
  //  用 `--mode` 而不是环境变量：模式是命令行上的实参，漏传就是显式地在构建另一
  //  个东西；环境变量漏传只会静默出一份「看着正常、装到手机上满屏 404」的包，而
  //  这种错本机没有安卓设备根本发现不了。
  const packaged = mode === "packaged";

  //  同一个变量名也被 server/config.js 读 —— dev 代理和打包后的 CLI 必须指向
  //  同一个后端，否则 `pnpm dev` 能用而 `funread-web server run` 不能，
  //  或者反过来，排查起来极其费时。
  const backend = loadEnv(mode, ".", "").FUNREAD_API_BASE_URL || "http://127.0.0.1:18811";
  const proxy = {
    "/api": { target: backend, changeOrigin: true },
    "/healthz": { target: backend, changeOrigin: true },
  };

  return {
    plugins: [vue(), Components({ resolvers: [NaiveUiResolver()], dts: false })],
    //  字面量替换，不是运行时变量：`if (__FUNREAD_PACKAGED__)` 在非打包版里会变成
    //  `if (false)`，整个分支连同它引到的模块一起被 rollup 删掉。
    define: { __FUNREAD_PACKAGED__: JSON.stringify(packaged) },
    server: { host: "0.0.0.0", port: 8811, strictPort: true, proxy },
    preview: { host: "0.0.0.0", port: 8811, strictPort: true, proxy },
    build: {
      // naive-ui 本身就 ~500kB，拆到独立 vendor chunk 后已经跟业务代码解耦、能长期缓存，
      // 不需要为了消掉警告再继续拆分组件库本身。
      chunkSizeWarningLimit: 600,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes("node_modules")) {
              if (id.includes("naive-ui") || id.includes("@css-render")) return "naive-ui-vendor";
              if (id.includes("vue-router")) return "vue-vendor";
              if (id.includes("/vue/") || id.includes("@vue/")) return "vue-vendor";
              return undefined;
            }
            //  两端分包：手机端打开 /web 不该下载后台那张 800 行的数据表格，
            //  桌面端开 /admin 也不必拖进阅读器和订阅源那一堆视图。
            if (id.includes("/src/views/admin/")) return "admin";
            if (id.includes("/src/views/web/") || id.includes("/src/components/web/")) {
              return "web";
            }
            return undefined;
          },
        },
      },
    },
  };
});
