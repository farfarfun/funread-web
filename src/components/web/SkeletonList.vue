<script setup lang="ts">
/**
 * 加载骨架。聚合搜索要并发打十几个源、超时是 (6, 12) 秒，没有中间态的话界面
 * 会空白好几秒 —— 用户只会以为坏了然后再点一次，把负担翻倍。
 */
withDefaults(defineProps<{ rows?: number; cover?: boolean }>(), { rows: 4, cover: true });
</script>

<template>
  <div class="skeleton" aria-busy="true" aria-live="polite">
    <div v-for="index in rows" :key="index" class="skeleton__row">
      <div v-if="cover" class="skeleton__cover" />
      <div class="skeleton__lines">
        <div class="skeleton__line skeleton__line--title" />
        <div class="skeleton__line skeleton__line--meta" />
        <div class="skeleton__line skeleton__line--body" />
      </div>
    </div>
    <span class="sr-only">正在加载</span>
  </div>
</template>

<style scoped>
.skeleton {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-3);
}

.skeleton__row {
  display: flex;
  gap: var(--space-3);
}

.skeleton__cover {
  flex-shrink: 0;
  width: 64px;
  height: 88px;
  border-radius: 6px;
}

.skeleton__lines {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: var(--space-2);
  justify-content: center;
}

.skeleton__line {
  height: 12px;
  border-radius: 6px;
}

.skeleton__line--title {
  width: 52%;
  height: 16px;
}

.skeleton__line--meta {
  width: 34%;
}

.skeleton__line--body {
  width: 82%;
}

.skeleton__cover,
.skeleton__line {
  background: linear-gradient(
    90deg,
    var(--surface-sunken) 25%,
    var(--surface-raised) 37%,
    var(--surface-sunken) 63%
  );
  background-size: 400% 100%;
  animation: shimmer 1.4s ease-in-out infinite;
}

@keyframes shimmer {
  0% {
    background-position: 100% 0;
  }
  100% {
    background-position: 0 0;
  }
}
</style>
