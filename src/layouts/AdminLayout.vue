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
        <!-- 两页容易混（一个管产出源列表的 URL，一个管采集下来的单个源），
             所以导航上并排放着，而不是藏在各自页里互相跳 -->
        <nav v-if="!$route.meta.bare" class="admin-nav">
          <RouterLink :to="{ name: 'admin-sources' }" class="admin-nav__item">采集源</RouterLink>
          <RouterLink :to="{ name: 'admin-pool' }" class="admin-nav__item">候选源池</RouterLink>
          <a class="admin-nav__item admin-nav__item--out" href="/web">回阅读端 ›</a>
        </nav>
        <RouterView :dark="dark" @toggle-theme="toggle" />
      </n-message-provider>
    </n-dialog-provider>
  </n-config-provider>
</template>

<style scoped>
.admin-nav {
  display: flex;
  gap: var(--space-4);
  align-items: center;
  padding: var(--space-3) var(--space-4);
  border-bottom: 1px solid var(--border-subtle);
}

.admin-nav__item {
  font-size: 14px;
  color: var(--text-muted);
  text-decoration: none;
}

.admin-nav__item.router-link-active {
  font-weight: 600;
  color: var(--accent);
}

.admin-nav__item--out {
  margin-left: auto;
}
</style>
