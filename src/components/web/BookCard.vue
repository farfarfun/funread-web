<script setup lang="ts">
/** 搜索结果里的一本书。`sources.length` 直接显示出来 —— 多源意味着有换源余地。 */
import BookCover from "./BookCover.vue";

defineProps<{
  name: string;
  author?: string;
  coverUrl?: string;
  intro?: string;
  lastChapter?: string;
  sourceCount?: number;
}>();
</script>

<template>
  <article class="book-card">
    <BookCover :src="coverUrl" :name="name" :width="60" :height="82" />
    <div class="book-card__body">
      <h3 class="book-card__title">{{ name }}</h3>
      <p class="book-card__meta">
        <span v-if="author">{{ author }}</span>
        <span v-if="sourceCount" class="book-card__sources">{{ sourceCount }} 个来源</span>
      </p>
      <p v-if="lastChapter" class="book-card__chapter">最新：{{ lastChapter }}</p>
      <p v-else-if="intro" class="book-card__intro">{{ intro }}</p>
    </div>
  </article>
</template>

<style scoped>
.book-card {
  display: flex;
  gap: var(--space-3);
  align-items: flex-start;
  padding: var(--space-3);
}

.book-card__body {
  min-width: 0;
  flex: 1;
}

.book-card__title {
  margin: 0 0 4px;
  overflow: hidden;
  font-size: 15px;
  font-weight: 600;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.book-card__meta {
  display: flex;
  gap: var(--space-2);
  margin: 0 0 4px;
  font-size: 12px;
  color: var(--text-muted);
}

.book-card__sources {
  color: var(--accent);
}

.book-card__chapter,
.book-card__intro {
  display: -webkit-box;
  margin: 0;
  overflow: hidden;
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-muted);
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}
</style>
