<script setup lang="ts">
/** 书架（C 端首页）。网格 / 列表两种视图，排序纯前端做，不加接口。 */
import { GridOutline, ListOutline, SearchOutline } from "@vicons/ionicons5";
import { useMessage } from "naive-ui";
import { computed, onActivated, onMounted, ref } from "vue";
import { useRouter } from "vue-router";

import { api } from "../../api/client";
import type { ShelfBook } from "../../api/types";
import BookCover from "../../components/web/BookCover.vue";
import SkeletonList from "../../components/web/SkeletonList.vue";
import TopBar from "../../components/web/TopBar.vue";

type ViewMode = "grid" | "list";
type SortKey = "recent" | "added" | "name";

const VIEW_KEY = "funread.shelf.view";
const SORT_KEY = "funread.shelf.sort";

const router = useRouter();
const message = useMessage();

const books = ref<ShelfBook[]>([]);
const loading = ref(true);
const error = ref("");
const mode = ref<ViewMode>((localStorage.getItem(VIEW_KEY) as ViewMode) || "grid");
const sort = ref<SortKey>((localStorage.getItem(SORT_KEY) as SortKey) || "recent");

const SORT_OPTIONS = [
  { label: "最近阅读", value: "recent" },
  { label: "加入时间", value: "added" },
  { label: "书名", value: "name" },
];

const sorted = computed(() => {
  const list = [...books.value];
  if (sort.value === "name") return list.sort((a, b) => a.name.localeCompare(b.name, "zh"));
  //  后端已按 updated_at 倒序给了，「最近阅读」就是原序；「加入时间」没有单独
  //  的字段，用 book_key 稳定排一下，至少是确定的顺序而不是随机的。
  if (sort.value === "added") return list.sort((a, b) => a.book_key.localeCompare(b.book_key));
  return list;
});

async function load() {
  loading.value = true;
  error.value = "";
  try {
    books.value = await api.shelf();
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : "加载失败";
  } finally {
    loading.value = false;
  }
}

function setMode(value: ViewMode) {
  mode.value = value;
  localStorage.setItem(VIEW_KEY, value);
}

function setSort(value: SortKey) {
  sort.value = value;
  localStorage.setItem(SORT_KEY, value);
}

/** 点书架项 = 续读。没有进度就去详情页选章。 */
function open(book: ShelfBook) {
  if (book.progress && book.url_id) {
    router.push({
      name: "read",
      params: { bookKey: book.book_key },
      query: { chapter: String(book.progress.chapter_index) },
    });
    return;
  }
  router.push({ name: "book", params: { bookKey: book.book_key } });
}

async function remove(book: ShelfBook) {
  try {
    await api.removeFromShelf(book.book_key);
    books.value = books.value.filter((item) => item.book_key !== book.book_key);
    message.success(`已移出书架：${book.name}`);
  } catch (reason) {
    message.error(reason instanceof Error ? reason.message : "移出失败");
  }
}

onMounted(load);
//  从正文页返回时进度变了，书架上的「读到第 N 章」要跟着更新
onActivated(load);
</script>

<template>
  <div>
    <TopBar title="书架">
      <template #actions>
        <n-button quaternary circle aria-label="搜索" @click="router.push({ name: 'search' })">
          <template #icon><n-icon><SearchOutline /></n-icon></template>
        </n-button>
        <n-button
          quaternary
          circle
          :aria-label="mode === 'grid' ? '切换到列表视图' : '切换到网格视图'"
          @click="setMode(mode === 'grid' ? 'list' : 'grid')"
        >
          <template #icon>
            <n-icon><ListOutline v-if="mode === 'grid'" /><GridOutline v-else /></n-icon>
          </template>
        </n-button>
      </template>
    </TopBar>

    <SkeletonList v-if="loading" :rows="4" />

    <n-result
      v-else-if="error"
      status="error"
      title="书架加载失败"
      :description="error"
      class="state"
    >
      <template #footer><n-button @click="load">重试</n-button></template>
    </n-result>

    <n-empty v-else-if="!books.length" description="书架还是空的" class="state">
      <template #extra>
        <n-button type="primary" @click="router.push({ name: 'search' })">去找书</n-button>
      </template>
    </n-empty>

    <template v-else>
      <div class="toolbar">
        <n-select
          :value="sort"
          :options="SORT_OPTIONS"
          size="small"
          class="toolbar__sort"
          @update:value="setSort"
        />
        <span class="toolbar__count">{{ books.length }} 本</span>
      </div>

      <ul v-if="mode === 'grid'" class="grid">
        <li v-for="book in sorted" :key="book.book_key">
          <button type="button" class="grid__item" @click="open(book)">
            <BookCover :src="book.cover_url" :name="book.name" :width="100" :height="138" />
            <span class="grid__name">{{ book.name }}</span>
            <span v-if="book.progress" class="grid__progress">
              读到第 {{ book.progress.chapter_index + 1 }} 章
            </span>
            <span v-else class="grid__progress grid__progress--none">未开始</span>
          </button>
        </li>
      </ul>

      <n-list v-else hoverable clickable>
        <n-list-item v-for="book in sorted" :key="book.book_key">
          <div class="row" @click="open(book)">
            <BookCover :src="book.cover_url" :name="book.name" :width="48" :height="66" />
            <div class="row__body">
              <p class="row__name">{{ book.name }}</p>
              <p class="row__meta">{{ book.author || "未知作者" }}</p>
              <p class="row__progress">
                {{
                  book.progress
                    ? `读到第 ${book.progress.chapter_index + 1} 章${book.progress.chapter_name ? ` · ${book.progress.chapter_name}` : ""}`
                    : "未开始"
                }}
              </p>
            </div>
          </div>
          <template #suffix>
            <n-popconfirm @positive-click="remove(book)">
              <template #trigger>
                <n-button quaternary size="small" @click.stop>移出</n-button>
              </template>
              移出书架会同时删掉这本书的阅读进度，确定吗？
            </n-popconfirm>
          </template>
        </n-list-item>
      </n-list>
    </template>
  </div>
</template>

<style scoped>
.state {
  padding: var(--space-6) var(--space-4);
}

.toolbar {
  display: flex;
  gap: var(--space-2);
  align-items: center;
  justify-content: space-between;
  padding: var(--space-2) var(--space-3);
}

.toolbar__sort {
  width: 130px;
}

.toolbar__count {
  font-size: 12px;
  color: var(--text-muted);
}

.grid {
  display: grid;
  /* auto-fill + minmax：小屏两列、大屏自动变多列，不用写断点 */
  grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
  gap: var(--space-4) var(--space-3);
  margin: 0;
  padding: var(--space-3);
  list-style: none;
}

.grid__item {
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 100%;
  padding: 0;
  color: inherit;
  text-align: left;
  background: none;
  border: none;
  cursor: pointer;
}

.grid__name {
  overflow: hidden;
  font-size: 13px;
  font-weight: 500;
  line-height: 1.3;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.grid__progress {
  font-size: 11px;
  color: var(--accent);
}

.grid__progress--none {
  color: var(--text-muted);
}

.row {
  display: flex;
  flex: 1;
  gap: var(--space-3);
  align-items: center;
  cursor: pointer;
}

.row__body {
  min-width: 0;
  flex: 1;
}

.row__name {
  margin: 0 0 2px;
  overflow: hidden;
  font-size: 14px;
  font-weight: 600;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.row__meta,
.row__progress {
  margin: 0;
  font-size: 12px;
  color: var(--text-muted);
}

.row__progress {
  color: var(--accent);
}
</style>
