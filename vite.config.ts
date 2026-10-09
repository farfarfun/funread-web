import vue from "@vitejs/plugin-vue";
import { NaiveUiResolver } from "unplugin-vue-components/resolvers";
import Components from "unplugin-vue-components/vite";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
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
