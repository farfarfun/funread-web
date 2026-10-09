<script setup lang="ts">
/** 一个订阅下的文章列表：分类切换、下拉刷新、加载更多、已读/收藏。 */
import { CheckmarkDoneOutline, RefreshOutline } from "@vicons/ionicons5";
import { useMessage } from "naive-ui";
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";

import { api } from "../../api/client";
import type { RssArticle, RssCategory, Subscription } from "../../api/types";
import ArticleCard from "../../components/web/ArticleCard.vue";
import SkeletonList from "../../components/web/SkeletonList.vue";
import TopBar from "../../components/web/TopBar.vue";

const route = useRoute();
const router = useRouter();
const message = useMessage();

const subId = computed(() => String(route.params.subId));

const subscription = ref<Subscription | null>(null);
const categories = ref<RssCategory[]>([]);
const category = ref("");
const articles = ref<RssArticle[]>([]);
const nextUrl = ref("");
const hasContent = ref(true);

const loading = ref(true);
const loadingMore = ref(false);
const error = ref("");

const unread = computed(() => articles.value.filter((item) => !item.read).length);

async function bootstrap() {
  loading.value = true;
  error.value = "";
  try {
    const all = await api.subscriptions();
    subscription.value = all.find((item) => item.sub_id === subId.value) ?? null;
    if (!subscription.value) {
      error.value = "没有这个订阅";
      return;
    }
    categories.value = await api.rssCategories(subId.value).catch(() => []);
    category.value = categories.value[0]?.name ?? "";
    await fetchPage(true);
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : "加载失败";
  } finally {
    loading.value = false;
  }
}

async function fetchPage(reset: boolean) {
  if (reset) {
    articles.value = [];
    nextUrl.value = "";
  }
  try {
    const page = await api.rssArticles({
      sub_id: subId.value,
      category: reset ? category.value : "",
      next_url: reset ? "" : nextUrl.value,
      limit: 30,
    });
    //  按 article_key 去重：翻页时源站很可能把第一页的条目又给一遍
    const seen = new Set(articles.value.map((item) => item.article_key));
    const fresh = page.items.filter((item) => !seen.has(item.article_key));
    articles.value = reset ? page.items : [...articles.value, ...fresh];
    nextUrl.value = page.next_url;
    hasContent.value = page.has_content;
  } catch (reason) {
    if (reset) error.value = reason instanceof Error ? reason.message : "加载失败";
    else message.error(reason instanceof Error ? reason.message : "加载更多失败");
  }
}

async function switchCategory(name: string) {
  category.value = name;
  loading.value = true;
  error.value = "";
  await fetchPage(true);
  loading.value = false;
}

async function refresh() {
  loading.value = true;
  error.value = "";
  await fetchPage(true);
  loading.value = false;
}

async function more() {
  if (!nextUrl.value || loadingMore.value) return;
  loadingMore.value = true;
  await fetchPage(false);
  loadingMore.value = false;
}

function open(article: RssArticle) {
  if (!hasContent.value) {
    //  源没有正文规则，内置阅读器必然空白 —— 直接外跳，别骗用户点进来
    window.open(article.link, "_blank", "noopener,noreferrer");
    markRead(article, true);
    return;
  }
  router.push({
    name: "rss-article",
    params: { subId: subId.value },
    query: {
      link: article.link,
      title: article.title,
      //  带着走，正文页会原样回传给后端 —— 见 api.rssArticle 的注释
      variables: Object.keys(article.variables).length
        ? JSON.stringify(article.variables)
        : undefined,
    },
  });
}

async function markRead(article: RssArticle, read: boolean) {
  //  先改本地再发请求：已读是个无足轻重的状态，等一次往返才变灰很顿
  article.read = read;
  try {
    await api.markRead(subId.value, article.article_key, read, {
      title: article.title,
      link: article.link,
      pub_date: article.pub_date,
      image: article.image,
    });
  } catch {
    article.read = !read;
  }
}

async function toggleFavorite(article: RssArticle) {
  const next = !article.favorited;
  article.favorited = next;
  try {
    await api.markFavorite(subId.value, article.article_key, next, {
      title: article.title,
      link: article.link,
      pub_date: article.pub_date,
      image: article.image,
    });
  } catch (reason) {
    article.favorited = !next;
    message.error(reason instanceof Error ? reason.message : "操作失败");
  }
}

async function readAll() {
  const keys = articles.value.filter((item) => !item.read).map((item) => item.article_key);
  if (!keys.length) {
    message.info("这一页都读过了");
    return;
  }
  try {
    const result = await api.readAll(subId.value, keys);
    articles.value.forEach((item) => (item.read = true));
    message.success(`已标记 ${result.changed} 篇为已读`);
  } catch (reason) {
    message.error(reason instanceof Error ? reason.message : "操作失败");
  }
}

onMounted(bootstrap);
</script>

<template>
  <div>
    <TopBar :title="subscription?.title || '文章列表'" back fallback="/web/rss">
      <template #actions>
        <n-button quaternary circle aria-label="全部已读" :disabled="!unread" @click="readAll">
          <template #icon><n-icon><CheckmarkDoneOutline /></n-icon></template>
        </n-button>
        <n-button quaternary circle aria-label="刷新" @click="refresh">
          <template #icon><n-icon><RefreshOutline /></n-icon></template>
        </n-button>
      </template>
    </TopBar>

    <div v-if="categories.length > 1" class="categories">
      <n-button
        v-for="item in categories"
        :key="item.name"
        size="small"
        :type="category === item.name ? 'primary' : 'default'"
        :quaternary="category !== item.name"
        @click="switchCategory(item.name)"
      >
        {{ item.name }}
      </n-button>
    </div>

    <p v-if="!hasContent && !loading" class="notice">
      这个源没有正文规则，文章会直接在浏览器里打开。
    </p>

    <SkeletonList v-if="loading" :rows="5" :cover="false" />

    <n-result v-else-if="error" status="warning" title="读不到文章" :description="error" class="state">
      <template #footer>
        <n-button @click="refresh">重试</n-button>
        <n-button text @click="router.push({ name: 'rss' })">回订阅列表</n-button>
      </template>
    </n-result>

    <n-empty v-else-if="!articles.length" description="这个分类下没有文章" class="state">
      <template #extra><n-button @click="refresh">刷新</n-button></template>
    </n-empty>

    <template v-else>
      <n-list hoverable clickable>
        <n-list-item v-for="article in articles" :key="article.article_key" @click="open(article)">
          <ArticleCard :article="article" @favorite="toggleFavorite" />
        </n-list-item>
      </n-list>

      <div v-if="nextUrl" class="more">
        <n-button :loading="loadingMore" block @click="more">加载更多</n-button>
      </div>
      <p v-else class="end">没有更多了</p>
    </template>
  </div>
</template>

<style scoped>
.categories {
  display: flex;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  overflow-x: auto;
  /* 分类可能十几个，横向滚而不是换行堆高 */
  white-space: nowrap;
  -webkit-overflow-scrolling: touch;
}

.notice {
  margin: 0;
  padding: var(--space-2) var(--space-3);
  font-size: 12px;
  color: #f0a020;
}

.state {
  padding: var(--space-6) var(--space-4);
}

.more {
  padding: var(--space-3);
}

.end {
  padding: var(--space-4);
  font-size: 12px;
  color: var(--text-muted);
  text-align: center;
}
</style>
