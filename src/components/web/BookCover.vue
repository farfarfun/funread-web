<script setup lang="ts">
/**
 * 封面。源站给的封面地址有相当一部分是死链或要 referer，所以加载失败必须有
 * 占位 —— 否则列表里会是一排碎图标。
 */
import { ref, watch } from "vue";

const props = withDefaults(
  defineProps<{ src?: string; name: string; width?: number; height?: number }>(),
  { src: "", width: 64, height: 88 },
);

const failed = ref(false);
//  换书时要把失败状态清掉，否则列表复用组件实例后新封面也显示占位
watch(() => props.src, () => (failed.value = false));
</script>

<template>
  <div
    class="cover"
    :style="{ width: `${width}px`, height: `${height ?? Math.round(width * 1.375)}px` }"
  >
    <img
      v-if="src && !failed"
      :src="src"
      :alt="`《${name}》封面`"
      loading="lazy"
      decoding="async"
      referrerpolicy="no-referrer"
      @error="failed = true"
    />
    <span v-else class="cover__fallback" aria-hidden="true">{{ name.slice(0, 1) || "书" }}</span>
  </div>
</template>

<style scoped>
.cover {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  background: var(--surface-sunken);
  /* 原版用 CardView 包封面（item_bookshelf_grid.xml 的 cv_content），
     所以有圆角和一点投影 —— 封面因此从背景里「浮」出来 */
  border-radius: 4px;
  box-shadow: 0 1px 4px rgb(0 0 0 / 18%);
}

.cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.cover__fallback {
  font-size: 22px;
  font-weight: 600;
  color: var(--text-muted);
}
</style>
