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
    server: { port: 8811, strictPort: true, proxy },
    preview: { port: 8811, strictPort: true, proxy },
  };
});
