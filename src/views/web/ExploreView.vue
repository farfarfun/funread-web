<script setup lang="ts">
/**
 * 发现页：按分类浏览，而不是先想好搜什么。
 *
 * 三层：源列表 → 这个源的分类 → 分类下的书。层级是源决定的 —— 每个源的分类体系
 * 完全不同（有的按「玄幻/都市」，有的按「月榜/完结」），所以不可能跨源合并成一个
 * 统一的分类树。这也是为什么第一层必须是选源。
 *
 * 和搜索的分工：搜索是「我知道要什么」，发现是「给我看看有什么」。两者的后端完全
 * 不同（搜索跨源 fan-out，浏览是单源），但返回形状一致，所以详情页那条链不变。
 */
import { ChevronForwardOutline, SearchOutline } from "@vicons/ionicons5";
import { useMessage } from "naive-ui";
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";

import { api } from "../../api/client";
import type { ExploreKind, ExploreSource, SearchBook } from "../../api/types";
import BookCard from "../../components/web/BookCard.vue";
import SkeletonList from "../../components/web/SkeletonList.vue";
import TopBar from "../../components/web/TopBar.vue";
import { useAuth } from "../../composables/useAuth";

const PAGE_SIZE = 30;

const router = useRouter();
const message = useMessage();
const { isAdmin } = useAuth();

/** 三层导航用一个 step 表示，不开三个路由 —— 返回体验更像原生抽屉。 */
const step = ref<"sources" | "kinds" | "books">("sources");

const sources = ref<ExploreSource[]>([]);
const sourcesTotal = ref(0);
const keyword = ref("");
const activeQuery = ref("");

const source = ref<ExploreSource | null>(null);
const kinds = ref<ExploreKind[]>([]);
const kind = ref<ExploreKind | null>(null);

const books = ref<SearchBook[]>([]);
const page = ref(1);
const hasMore = ref(false);

const loading = ref(true);
const loadingMore = ref(false);
const error = ref("");
let requestVersion = 0;

const title = computed(() => {
  if (step.value === "books" && kind.value) return `${source.value?.name} · ${kind.value.name}`;
  if (step.value === "kinds") return source.value?.name ?? "分类";
  return "发现";
});

async function loadSources(reset = true) {
  const version = ++requestVersion;
  if (reset) {
    activeQuery.value = keyword.value.trim();
    loading.value = true;
    sources.value = [];
  } else {
    loadingMore.value = true;
  }
  error.value = "";
  try {
    const result = await api.exploreSources({
      q: activeQuery.value,
      limit: PAGE_SIZE,
      offset: reset ? 0 : sources.value.length,
    });
    if (version !== requestVersion) return;
    sources.value = reset ? result.items : [...sources.value, ...result.items];
    sourcesTotal.value = result.total;
  } catch (reason) {
    if (version !== requestVersion) return;
    error.value = reason instanceof Error ? reason.message : "加载失败";
  } finally {
    if (version === requestVersion) {
      loading.value = false;
      loadingMore.value = false;
    }
  }
}

async function openSource(item: ExploreSource) {
  const version = ++requestVersion;
  source.value = item;
  step.value = "kinds";
  kinds.value = [];
  kind.value = null;
  loading.value = true;
  error.value = "";
  try {
    const result = await api.exploreKinds(item.url_id);
    if (version !== requestVersion) return;
    kinds.value = result;
  } catch (reason) {
    if (version !== requestVersion) return;
    error.value = reason instanceof Error ? reason.message : "分类加载失败";
  } finally {
    if (version === requestVersion) loading.value = false;
  }
}

