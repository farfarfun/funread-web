<script setup lang="ts">
/**
 * 桌面侧栏。宽屏上替代底部 TabBar。
 *
 * 为什么不是「底栏在宽屏上也凑合用」：底部导航是移动端惯例，因为那里是拇指能
 * 到的地方。桌面上没有拇指，而一条横跨 2560px 的底栏既不合常规，也把四个目标
 * 推到彼此极远的位置。
 *
 * 和 TabBar 共用同一份 TABS 定义 —— 两处各写一份迟早会漂移（加了一个 tab 只改
 * 了一边）。
 */
import { computed } from "vue";
import { useRoute } from "vue-router";

import { TABS } from "./navigation";

const route = useRoute();
const active = computed(() => route.meta.tab as string | undefined);
</script>

<template>
  <aside class="rail">
    <div class="rail__inner">
      <p class="rail__brand">funread</p>
      <nav aria-label="主导航">
        <RouterLink
          v-for="tab in TABS"
          :key="tab.key"
          :to="tab.to"
          class="rail__item"
          :class="{ 'rail__item--active': active === tab.key }"
          :aria-current="active === tab.key ? 'page' : undefined"
        >
          <n-icon size="19"><component :is="tab.icon" /></n-icon>
          <span>{{ tab.label }}</span>
        </RouterLink>
      </nav>

      <!-- 桌面上快捷键是主要交互方式，所以把它列出来而不是让人猜 -->
      <div class="rail__hints">
        <p class="rail__hints-title">快捷键</p>
        <p><kbd>/</kbd> 搜索</p>
        <p><kbd>←</kbd> <kbd>→</kbd> 翻章</p>
        <p><kbd>t</kbd> 目录 · <kbd>s</kbd> 设置</p>
        <p><kbd>Esc</kbd> 关闭 / 返回</p>
      </div>
    </div>
  </aside>
</template>

<style scoped>
.rail {
  flex-shrink: 0;
  width: var(--rail-width);
  border-right: 1px solid var(--border-subtle);
}

.rail__inner {
  position: sticky;
  top: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  height: 100dvh;
  padding: var(--space-4) var(--space-3);
}

.rail__brand {
  margin: 0;
  padding-left: var(--space-2);
  font-size: 18px;
  font-weight: 700;
}

.rail__item {
  display: flex;
  gap: var(--space-3);
  align-items: center;
  padding: 10px var(--space-2);
  font-size: 14px;
  color: var(--text-muted);
  text-decoration: none;
  border-radius: 8px;
}

.rail__item:hover {
  background: var(--surface-sunken);
}

.rail__item--active {
  font-weight: 600;
  color: var(--accent);
  background: var(--surface-sunken);
}

.rail__hints {
  margin-top: auto;
  padding-left: var(--space-2);
  font-size: 11px;
  line-height: 1.9;
  color: var(--text-muted);
}

.rail__hints-title {
  margin: 0 0 2px;
  font-weight: 600;
}

.rail__hints p {
  margin: 0;
}

kbd {
  padding: 1px 5px;
  font-family: inherit;
  font-size: 10px;
  background: var(--surface-sunken);
  border: 1px solid var(--border-subtle);
  border-radius: 4px;
}
</style>
