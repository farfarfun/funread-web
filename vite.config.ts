import { defineConfig, loadEnv } from "vite";
import vue from "@vitejs/plugin-vue";
import Components from "unplugin-vue-components/vite";
import { NaiveUiResolver } from "unplugin-vue-components/resolvers";

export default defineConfig(({ mode }) => {
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
          manualChunks: {
            "vue-vendor": ["vue"],
            "naive-ui-vendor": ["naive-ui"],
          },
        },
      },
    },
  };
});
