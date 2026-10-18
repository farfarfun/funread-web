<script setup lang="ts">
/**
 * 读过的订阅文章，最近读的在前。
 *
 * 已读状态从 M4b 起就落库了，这一页只是给它一个按时间倒排的视图 —— 「刚才那篇
 * 讲什么的来着」是订阅阅读里最常见的回头路。和收藏页一样用标已读时存下的快照
 * 渲染，不重抓 feed。
 */
import { OpenOutline, TimeOutline } from "@vicons/ionicons5";
import { onActivated, onMounted, ref } from "vue";
import { useRouter } from "vue-router";

import { api } from "../../api/client";
import type { RssHistoryItem } from "../../api/types";
import SkeletonList from "../../components/web/SkeletonList.vue";
import TopBar from "../../components/web/TopBar.vue";
import { fromNow } from "../../utils/display";

const router = useRouter();

const items = ref<RssHistoryItem[]>([]);
const loading = ref(true);
const error = ref("");

async function load() {
  loading.value = true;
  error.value = "";
  try {
    items.value = await api.history();
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : "加载失败";
  } finally {
    loading.value = false;
  }
}

function open(item: RssHistoryItem) {
  router.push({
    name: "rss-article",
    params: { subId: item.sub_id },
    query: { link: item.link, title: item.title },
  });
}

onMounted(load);
onActivated(load);
</script>

<template>
  <div>
    <TopBar title="阅读历史" back fallback="/web/account" />

    <SkeletonList v-if="loading" :rows="4" :cover="false" />

    <n-result v-else-if="error" status="error" title="历史加载失败" :description="error" class="state">
      <template #footer><n-button @click="load">重试</n-button></template>
    </n-result>

    <n-empty v-else-if="!items.length" description="还没有读过订阅文章" class="state">
      <template #icon><n-icon size="40"><TimeOutline /></n-icon></template>
      <template #extra>
        <n-button @click="router.push({ name: 'rss' })">去订阅</n-button>
      </template>
    </n-empty>

    <n-list v-else hoverable clickable>
      <n-list-item v-for="item in items" :key="`${item.sub_id}-${item.article_key}`">
        <div class="row" @click="open(item)">
          <div class="row__body">
            <p class="row__title">{{ item.title || "（无标题）" }}</p>
            <p class="row__meta">
              <span>{{ fromNow(item.read_at) }}读过</span>
              <span v-if="item.favorited" class="row__fav">已收藏</span>
            </p>
          </div>
          <img
            v-if="item.image"
            class="row__image"
            :src="item.image"
            alt=""
            loading="lazy"
            referrerpolicy="no-referrer"
          />
        </div>
        <template #suffix>
          <n-button
            quaternary
            size="small"
            tag="a"
            :href="item.link"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="在浏览器里打开"
            @click.stop
          >
            <template #icon><n-icon><OpenOutline /></n-icon></template>
          </n-button>
        </template>
      </n-list-item>
    </n-list>
  </div>
</template>

<style scoped>
.state {
  padding: var(--space-6) var(--space-4);
}

.row {
  display: flex;
  flex: 1;
  gap: var(--space-3);
  align-items: flex-start;
  cursor: pointer;
}

.row__body {
  min-width: 0;
  flex: 1;
}

.row__title {
  display: -webkit-box;
  margin: 0 0 4px;
  overflow: hidden;
  font-size: 14px;
  font-weight: 600;
  line-height: 1.4;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.row__meta {
  display: flex;
  gap: var(--space-2);
  margin: 0;
  font-size: 11px;
  color: var(--text-muted);
}

.row__fav {
  color: #f0a020;
}

.row__image {
  flex-shrink: 0;
  width: 64px;
  height: 48px;
  object-fit: cover;
  background: var(--surface-sunken);
  border-radius: 6px;
}
</style>
