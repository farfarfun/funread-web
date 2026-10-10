<script setup lang="ts">
/**
 * 顶部栏。返回键只在能返回时出现 —— 一个点了没反应的返回箭头比没有更糟。
 */
import { ChevronBackOutline } from "@vicons/ionicons5";
import { useRouter } from "vue-router";

const props = withDefaults(
  defineProps<{ title: string; back?: boolean; fallback?: string }>(),
  { back: false, fallback: "/web" },
);

const router = useRouter();

function goBack() {
  //  history 里没有上一页时（直接粘链接进来、或刚从登录页跳过来）回 fallback，
  //  而不是 router.back() 把人弹出这个应用。
  if (window.history.state?.back) router.back();
  else router.replace(props.fallback);
}
</script>

<template>
  <header class="top-bar">
    <button v-if="back" class="top-bar__back" type="button" aria-label="返回" @click="goBack">
      <n-icon size="22"><ChevronBackOutline /></n-icon>
    </button>
    <h1 class="top-bar__title">{{ title }}</h1>
    <div class="top-bar__actions"><slot name="actions" /></div>
  </header>
</template>

<style scoped>
.top-bar {
  position: sticky;
  top: 0;
  z-index: 15;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-height: 52px;
  padding: 0 var(--space-3);
  /* 刘海屏横屏时左右也要让 */
  padding-left: max(var(--space-3), env(safe-area-inset-left));
  padding-right: max(var(--space-3), env(safe-area-inset-right));
  background: var(--surface-raised);
  border-bottom: 1px solid var(--border-subtle);
  backdrop-filter: blur(12px);
}

.top-bar__back {
  display: flex;
  align-items: center;
  justify-content: center;
  /* 44×44：触屏上的最小命中区。它不是 n-button，tokens.css 里那条
     `@media (pointer: coarse) .n-button { min-height: 44px }` 管不到。
     负 margin 跟着放大（-6 → -10），让 22px 图标的左边缘停在原位，
     视觉上标题和返回箭头的间距不变。 */
  width: 44px;
  height: 44px;
  margin-left: -10px;
  padding: 0;
  color: inherit;
  background: none;
  border: none;
  border-radius: 50%;
  cursor: pointer;
}

.top-bar__back:active {
  background: var(--surface-sunken);
}

.top-bar__title {
  flex: 1;
  margin: 0;
  overflow: hidden;
  font-size: 17px;
  font-weight: 600;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.top-bar__actions {
  display: flex;
  flex-shrink: 0;
  gap: var(--space-1);
  align-items: center;
}
</style>
