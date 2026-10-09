<script setup lang="ts">
/**
 * C 端外壳：Naive UI 的 provider 加底部 TabBar。
 *
 * 两类页面不要外壳：
 * - `meta.immersive`（正文、文章）—— 全屏阅读，工具栏由页面自己控制；
 * - `meta.bare`（登录、注册）—— 还没有身份，底部导航点进去全是 401。
 */
import type { GlobalThemeOverrides } from "naive-ui";
import { darkTheme, dateZhCN, zhCN } from "naive-ui";
import { computed } from "vue";
import { useRoute } from "vue-router";

import TabBar from "../components/web/TabBar.vue";
import { useTheme } from "../composables/useTheme";

const route = useRoute();
const { dark } = useTheme();
const theme = computed(() => (dark.value ? darkTheme : null));
const showTabs = computed(() => !route.meta.immersive && !route.meta.bare);

const primary = "#6D5EF8";
const themeOverrides: GlobalThemeOverrides = {
  common: {
    primaryColor: primary,
    primaryColorHover: "#7C6FFA",
    primaryColorPressed: "#5B4EE5",
    primaryColorSuppl: "rgba(109, 94, 248, 0.16)",
    borderRadius: "10px",
    borderRadiusSmall: "6px",
    fontFamily:
      "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif",
  },
  Card: { borderRadius: "12px" },
  Button: { borderRadiusMedium: "8px", borderRadiusSmall: "6px", borderRadiusTiny: "6px" },
  Input: { borderRadius: "8px" },
};
</script>

<template>
  <n-config-provider
    :theme="theme"
    :theme-overrides="themeOverrides"
    :locale="zhCN"
    :date-locale="dateZhCN"
  >
    <n-global-style />
    <n-dialog-provider>
      <n-message-provider>
        <div class="web-shell" :class="{ 'web-shell--tabs': showTabs }">
          <RouterView />
        </div>
        <TabBar v-if="showTabs" />
      </n-message-provider>
    </n-dialog-provider>
  </n-config-provider>
</template>

<style scoped>
.web-shell {
  /* dvh 而非 vh：移动浏览器的地址栏会伸缩，vh 会让底部被截掉一截 */
  min-height: 100dvh;
}

.web-shell--tabs {
  /* 给 TabBar 让位，含安全区 */
  padding-bottom: calc(52px + env(safe-area-inset-bottom, 0px));
}
</style>