async function openKind(item: ExploreKind, nextPage = 1) {
  const version = ++requestVersion;
  kind.value = item;
  step.value = "books";
  if (nextPage === 1) {
    loading.value = true;
    books.value = [];
  } else {
    loadingMore.value = true;
  }
  error.value = "";
  try {
    const result = await api.explore({
      url_id: source.value!.url_id,
      url: item.url,
      page: nextPage,
    });
    if (version !== requestVersion) return;
    //  按 book_key 去重：源站翻页经常把上一页的条目又给一遍
    const seen = new Set(books.value.map((book) => book.book_key));
    const fresh = result.items.filter((book) => !seen.has(book.book_key));
    books.value = nextPage === 1 ? result.items : [...books.value, ...fresh];
    page.value = nextPage;
    //  源不会告诉我们总页数，所以「还有更多」= 这一页拿到了东西。
    //  拿到空页就说明到底了。
    hasMore.value = result.items.length > 0;
  } catch (reason) {
    if (version !== requestVersion) return;
    if (nextPage === 1) error.value = reason instanceof Error ? reason.message : "加载失败";
    else message.error(reason instanceof Error ? reason.message : "加载更多失败");
  } finally {
    if (version === requestVersion) {
      loading.value = false;
      loadingMore.value = false;
    }
  }
}

function back() {
  requestVersion += 1;
  loading.value = false;
  loadingMore.value = false;
  error.value = "";
  if (step.value === "books") {
    step.value = "kinds";
    books.value = [];
    return;
  }
  if (step.value === "kinds") {
    step.value = "sources";
    kinds.value = [];
    source.value = null;
  }
}

function open(book: SearchBook) {
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

onMounted(() => loadSources());
</script>

<template>
  <div>
    <TopBar :title="title" :back="step !== 'sources'" :back-action="back" :back-label="step === 'books' ? '返回分类' : '返回源列表'">
      <template #actions>
        <n-button quaternary circle aria-label="搜索" @click="router.push({ name: 'search' })">
          <template #icon><n-icon><SearchOutline /></n-icon></template>
        </n-button>
      </template>
    </TopBar>

    <SkeletonList v-if="loading" :rows="5" :cover="step === 'books'" />

    <n-result v-else-if="error" status="warning" title="打不开" :description="error" class="state">
      <template #footer>
        <n-button v-if="step === 'sources'" @click="loadSources()">重试</n-button>
        <n-button v-else-if="step === 'kinds'" @click="openSource(source!)">重试</n-button>
        <n-button v-else @click="openKind(kind!)">重试</n-button>
        <n-button v-if="step !== 'sources'" text @click="back">返回</n-button>
      </template>
    </n-result>

    <!-- 第一层：选源 -->
    <template v-else-if="step === 'sources'">
      <div class="search">
        <n-input
          v-model:value="keyword"
          placeholder="搜源名"
          :input-props="{ 'aria-label': '源名称' }"
          clearable
          @keyup.enter="loadSources()"
          @clear="loadSources()"
        >
          <template #prefix><n-icon><SearchOutline /></n-icon></template>
        </n-input>
        <n-button type="primary" :loading="loading" @click="loadSources()">搜索</n-button>
      </div>

      <n-empty v-if="!sources.length" description="没有可浏览分类的源" class="state">
        <template #extra>
          <n-button v-if="isAdmin" @click="router.push({ name: 'admin-pool' })">前往候选源池</n-button>
          <p v-else class="hint">请管理员在候选源池扫描书源。</p>
        </template>
      </n-empty>

      <template v-else>
        <p class="stats">{{ sourcesTotal }} 个源可以按分类浏览</p>
        <div class="source-list">
          <button v-for="item in sources" :key="item.url_id" type="button" class="source-row" @click="openSource(item)">
            <span class="row__body">
              <span class="row__name">{{ item.name }}</span>
              <span v-if="item.kinds.length" class="row__kinds">
                  {{ item.kinds.slice(0, 6).join(" · ")
                  }}{{ item.kinds.length > 6 ? ` …共 ${item.kinds.length} 个` : "" }}
              </span>
            </span>
            <n-icon class="row__arrow" size="16"><ChevronForwardOutline /></n-icon>
          </button>
        </div>
        <div v-if="sources.length < sourcesTotal" class="more">
          <n-button :loading="loadingMore" block @click="loadSources(false)">加载更多</n-button>
        </div>
      </template>
    </template>

    <!-- 第二层：选分类 -->
    <template v-else-if="step === 'kinds'">
      <n-empty v-if="!kinds.length" description="这个源没有可浏览的分类" class="state" />
      <div v-else class="kinds">
        <button
          v-for="item in kinds"
          :key="item.url"
          type="button"
          class="kinds__item"
          @click="openKind(item)"
        >
          <span>{{ item.name }}</span><n-icon size="16"><ChevronForwardOutline /></n-icon>
        </button>
      </div>
    </template>

    <!-- 第三层：书列表 -->
    <template v-else>
      <n-empty v-if="!books.length" description="这个分类下没有书" class="state">
        <template #extra><n-button @click="openKind(kind!)">重试</n-button></template>
      </n-empty>
      <template v-else>
        <n-list hoverable clickable>
          <n-list-item v-for="book in books" :key="book.book_key" role="button" tabindex="0" @click="open(book)" @keyup.enter="open(book)" @keyup.space.prevent="open(book)">
            <BookCard
              :name="book.name"
              :author="book.author"
              :cover-url="book.cover_url"
              :intro="book.intro"
              :last-chapter="book.last_chapter"
            />
          </n-list-item>
        </n-list>
        <div v-if="hasMore" class="more">
          <n-button :loading="loadingMore" block @click="openKind(kind!, page + 1)">加载更多</n-button>
        </div>
        <p v-else class="end">没有更多了</p>
      </template>
    </template>
  </div>
</template>

<style scoped>
.search {
  display: flex;
  gap: var(--space-2);
  padding: var(--space-3);
}

.search .n-input { min-width: 0; }

.state {
  padding: var(--space-6) var(--space-4);
}

.hint {
  max-width: 38ch;
  margin: 0 auto;
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-muted);
}

