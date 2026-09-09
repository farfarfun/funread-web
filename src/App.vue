<script setup lang="ts">
import type { GlobalThemeOverrides } from "naive-ui";
import { darkTheme, dateZhCN, zhCN } from "naive-ui";
import { computed, ref, watchEffect } from "vue";

import SourcesView from "./views/SourcesView.vue";

const storedTheme = localStorage.getItem("funread.theme");
const dark = ref(storedTheme ? storedTheme === "dark" : true);
const theme = computed(() => (dark.value ? darkTheme : null));

watchEffect(() => document.documentElement.classList.toggle("dark", dark.value));

function toggleTheme() {
  dark.value = !dark.value;
  localStorage.setItem("funread.theme", dark.value ? "dark" : "light");
}

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
        <SourcesView :dark="dark" @toggle-theme="toggleTheme" />
      </n-message-provider>
    </n-dialog-provider>
  </n-config-provider>
</template>
