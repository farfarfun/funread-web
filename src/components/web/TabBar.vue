<script setup lang="ts">
/**
 * 底部 TabBar。固定在视口底部，并把 `env(safe-area-inset-bottom)` 加进内边距
 * —— 否则在带手势条的 iPhone 上，最后一行按钮会被系统条压掉一半。
 */
import {
  LibraryOutline,
  NewspaperOutline,
  PersonOutline,
  SearchOutline,
} from "@vicons/ionicons5";
import { computed } from "vue";
import { useRoute } from "vue-router";

const route = useRoute();

const TABS = [
  { key: "shelf", label: "书架", to: { name: "shelf" }, icon: LibraryOutline },
  { key: "discover", label: "发现", to: { name: "search" }, icon: SearchOutline },
  { key: "rss", label: "订阅", to: { name: "rss" }, icon: NewspaperOutline },
  { key: "account", label: "我的", to: { name: "account" }, icon: PersonOutline },
] as const;

//  用 meta.tab 而不是路由名：详情页（如 /web/book/x）没有自己的 tab，
//  这时四个都不高亮，比错高亮一个要好。
const active = computed(() => route.meta.tab as string | undefined);
</script>

<template>
  <nav class="tab-bar" aria-label="主导航">
    <RouterLink
      v-for="tab in TABS"
      :key="tab.key"
      :to="tab.to"
      class="tab"
      :class="{ 'tab--active': active === tab.key }"
      :aria-current="active === tab.key ? 'page' : undefined"
    >
      <n-icon size="22"><component :is="tab.icon" /></n-icon>
      <span class="tab__label">{{ tab.label }}</span>
    </RouterLink>
  </nav>
</template>

<style scoped>
.tab-bar {
  position: fixed;
  inset-inline: 0;
  bottom: 0;
  z-index: 20;
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  background: var(--surface-raised);
  border-top: 1px solid var(--border-subtle);
  /* 手势条占的那一块也要让出来 */
  padding-bottom: env(safe-area-inset-bottom, 0);
  backdrop-filter: blur(12px);
}

.tab {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  /* 44px 是可点区域的下限，不是装饰 */
  min-height: 52px;
  padding: 6px 0;
  color: var(--text-muted);
  text-decoration: none;
  transition: color 0.15s var(--ease);
}

.tab--active {
  color: var(--accent);
}

.tab__label {
  font-size: 11px;
  line-height: 1.2;
}
</style>
