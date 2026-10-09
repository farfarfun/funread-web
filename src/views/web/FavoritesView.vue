<script setup lang="ts">
/**
 * 收藏的订阅文章。
 *
 * `GET /rss/favorites` 从 M4b 就有了，但一直没有界面入口 —— 用户收藏完就再也找不
 * 回来。这一页就是补那个入口。
 *
 * 渲染用的是**收藏时存下的快照**（标题/链接/时间/配图），不是重新抓 feed ——
 * 收藏必须能在文章滚出源站首页之后照常显示，而订阅文章的正文不缓存。
 */
import { OpenOutline, StarOutline } from "@vicons/ionicons5";
import { useMessage } from "naive-ui";
import { onActivated, onMounted, ref } from "vue";
import { useRouter } from "vue-router";

import { api } from "../../api/client";
import type { RssFavorite } from "../../api/types";
import SkeletonList from "../../components/web/SkeletonList.vue";
import TopBar from "../../components/web/TopBar.vue";

const router = useRouter();
const message = useMessage();

const favorites = ref<RssFavorite[]>([]);
const loading = ref(true);
const error = ref("");

async function load() {
  loading.value = true;
  error.value = "";
  try {
    favorites.value = await api.favorites();
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : "加载失败";
  } finally {
    loading.value = false;
  }
}

function open(item: RssFavorite) {
  router.push({
    name: "rss-article",
    params: { subId: item.sub_id },
    query: { link: item.link, title: item.title },
  });
}

async function unfavorite(item: RssFavorite) {
  //  先改本地再发请求 —— 这是个无足轻重的状态
  const index = favorites.value.indexOf(item);
  favorites.value = favorites.value.filter((row) => row !== item);
  try {
    await api.markFavorite(item.sub_id, item.article_key, false);
  } catch (reason) {
    favorites.value.splice(index, 0, item);
    message.error(reason instanceof Error ? reason.message : "操作失败");
  }
}

onMounted(load);
onActivated(load);
</script>

<template>
  <div>
    <TopBar title="收藏" back fallback="/web/rss" />

    <SkeletonList v-if="loading" :rows="4" :cover="false" />

    <n-result v-else-if="error" status="error" title="收藏加载失败" :description="error" class="state">
      <template #footer><n-button @click="load">重试</n-button></template>
    </n-result>

    <n-empty v-else-if="!favorites.length" description="还没有收藏的文章" class="state">
      <template #icon><n-icon size="40"><StarOutline /></n-icon></template>
      <template #extra>
        <p class="hint">在文章列表或正文页点星号即可收藏。</p>
        <n-button @click="router.push({ name: 'rss' })">去订阅</n-button>
      </template>
    </n-empty>

    <n-list v-else hoverable clickable>
      <n-list-item v-for="item in favorites" :key="`${item.sub_id}-${item.article_key}`">
        <div class="row" @click="open(item)">
          <div class="row__body">
            <p class="row__title">{{ item.title || "（无标题）" }}</p>
            <p class="row__meta">
              <span v-if="item.pub_date">{{ item.pub_date }}</span>
              <span v-if="item.read" class="row__read">已读</span>
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
          <div class="actions">
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
            <n-popconfirm @positive-click="unfavorite(item)">
              <template #trigger>
                <n-button quaternary size="small" @click.stop>取消收藏</n-button>
              </template>
              取消后这篇文章会从收藏里消失，确定吗？
            </n-popconfirm>
          </div>
        </template>
      </n-list-item>
    </n-list>
  </div>
</template>

<style scoped>
.state {
  padding: var(--space-6) var(--space-4);
}

.hint {
  margin: 0 0 var(--space-3);
  font-size: 12px;
  color: var(--text-muted);
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

.row__read {
  color: var(--accent);
}

.row__image {
  flex-shrink: 0;
  width: 64px;
  height: 48px;
  object-fit: cover;
  background: var(--surface-sunken);
  border-radius: 6px;
}

.actions {
  display: flex;
  gap: var(--space-1);
  align-items: center;
}
</style>
