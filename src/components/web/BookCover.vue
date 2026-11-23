<script setup lang="ts">
/**
 * 书籍封面组件。
 *
 * 源站封面外链失效率很高，因此回退封面按书名哈希分配低饱和度书卷色板，并配
 * 书脊压线、内框线与精致书名排版，避免退化成一块单调灰砖；真实封面图也叠加
 * 轻微书脊高光与描边，增强实体书质感。
 */
import { computed, ref, watch } from "vue";

const props = withDefaults(
  defineProps<{
    src?: string;
    name: string;
    author?: string;
    width?: number;
    height?: number;
  }>(),
  { src: "", author: "", width: 64, height: 88 },
);

const failed = ref(false);
//  换书时要把失败状态清掉，否则列表复用组件实例后新封面也显示占位
watch(() => props.src, () => (failed.value = false));

/** 低饱和度书卷色板（莫兰迪/宣纸墨色系），兼顾浅色与深色背景的层次感。 */
const PALETTES: ReadonlyArray<readonly [string, string, string]> = [
  ["#2D4F4B", "#1D3633", "#E9F2EE"], // 黛绿
  ["#3B4C66", "#263348", "#EBF0F7"], // 靛青
  ["#6A4B42", "#4B332C", "#F6ECE8"], // 绛褐
  ["#4E4A68", "#35314A", "#EFEDF7"], // 暮紫
  ["#5A5D3F", "#3E412A", "#F2F3E8"], // 苔绿
  ["#785B3A", "#563F26", "#F7F0E6"], // 赭黄
  ["#435A59", "#2C3E3D", "#EAF2F1"], // 苍青
  ["#694756", "#4A2F3B", "#F6EBF0"], // 藕荷
];

function hashTitle(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

const palette = computed(() => PALETTES[hashTitle(props.name || "书") % PALETTES.length]);
const compact = computed(() => props.width < 80);

const fallbackStyle = computed(() => {
  const [from, to, fg] = palette.value;
  return {
    background: `linear-gradient(145deg, ${from} 0%, ${to} 100%)`,
    color: fg,
  };
});
</script>

<template>
  <div
    class="cover"
    :class="{ 'cover--compact': compact }"
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
    <div v-else class="cover__fallback" :style="fallbackStyle" aria-hidden="true">
      <div class="cover__frame">
        <span class="cover__title">{{ name || "无题" }}</span>
        <span v-if="author && !compact" class="cover__author">{{ author }}</span>
      </div>
    </div>
    <span class="cover__spine" aria-hidden="true" />
  </div>
</template>

<style scoped>
.cover {
  position: relative;
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  background: var(--surface-sunken);
  border-radius: 3px 6px 6px 3px;
  box-shadow:
    0 2px 6px rgb(0 0 0 / 20%),
    0 1px 2px rgb(0 0 0 / 12%);
}

.cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

/* 左侧细微书脊压线与高光，让图片封面与回退封面都有实体书质感 */
.cover__spine {
  position: absolute;
  inset: 0;
  pointer-events: none;
  border-radius: inherit;
  box-shadow:
    inset 4px 0 6px -3px rgb(0 0 0 / 28%),
    inset 1px 0 0 rgb(255 255 255 / 22%),
    inset 0 0 0 1px rgb(255 255 255 / 8%);
}

.cover__fallback {
  display: flex;
  width: 100%;
  height: 100%;
  padding: 8px 8px 8px 11px;
}

.cover--compact .cover__fallback {
  padding: 5px 5px 5px 7px;
}

.cover__frame {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  width: 100%;
  height: 100%;
  padding: 6px;
  border: 1px solid rgb(255 255 255 / 22%);
  border-radius: 2px;
}

.cover--compact .cover__frame {
  justify-content: center;
  padding: 3px;
}

.cover__title {
  display: -webkit-box;
  overflow: hidden;
  font-family: "Songti SC", "Noto Serif CJK SC", "Source Han Serif SC", Georgia, serif;
  font-size: 13px;
  font-weight: 600;
  line-height: 1.35;
  letter-spacing: 0.04em;
  word-break: break-all;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
}

.cover--compact .cover__title {
  font-size: 11px;
  text-align: center;
  -webkit-line-clamp: 2;
}

.cover__author {
  overflow: hidden;
  font-size: 10px;
  opacity: 0.78;
  white-space: nowrap;
  text-overflow: ellipsis;
}
</style>
