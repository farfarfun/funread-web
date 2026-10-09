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

const PAGE_SIZE = 30;

const router = useRouter();
const message = useMessage();

/** 三层导航用一个 step 表示，不开三个路由 —— 返回体验更像原生抽屉。 */
const step = ref<"sources" | "kinds" | "books">("sources");

const sources = ref<ExploreSource[]>([]);
const sourcesTotal = ref(0);
const keyword = ref("");

const source = ref<ExploreSource | null>(null);
const kinds = ref<ExploreKind[]>([]);
const kind = ref<ExploreKind | null>(null);

const books = ref<SearchBook[]>([]);
const page = ref(1);
const hasMore = ref(false);

const loading = ref(true);
const loadingMore = ref(false);
const error = ref("");

const title = computed(() => {
  if (step.value === "books" && kind.value) return `${source.value?.name} · ${kind.value.name}`;
  if (step.value === "kinds") return source.value?.name ?? "分类";
  return "发现";
});

async function loadSources(reset = true) {
  if (reset) {
    loading.value = true;
    sources.value = [];
  } else {
    loadingMore.value = true;
  }
  error.value = "";
  try {
    const result = await api.exploreSources({
      q: keyword.value.trim(),
      limit: PAGE_SIZE,
      offset: reset ? 0 : sources.value.length,
    });
    sources.value = reset ? result.items : [...sources.value, ...result.items];
    sourcesTotal.value = result.total;
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : "加载失败";
  } finally {
    loading.value = false;
    loadingMore.value = false;
  }
}

async function openSource(item: ExploreSource) {
  source.value = item;
  step.value = "kinds";
  loading.value = true;
  error.value = "";
  try {
    kinds.value = await api.exploreKinds(item.url_id);
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : "分类加载失败";
  } finally {
    loading.value = false;
  }
}

async function openKind(item: ExploreKind, nextPage = 1) {
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
    //  按 book_key 去重：源站翻页经常把上一页的条目又给一遍
    const seen = new Set(books.value.map((book) => book.book_key));
    const fresh = result.items.filter((book) => !seen.has(book.book_key));
    books.value = nextPage === 1 ? result.items : [...books.value, ...fresh];
    page.value = nextPage;
    //  源不会告诉我们总页数，所以「还有更多」= 这一页拿到了东西。
    //  拿到空页就说明到底了。
    hasMore.value = result.items.length > 0;
  } catch (reason) {
    if (nextPage === 1) error.value = reason instanceof Error ? reason.message : "加载失败";
    else message.error(reason instanceof Error ? reason.message : "加载更多失败");
  } finally {
    loading.value = false;
    loadingMore.value = false;
  }
}

function back() {
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
    <TopBar :title="title" :back="step !== 'sources'" fallback="/web/explore">
      <template #actions>
        <n-button quaternary circle aria-label="搜索" @click="router.push({ name: 'search' })">
          <template #icon><n-icon><SearchOutline /></n-icon></template>
        </n-button>
      </template>
    </TopBar>

    <!-- 自己的返回按钮：三层在一个路由里，TopBar 的 history 返回会直接离开本页 -->
    <div v-if="step !== 'sources'" class="crumb">
      <n-button text size="small" @click="back">
        ‹ {{ step === "books" ? "回到分类" : "回到源列表" }}
      </n-button>
    </div>

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
          clearable
          @keyup.enter="loadSources()"
          @clear="loadSources()"
        >
          <template #prefix><n-icon><SearchOutline /></n-icon></template>
        </n-input>
        <n-button type="primary" @click="loadSources()">搜索</n-button>
      </div>

      <n-empty v-if="!sources.length" description="没有可浏览分类的源" class="state">
        <template #extra>
          <p class="hint">
            发现页需要源自带分类规则（<code>exploreUrl</code>）。如果这里是空的，
            先在管理端跑一次 <code>POST /api/v1/reader/scan</code>。
          </p>
        </template>
      </n-empty>

      <template v-else>
        <p class="stats">{{ sourcesTotal }} 个源可以按分类浏览</p>
        <n-list hoverable clickable>
          <n-list-item v-for="item in sources" :key="item.url_id" @click="openSource(item)">
            <div class="row">
              <div class="row__body">
                <p class="row__name">{{ item.name }}</p>
                <p v-if="item.kinds.length" class="row__kinds">
                  {{ item.kinds.slice(0, 6).join(" · ")
                  }}{{ item.kinds.length > 6 ? ` …共 ${item.kinds.length} 个` : "" }}
                </p>
              </div>
              <n-icon class="row__arrow" size="16"><ChevronForwardOutline /></n-icon>
            </div>
          </n-list-item>
        </n-list>
        <div v-if="sources.length < sourcesTotal" class="more">
          <n-button :loading="loadingMore" block @click="loadSources(false)">加载更多</n-button>
        </div>
      </template>
    </template>

    <!-- 第二层：选分类 -->
    <template v-else-if="step === 'kinds'">
      <n-empty v-if="!kinds.length" description="这个源没有可浏览的分类" class="state" />
      <div v-else class="kinds">
        <n-button
          v-for="item in kinds"
          :key="item.url"
          class="kinds__item"
          @click="openKind(item)"
        >
          {{ item.name }}
        </n-button>
      </div>
    </template>

    <!-- 第三层：书列表 -->
    <template v-else>
      <n-empty v-if="!books.length" description="这个分类下没有书" class="state">
        <template #extra><n-button @click="openKind(kind!)">重试</n-button></template>
      </n-empty>
      <template v-else>
        <n-list hoverable clickable>
          <n-list-item v-for="book in books" :key="book.book_key" @click="open(book)">
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
          <n-button :loading="loadingMore" block @click="openKind(kind!, page + 1)">
            第 {{ page + 1 }} 页
          </n-button>
        </div>
        <p v-else class="end">没有更多了</p>
      </template>
    </template>
  </div>
</template>

<style scoped>
.crumb {
  padding: var(--space-2) var(--space-3) 0;
}

.search {
  display: flex;
  gap: var(--space-2);
  padding: var(--space-3);
}

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

.row {
  display: flex;
  flex: 1;
  gap: var(--space-2);
  align-items: center;
}

.row__body {
  min-width: 0;
  flex: 1;
}

.row__name {
  margin: 0 0 2px;
  overflow: hidden;
  font-size: 14px;
  font-weight: 500;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.row__kinds {
  margin: 0;
  overflow: hidden;
  font-size: 11px;
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
  /* 分类名短，宽屏上自然排多列 */
  grid-template-columns: repeat(auto-fill, minmax(104px, 1fr));
  gap: var(--space-2);
  padding: var(--space-3);
}

.kinds__item {
  width: 100%;
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
