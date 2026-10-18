<script setup lang="ts">
/** 订阅文章列表里的一条。已读的整体压暗 —— 这是列表里最需要一眼分清的状态。 */
import { MusicalNotesOutline, StarOutline, Star, VideocamOutline } from "@vicons/ionicons5";
import { computed } from "vue";

import type { RssArticle } from "../../api/types";
import { formatFeedDate, plainText } from "../../utils/display";

const props = defineProps<{ article: RssArticle }>();
const emit = defineEmits<{ favorite: [article: RssArticle] }>();

//  源站的 description 多半是 HTML，不去标签的话卡片上显示的是 `<a href="…`。
const summary = computed(() => plainText(props.article.description));
const when = computed(() => formatFeedDate(props.article.pub_date));

/**
 * 短内容（RSSHub 转出来的微博 / 推文一类）：没有标题，或者标题就是正文的前几十个
 * 字。按「标题 + 摘要」渲染会得到一行标题加一行同样内容的重复 —— 这种直接把正文
 * 当主体，多给几行。判断只看文本，不看来源：标准 feed 的 title 本来就可以为空。
 */
const isShort = computed(() => {
  const title = (props.article.title || "").trim();
  if (!title) return summary.value.length > 0;
  const head = title.replace(/[…\.]+$/, "").slice(0, 24);
  return head.length >= 8 && summary.value.startsWith(head);
});

const mediaKind = computed<"audio" | "video" | "">(() => {
  if (!props.article.media_url) return "";
  const mime = (props.article.media_type || "").toLowerCase();
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  return /\.(mp4|m4v|webm|mov|mkv)(\?|$)/i.test(props.article.media_url) ? "video" : "audio";
});
</script>

<template>
  <article class="article-card" :class="{ 'article-card--read': props.article.read }">
    <div class="article-card__body">
      <template v-if="isShort">
        <p class="article-card__post">{{ summary || props.article.title }}</p>
      </template>
      <template v-else>
        <h3 class="article-card__title">{{ props.article.title }}</h3>
        <p v-if="summary" class="article-card__summary">{{ summary }}</p>
      </template>
      <p class="article-card__meta">
        <span v-if="mediaKind" class="article-card__media" :title="mediaKind === 'video' ? '视频' : '音频'">
          <n-icon size="14">
            <VideocamOutline v-if="mediaKind === 'video'" />
            <MusicalNotesOutline v-else />
          </n-icon>
        </span>
        <span v-if="when">{{ when }}</span>
        <span v-if="props.article.read" class="article-card__read">已读</span>
      </p>
    </div>
    <img
      v-if="props.article.image"
      class="article-card__image"
      :src="props.article.image"
      :alt="''"
      loading="lazy"
      decoding="async"
      referrerpolicy="no-referrer"
    />
    <button
      type="button"
      class="article-card__star"
      :aria-label="props.article.favorited ? '取消收藏' : '收藏'"
      :aria-pressed="props.article.favorited"
      @click.stop.prevent="emit('favorite', props.article)"
    >
      <n-icon size="18">
        <Star v-if="props.article.favorited" />
        <StarOutline v-else />
      </n-icon>
    </button>
  </article>
</template>

<style scoped>
.article-card {
  display: flex;
  gap: var(--space-3);
  align-items: flex-start;
  padding: var(--space-3);
}

.article-card--read {
  opacity: 0.55;
}

.article-card__body {
  min-width: 0;
  flex: 1;
}

.article-card__title {
  display: -webkit-box;
  margin: 0 0 4px;
  overflow: hidden;
  font-size: 15px;
  font-weight: 600;
  line-height: 1.4;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.article-card__summary {
  display: -webkit-box;
  margin: 0 0 4px;
  overflow: hidden;
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-muted);
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

/* 短内容：正文就是主体，给到 5 行，字号用标题档而不是摘要档 */
.article-card__post {
  display: -webkit-box;
  margin: 0 0 4px;
  overflow: hidden;
  font-size: 14px;
  line-height: 1.5;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 5;
}

.article-card__media {
  display: inline-flex;
  align-items: center;
  color: var(--accent);
}

.article-card__meta {
  display: flex;
  gap: var(--space-2);
  margin: 0;
  /* 12px 是手机上的下限，11px 在实际尺寸下已经要眯着眼看了 */
  font-size: 12px;
  color: var(--text-muted);
}

.article-card__read {
  color: var(--accent);
}

.article-card__image {
  flex-shrink: 0;
  width: 72px;
  height: 56px;
  object-fit: cover;
  background: var(--surface-sunken);
  border-radius: 6px;
}

.article-card__star {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  /* 44px：收藏按钮和整条卡片的点击区挨得很近，小一点就会误触 */
  width: 44px;
  min-height: 44px;
  color: var(--text-muted);
  background: none;
  border: none;
  cursor: pointer;
}

.article-card__star[aria-pressed="true"] {
  color: #f0a020;
}
</style>
