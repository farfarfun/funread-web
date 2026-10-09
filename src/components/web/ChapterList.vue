<script setup lang="ts">
/**
 * 章节目录。
 *
 * 必须虚拟滚动：长篇连载动辄三五千章，一次渲染出三千个 DOM 节点在手机上会卡
 * 住主线程好几秒。这里不引虚拟列表库，自己按固定行高算可见窗口 —— 行高是固定
 * 的（单行省略号），所以算起来没有悬念，而引一个库要多一份依赖和一套 API。
 */
import { computed, onMounted, ref, watch } from "vue";

import type { Chapter } from "../../api/types";

const props = withDefaults(
  defineProps<{
    chapters: Chapter[];
    cachedIndexes?: number[];
    currentIndex?: number;
    /** 目录内过滤关键词（功能清单 B8）。 */
    filter?: string;
    reversed?: boolean;
  }>(),
  { cachedIndexes: () => [], currentIndex: -1, filter: "", reversed: false },
);

const emit = defineEmits<{ pick: [chapter: Chapter] }>();

const ROW_HEIGHT = 48;
/** 可见窗口外多渲染几行，快速滚动时不会露白。 */
const OVERSCAN = 6;

const viewport = ref<HTMLElement | null>(null);
const scrollTop = ref(0);
const viewportHeight = ref(480);

const cached = computed(() => new Set(props.cachedIndexes));

const visibleChapters = computed(() => {
  const keyword = props.filter.trim().toLowerCase();
  const filtered = keyword
    ? props.chapters.filter((chapter) => chapter.name.toLowerCase().includes(keyword))
    : props.chapters;
  return props.reversed ? [...filtered].reverse() : filtered;
});

const window_ = computed(() => {
  const total = visibleChapters.value.length;
  const start = Math.max(0, Math.floor(scrollTop.value / ROW_HEIGHT) - OVERSCAN);
  const count = Math.ceil(viewportHeight.value / ROW_HEIGHT) + OVERSCAN * 2;
  const end = Math.min(total, start + count);
  return { start, end, offset: start * ROW_HEIGHT, total: total * ROW_HEIGHT };
});

const slice = computed(() => visibleChapters.value.slice(window_.value.start, window_.value.end));

function measure() {
  if (viewport.value) viewportHeight.value = viewport.value.clientHeight || 480;
}

function onScroll(event: Event) {
  scrollTop.value = (event.target as HTMLElement).scrollTop;
}

/** 滚到当前进度所在的那一章。打开目录时自动调一次。 */
function scrollToCurrent() {
  if (!viewport.value || props.currentIndex < 0) return;
  const position = visibleChapters.value.findIndex(
    (chapter) => chapter.index === props.currentIndex,
  );
  if (position < 0) return;
  //  放在视口三分之一处而不是顶端：上下都能看到相邻章节，更容易确认位置
  viewport.value.scrollTop = Math.max(0, position * ROW_HEIGHT - viewportHeight.value / 3);
}

onMounted(() => {
  measure();
  scrollToCurrent();
});

//  过滤或倒序会让行数变化，旧的 scrollTop 可能已经越界
watch([() => props.filter, () => props.reversed], () => {
  if (viewport.value) viewport.value.scrollTop = 0;
  scrollTop.value = 0;
});

defineExpose({ scrollToCurrent });
</script>

<template>
  <div ref="viewport" class="chapter-list" @scroll.passive="onScroll">
    <p v-if="!visibleChapters.length" class="chapter-list__empty">
      {{ filter ? "没有匹配的章节" : "目录是空的" }}
    </p>
    <div v-else class="chapter-list__spacer" :style="{ height: `${window_.total}px` }">
      <ul class="chapter-list__rows" :style="{ transform: `translateY(${window_.offset}px)` }">
        <li v-for="chapter in slice" :key="chapter.index">
          <button
            type="button"
            class="chapter"
            :class="{ 'chapter--current': chapter.index === currentIndex }"
            @click="emit('pick', chapter)"
          >
            <span class="chapter__name">{{ chapter.name }}</span>
            <span v-if="cached.has(chapter.index)" class="chapter__badge" title="已下载">已缓存</span>
          </button>
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.chapter-list {
  position: relative;
  overflow-y: auto;
  /* 固定高度是虚拟滚动的前提：没有可滚容器就没有可见窗口 */
  height: min(60dvh, 520px);
  -webkit-overflow-scrolling: touch;
}

.chapter-list__empty {
  padding: var(--space-5) var(--space-3);
  color: var(--text-muted);
  text-align: center;
}

.chapter-list__spacer {
  position: relative;
}

.chapter-list__rows {
  position: absolute;
  inset-inline: 0;
  top: 0;
  margin: 0;
  padding: 0;
  list-style: none;
}

.chapter {
  display: flex;
  gap: var(--space-2);
  align-items: center;
  width: 100%;
  height: 48px;
  padding: 0 var(--space-3);
  color: inherit;
  text-align: left;
  background: none;
  border: none;
  border-bottom: 1px solid var(--border-subtle);
  cursor: pointer;
}

.chapter--current {
  color: var(--accent);
  background: var(--surface-sunken);
}

.chapter__name {
  flex: 1;
  overflow: hidden;
  font-size: 14px;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.chapter__badge {
  flex-shrink: 0;
  padding: 1px 6px;
  font-size: 10px;
  color: var(--text-muted);
  background: var(--surface-sunken);
  border-radius: 4px;
}
</style>
