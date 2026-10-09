<script setup lang="ts">
/**
 * B 端外壳。和 C 端分开是为了分包：管理页带着 Naive UI 的 DataTable，
 * 手机端打开 /web 不该下载它。
 *
 * 主题切换按钮仍由 SourcesView 自己渲染（它在页头里），所以这里把 dark 与
 * toggle 透传下去，而不是另起一个顶栏。
 */
import type { GlobalThemeOverrides } from "naive-ui";
import { darkTheme, dateZhCN, zhCN } from "naive-ui";
import { computed } from "vue";

import { useTheme } from "../composables/useTheme";

const { dark, toggle } = useTheme();
const theme = computed(() => (dark.value ? darkTheme : null));

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
  Card: { borderRadius: "8px" },
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
        <RouterView :dark="dark" @toggle-theme="toggle" />
      </n-message-provider>
    </n-dialog-provider>
  </n-config-provider>
</template>
