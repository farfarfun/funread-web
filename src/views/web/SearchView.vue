<script setup lang="ts">
/**
 * 聚合搜索。
 *
 * 这一页的设计全部围着一件事：**搜索很慢且经常部分失败**。后端并发打十几个源，
 * 单源超时 (6, 12) 秒，而归档里大量源其实已经死了。所以：
 *
 * - 必须有骨架屏，否则空白几秒会被当成坏了；
 * - 必须显示源统计（`sources_ok / sources_tried`），否则「搜不到」和「十个源里
 *   九个需要 JS」在界面上一模一样；
 * - 空结果要分两种文案：真的没命中，和所有源都失败了。
 */
import { CloseOutline, SearchOutline } from "@vicons/ionicons5";
import { useMessage } from "naive-ui";
import { computed, ref } from "vue";
import { useRouter } from "vue-router";

import { api } from "../../api/client";
import type { SearchBook, SearchPage } from "../../api/types";
import BookCard from "../../components/web/BookCard.vue";
import SkeletonList from "../../components/web/SkeletonList.vue";
import TopBar from "../../components/web/TopBar.vue";
import { useSearchHistory } from "../../composables/useSearchHistory";

const PAGE_SIZE = 20;

const router = useRouter();
const message = useMessage();
const { history, remember, forget, clear } = useSearchHistory();

const keyword = ref("");
const loading = ref(false);
const loadingMore = ref(false);
const error = ref("");
const page = ref<SearchPage | null>(null);
const items = ref<SearchBook[]>([]);

const hasMore = computed(() => {
  const current = page.value;
  return Boolean(current && items.value.length < current.total);
});

/** 所有源都没答上来 —— 和「这本书不存在」是两件事，文案要分开。 */
const allSourcesFailed = computed(() => {
  const current = page.value;
  return Boolean(current && current.sources_tried > 0 && current.sources_ok === 0);
});

const needsScan = computed(() => page.value?.sources_tried === 0);

async function run(term?: string) {
  const value = (term ?? keyword.value).trim();
  if (!value) return;
  keyword.value = value;
  loading.value = true;
  error.value = "";
  page.value = null;
  items.value = [];
  try {
    const result = await api.search({ keyword: value, limit: PAGE_SIZE, offset: 0 });
    page.value = result;
    items.value = result.items;
    remember(value);
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : "搜索失败";
  } finally {
    loading.value = false;
  }
}

async function more() {
  if (!page.value || loadingMore.value) return;
  loadingMore.value = true;
  try {
    const result = await api.search({
      keyword: keyword.value,
      limit: PAGE_SIZE,
      offset: items.value.length,
    });
    //  每次调用都重跑一轮实时 fan-out，所以第二页可能出现第一页已有的书。
    //  按 book_key 去重，否则列表里会冒出重复条目。
    const seen = new Set(items.value.map((item) => item.book_key));
    items.value = [...items.value, ...result.items.filter((item) => !seen.has(item.book_key))];
    page.value = result;
  } catch (reason) {
    message.error(reason instanceof Error ? reason.message : "加载更多失败");
  } finally {
    loadingMore.value = false;
  }
}

function open(book: SearchBook) {
  //  详情页要 url_id + book_url 才能发请求，搜索结果里带着，直接走 query
  //  传过去，省掉一次「详情页再反查来源」的往返。
  const primary = book.sources[0];
  router.push({
    name: "book",
    params: { bookKey: book.book_key },
    query: {
      url_id: primary ? String(primary.url_id) : undefined,
      book_url: primary?.book_url,
      name: book.name,
      author: book.author,
    },
  });
}
</script>

<template>
  <div>
    <TopBar title="发现" />

    <div class="search">
      <n-input
        v-model:value="keyword"
        placeholder="搜书名或作者"
        clearable
        size="large"
        :input-props="{ enterkeyhint: 'search', autocapitalize: 'off', autocorrect: 'off' }"
        @keyup.enter="run()"
      >
        <template #prefix><n-icon><SearchOutline /></n-icon></template>
      </n-input>
      <n-button type="primary" size="large" :loading="loading" @click="run()">搜索</n-button>
    </div>

    <section v-if="!page && !loading && history.length" class="history">
      <div class="history__head">
        <span>最近搜索</span>
        <n-button text size="tiny" @click="clear">清空</n-button>
      </div>
      <div class="history__items">
        <n-tag
          v-for="item in history"
          :key="item"
          closable
          size="small"
          @click="run(item)"
          @close="forget(item)"
        >
          {{ item }}
        </n-tag>
      </div>
    </section>

    <SkeletonList v-if="loading" :rows="5" />

    <n-result
      v-else-if="error"
      status="error"
      title="搜索失败"
      :description="error"
      class="state"
    >
      <template #footer><n-button @click="run()">重试</n-button></template>
    </n-result>

    <template v-else-if="page">
      <p class="stats">
        {{ page.sources_ok }}/{{ page.sources_tried }} 个源有响应，命中 {{ page.total }} 本
        <span v-if="page.js_skipped" class="stats__js">
          · {{ page.js_skipped }} 个源需要 JS，当前版本不支持
        </span>
      </p>

      <n-empty v-if="!items.length && needsScan" description="候选源池还是空的" class="state">
        <template #extra>
          <p class="hint">
            第一次使用需要先扫描本地源归档。在管理端执行一次
            <code>POST /api/v1/reader/scan</code>，或让管理员跑一次扫描。
          </p>
        </template>
      </n-empty>

      <n-empty
        v-else-if="!items.length && allSourcesFailed"
        description="所有源都没有响应"
        class="state"
      >
        <template #extra>
          <p class="hint">不是没搜到，是源站这次都没答上来。稍后重试，或换个关键词。</p>
          <n-button @click="run()">重试</n-button>
        </template>
      </n-empty>

      <n-empty v-else-if="!items.length" description="没有找到这本书" class="state">
        <template #extra><p class="hint">换个书名或作者再试试。</p></template>
      </n-empty>

      <n-list v-else hoverable clickable>
        <n-list-item v-for="book in items" :key="book.book_key" @click="open(book)">
          <BookCard
            :name="book.name"
            :author="book.author"
            :cover-url="book.cover_url"
            :intro="book.intro"
            :last-chapter="book.last_chapter"
            :source-count="book.sources.length"
          />
        </n-list-item>
      </n-list>

      <div v-if="hasMore" class="more">
        <n-button :loading="loadingMore" block @click="more">加载更多</n-button>
      </div>
    </template>

    <n-empty v-else description="输入关键词开始搜索" class="state">
      <template #icon><n-icon size="40"><SearchOutline /></n-icon></template>
    </n-empty>
  </div>
</template>

<style scoped>
.search {
  display: flex;
  gap: var(--space-2);
  padding: var(--space-3);
}

.history {
  padding: 0 var(--space-3) var(--space-3);
}

.history__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--space-2);
  font-size: 12px;
  color: var(--text-muted);
}

.history__items {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.stats {
  margin: 0;
  padding: var(--space-2) var(--space-3);
  font-size: 12px;
  color: var(--text-muted);
}

.stats__js {
  color: #f0a020;
}

.state {
  padding: var(--space-6) var(--space-4);
}

.hint {
  max-width: 36ch;
  margin: 0 auto var(--space-3);
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-muted);
}

.more {
  padding: var(--space-3);
}
</style>
