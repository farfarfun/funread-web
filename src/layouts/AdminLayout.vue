<script setup lang="ts">
/** B 端独立外壳，避免阅读端下载管理表格。 */
import {
  BookOutline,
  CloudUploadOutline,
  LayersOutline,
  MoonOutline,
  PeopleOutline,
  SunnyOutline,
} from "@vicons/ionicons5";
import type { GlobalThemeOverrides } from "naive-ui";
import { darkTheme, dateZhCN, zhCN } from "naive-ui";
import { computed } from "vue";

import { useTheme } from "../composables/useTheme";

const { dark, toggle } = useTheme();
const theme = computed(() => (dark.value ? darkTheme : null));

const primary = "#167A69";
const themeOverrides: GlobalThemeOverrides = {
  common: {
    primaryColor: primary,
    primaryColorHover: "#1B927E",
    primaryColorPressed: "#116557",
    primaryColorSuppl: "rgba(22, 122, 105, 0.14)",
    borderRadius: "8px",
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
        <div v-if="!$route.meta.bare" class="admin-frame">
          <aside class="admin-sidebar">
            <div class="admin-brand"><span class="admin-brand__mark">f</span><span>funread <small>管理</small></span></div>
            <nav class="admin-nav" aria-label="管理导航">
              <RouterLink :to="{ name: 'admin-sources' }" class="admin-nav__item">
                <n-icon size="18"><CloudUploadOutline /></n-icon><span>采集源</span>
              </RouterLink>
              <RouterLink :to="{ name: 'admin-pool' }" class="admin-nav__item">
                <n-icon size="18"><LayersOutline /></n-icon><span>候选源池</span>
              </RouterLink>
              <RouterLink :to="{ name: 'admin-users' }" class="admin-nav__item">
                <n-icon size="18"><PeopleOutline /></n-icon><span>人员</span>
              </RouterLink>
            </nav>
            <div class="admin-sidebar__footer">
              <RouterLink to="/web" class="admin-nav__item"><n-icon size="18"><BookOutline /></n-icon><span>阅读端</span></RouterLink>
              <n-button quaternary circle :aria-label="dark ? '切换到浅色主题' : '切换到深色主题'" @click="toggle">
                <template #icon><n-icon><SunnyOutline v-if="dark" /><MoonOutline v-else /></n-icon></template>
              </n-button>
            </div>
          </aside>
          <div class="admin-content"><RouterView /></div>
        </div>
        <RouterView v-else />
      </n-message-provider>
    </n-dialog-provider>
  </n-config-provider>
</template>

<style scoped>
.admin-frame {
  display: grid;
  grid-template-columns: 220px minmax(0, 1fr);
  min-height: 100dvh;
}

.admin-sidebar {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
  min-height: 100dvh;
  padding: var(--space-5) var(--space-3);
  background: var(--surface-raised);
  border-right: 1px solid var(--border-subtle);
}

.admin-brand {
  display: flex;
  gap: 10px;
  align-items: center;
  padding: 0 var(--space-2);
  font-size: 18px;
  font-weight: 700;
}

.admin-brand small {
  font-size: 12px;
  font-weight: 500;
  color: var(--text-muted);
}

.admin-brand__mark {
  display: grid;
  width: 32px;
  height: 32px;
  place-items: center;
  color: #fff;
  background: #167a69;
  border-radius: 8px;
}

.admin-nav {
  display: grid;
  gap: 4px;
}

.admin-nav__item {
  display: flex;
  gap: 10px;
  align-items: center;
  min-height: 42px;
  padding: 0 12px;
  font-size: 14px;
  color: var(--text-muted);
  text-decoration: none;
  border-radius: 6px;
}

.admin-nav__item.router-link-active,
.admin-nav__item:hover {
  font-weight: 600;
  color: var(--accent);
  background: var(--accent-soft);
}

.admin-sidebar__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: auto;
}

.admin-content {
  width: min(100%, 1480px);
  min-width: 0;
  margin: 0 auto;
  padding: 28px 32px 64px;
}

@media (max-width: 900px) {
  .admin-frame { grid-template-columns: 1fr; grid-template-rows: auto 1fr; }
  .admin-sidebar {
    min-height: 0;
    gap: 8px;
    padding: 12px 16px 0;
    border-right: 0;
    border-bottom: 1px solid var(--border-subtle);
  }
  .admin-brand { padding: 0; }
  .admin-nav { display: flex; overflow-x: auto; }
  .admin-nav__item { flex: none; }
  .admin-sidebar__footer { position: absolute; top: 8px; right: 12px; margin: 0; }
  .admin-sidebar__footer .admin-nav__item { display: none; }
  .admin-content { padding: 20px 16px 48px; }
}
</style>