.stats {
  margin: 0;
  padding: 0 var(--space-3) var(--space-2);
  font-size: 12px;
  color: var(--text-muted);
}

.source-list {
  border-top: 1px solid var(--border-subtle);
}

.source-row {
  display: flex;
  width: 100%;
  min-height: 72px;
  gap: var(--space-3);
  align-items: center;
  padding: var(--space-3) var(--space-4);
  color: inherit;
  text-align: left;
  background: var(--surface-raised);
  border: 0;
  border-bottom: 1px solid var(--border-subtle);
  cursor: pointer;
  transition: background 0.18s var(--ease);
}

.source-row:hover,
.source-row:active {
  background: var(--surface-sunken);
}

.row__body {
  display: grid;
  gap: 3px;
  min-width: 0;
  flex: 1;
}

.row__name {
  font-size: 15px;
  font-weight: 600;
  overflow-wrap: anywhere;
}

.row__kinds {
  overflow: hidden;
  font-size: 12px;
  color: var(--text-muted);
  white-space: nowrap;
  text-overflow: ellipsis;
}

.row__arrow {
  flex-shrink: 0;
  color: var(--text-muted);
}

.kinds {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 180px), 1fr));
  gap: var(--space-2);
  padding: var(--space-3);
}

.kinds__item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  width: 100%;
  min-height: 52px;
  padding: var(--space-2) var(--space-3);
  color: inherit;
  font: inherit;
  text-align: left;
  background: var(--surface-raised);
  border: 1px solid var(--border-subtle);
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.18s var(--ease), border-color 0.18s var(--ease);
}

.kinds__item span {
  min-width: 0;
  overflow-wrap: anywhere;
}

.kinds__item .n-icon {
  flex: none;
  color: var(--text-muted);
}

.kinds__item:hover,
.kinds__item:active {
  background: var(--accent-soft);
  border-color: var(--accent);
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
