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
import { useAuth } from "../../composables/useAuth";

const route = useRoute();
const active = computed(() => route.meta.tab as string | undefined);
const { isAdmin } = useAuth();
</script>

<template>
  <aside class="rail">
    <div class="rail__inner">
      <p class="rail__brand"><span class="rail__mark">f</span> funread</p>
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

      <RouterLink v-if="isAdmin" to="/admin/sources" class="rail__admin">管理中心</RouterLink>
    </div>
  </aside>
</template>

<style scoped>
.rail {
  flex-shrink: 0;
  width: var(--rail-width);
  background: var(--surface-raised);
  border-right: 1px solid var(--border-subtle);
}

.rail__inner {
  position: sticky;
  top: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
  height: 100dvh;
  padding: var(--space-5) var(--space-3);
}

.rail__brand {
  display: flex;
  gap: 10px;
  align-items: center;
  margin: 0;
  padding-left: var(--space-2);
  font-size: 18px;
  font-weight: 700;
}

.rail__mark {
  display: grid;
  width: 32px;
  height: 32px;
  place-items: center;
  color: white;
  background: #167a69;
  border-radius: 8px;
}

.rail__item {
  display: flex;
  gap: var(--space-3);
  align-items: center;
  min-height: 44px;
  padding: 10px var(--space-3);
  font-size: 14px;
  color: var(--text-muted);
  text-decoration: none;
  border-radius: 6px;
}

.rail__item:hover {
  background: var(--surface-sunken);
}

.rail__item--active {
  font-weight: 600;
  color: var(--accent);
  background: var(--accent-soft);
}

.rail__admin {
  margin-top: auto;
  padding: 12px var(--space-3);
  font-size: 13px;
  color: var(--text-muted);
  text-decoration: none;
  border-top: 1px solid var(--border-subtle);
}
</style>
