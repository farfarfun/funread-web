<script setup lang="ts">
/**
 * 书籍详情 + 目录 + 换源 + 离线下载。
 *
 * 一个关键约定：`BookInfo` 必须**整体**保存并回传给 `/toc` 与 `/content`。
 * 规则会在详情页用 `@put` 存变量、在目录页用 `@get` 取 —— 丢掉 `variables`
 * 这类源就会静默读到空目录，而且看着像「这本书没有章节」。
 */
import { CloudDownloadOutline, SearchOutline, SwapHorizontalOutline } from "@vicons/ionicons5";
import { useMessage } from "naive-ui";
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";

import { api } from "../../api/client";
import type {
  BookInfo,
  Chapter,
  DownloadProgress,
  ShelfBook,
  SwitchCandidate,
  SwitchSourcePage,
  SwitchSourceResult,
} from "../../api/types";
import BookCover from "../../components/web/BookCover.vue";
import ChapterList from "../../components/web/ChapterList.vue";
import SkeletonList from "../../components/web/SkeletonList.vue";
import SwitchSourceDrawer from "../../components/web/SwitchSourceDrawer.vue";
import TopBar from "../../components/web/TopBar.vue";

/** 一次下载的章节上限，和后端的 MAX_DOWNLOAD_CHAPTERS 对齐。 */
const DOWNLOAD_BATCH = 200;
const POLL_MS = 1500;

const route = useRoute();
const router = useRouter();
const message = useMessage();

const bookKey = computed(() => String(route.params.bookKey));

const info = ref<BookInfo | null>(null);
const chapters = ref<Chapter[]>([]);
const shelfBook = ref<ShelfBook | null>(null);
const switchPage = ref<SwitchSourcePage | null>(null);
const switchError = ref("");
const cachedIndexes = ref<number[]>([]);
const downloading = ref<DownloadProgress | null>(null);

const loading = ref(true);
const tocLoading = ref(false);
const error = ref("");
const tocError = ref("");
const introExpanded = ref(false);
const reversed = ref(false);
const chapterFilter = ref("");
const showSources = ref(false);
const sourcesLoading = ref(false);

let pollTimer: number | undefined;

const urlId = computed(() => {
  const fromQuery = Number(route.query.url_id);
  if (Number.isFinite(fromQuery) && fromQuery > 0) return fromQuery;
  return shelfBook.value?.url_id ?? 0;
});

/** 换源结果的中文说明。方式不同，用户要做的事不同。 */
function describeSwitch(result: SwitchSourceResult, sourceName: string): string {
  const where = sourceName ? `「${sourceName}」` : "新源";
  const position = `第 ${result.chapter_index + 1} / ${result.total} 章`;
  switch (result.method) {
    case "exact":
      return `已切换到${where}，定位到${position}`;
    case "normalized":
      return `已切换到${where}，按章节名定位到${position}`;
    case "position":
      return `已切换到${where}，按位置估到${position}，可能有偏差`;
    case "none":
      return `已切换到${where}，但没取到目录，请手动选章`;
    default:
      return `已切换到${where}`;
  }
}

const onShelf = computed(() => shelfBook.value !== null);
const currentIndex = computed(() => shelfBook.value?.progress?.chapter_index ?? -1);

async function loadInfo() {
  loading.value = true;
  error.value = "";
  try {
    //  先看书架：书架上有的话，当前源与进度都从那里来，不必依赖 query。
    const shelf = await api.shelf().catch(() => [] as ShelfBook[]);
    shelfBook.value = shelf.find((item) => item.book_key === bookKey.value) ?? null;

    const id = urlId.value;
    const bookUrl = String(route.query.book_url || shelfBook.value?.book_url || "");
    if (!id || !bookUrl) {
      error.value = "缺少来源信息，请从搜索结果进入";
      return;
    }
    info.value = await api.bookInfo({
      url_id: id,
      book_url: bookUrl,
      name: String(route.query.name || shelfBook.value?.name || ""),
      author: String(route.query.author || shelfBook.value?.author || ""),
    });
    await loadToc();
    if (onShelf.value) await refreshCache();
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : "加载失败";
  } finally {
    loading.value = false;
  }
}

async function loadToc() {
  if (!info.value || !urlId.value) return;
  tocLoading.value = true;
  tocError.value = "";
  try {
    const result = await api.toc(urlId.value, info.value);
    chapters.value = result.items;
  } catch (reason) {
    tocError.value = reason instanceof Error ? reason.message : "目录加载失败";
  } finally {
    tocLoading.value = false;
  }
}

async function addToShelf() {
  if (!info.value) return;
  try {
    await api.addToShelf({
      name: info.value.name,
      author: info.value.author,
      cover_url: info.value.cover_url,
      intro: info.value.intro,
      url_id: urlId.value,
      book_url: info.value.book_url,
      toc_url: info.value.toc_url,
      last_chapter: info.value.last_chapter,
    });
    message.success("已加入书架");
    const shelf = await api.shelf();
    shelfBook.value = shelf.find((item) => item.book_key === bookKey.value) ?? null;
    await refreshCache();
  } catch (reason) {
    message.error(reason instanceof Error ? reason.message : "加入失败");
  }
}

async function removeFromShelf() {
  try {
    await api.removeFromShelf(bookKey.value);
    shelfBook.value = null;
    cachedIndexes.value = [];
    message.success("已移出书架");
  } catch (reason) {
    message.error(reason instanceof Error ? reason.message : "移出失败");
  }
}

async function openSources() {
  showSources.value = true;
  //  每次都重搜。这是实时聚合搜索而不是查库 —— 缓存住上一次的结果就等于
  //  「源挂了之后换源列表还是那批挂掉的源」，恰好在最需要它的时候没用。
  await loadSources();
}

async function loadSources() {
  sourcesLoading.value = true;
  switchError.value = "";
  try {
    switchPage.value = await api.sourcesFor(bookKey.value);
  } catch (reason) {
    switchError.value = reason instanceof Error ? reason.message : "换源列表加载失败";
  } finally {
    sourcesLoading.value = false;
  }
}

async function switchTo(source: SwitchCandidate) {
  try {
    const result = await api.switchSource(bookKey.value, source.url_id, source.book_url);
    showSources.value = false;
    const text = describeSwitch(result, source.source_name);
    if (result.method === "none" || result.is_approximate) message.warning(text);
    else message.success(text);
    //  换源后目录序号会变，必须整条链重算，不能只换个 url_id
    await router.replace({
      name: "book",
      params: { bookKey: bookKey.value },
      query: { url_id: String(source.url_id), book_url: source.book_url },
    });
    await loadInfo();
  } catch (reason) {
    message.error(reason instanceof Error ? reason.message : "换源失败");
  }
}

async function refreshCache() {
  try {
    const state = await api.cached(bookKey.value);
    cachedIndexes.value = state.chapter_indexes;
    downloading.value = state.downloading;
    if (state.downloading?.state === "running") schedulePoll();
    else stopPoll();
  } catch {
    //  书不在架上时这是 404，属正常
  }
}

function schedulePoll() {
  stopPoll();
  pollTimer = window.setTimeout(refreshCache, POLL_MS);
}

function stopPoll() {
  if (pollTimer) window.clearTimeout(pollTimer);
  pollTimer = undefined;
}

async function download() {
  if (!chapters.value.length) return;
  //  只排还没缓存的，并截到后端的批量上限
  const cached = new Set(cachedIndexes.value);
  const pending = chapters.value.filter((c) => !cached.has(c.index)).slice(0, DOWNLOAD_BATCH);
  if (!pending.length) {
    message.info("这些章节都已经下载过了");
    return;
  }
  try {
    const accepted = await api.download(bookKey.value, urlId.value, pending, 0.3);
    message.success(`已排入 ${accepted.queued} 章，可以离线读了`);
    await refreshCache();
  } catch (reason) {
    message.error(reason instanceof Error ? reason.message : "下载失败");
  }
}

async function clearCache() {
  try {
    await api.clearCache(bookKey.value);
    cachedIndexes.value = [];
    message.success("已清空缓存");
  } catch (reason) {
    message.error(reason instanceof Error ? reason.message : "清空失败");
  }
}

function read(chapter: Chapter) {
  router.push({
    name: "read",
    params: { bookKey: bookKey.value },
    query: { chapter: String(chapter.index), url_id: String(urlId.value) },
  });
}

onMounted(loadInfo);
</script>

<template>
  <div>
    <TopBar :title="info?.name || '书籍详情'" back fallback="/web/search">
      <template #actions>
        <n-button v-if="onShelf" quaternary circle aria-label="换源" @click="openSources">
          <template #icon><n-icon><SwapHorizontalOutline /></n-icon></template>
        </n-button>
      </template>
    </TopBar>

    <SkeletonList v-if="loading" :rows="3" />

    <n-result v-else-if="error" status="warning" title="打不开这本书" :description="error" class="state">
      <template #footer>
        <n-button @click="loadInfo">重试</n-button>
        <n-button text @click="router.push({ name: 'search' })">回去搜索</n-button>
      </template>
    </n-result>

    <template v-else-if="info">
      <section class="hero">
        <BookCover :src="info.cover_url" :name="info.name" :width="96" :height="132" />
        <div class="hero__body">
          <h2 class="hero__title">{{ info.name }}</h2>
          <p class="hero__meta">{{ info.author || "未知作者" }}</p>
          <p v-if="info.kind || info.word_count" class="hero__meta">
            <span v-if="info.kind">{{ info.kind }}</span>
            <span v-if="info.word_count">{{ info.word_count }}</span>
          </p>
          <p class="hero__source">来源：{{ info.source_name || "未知" }}</p>
        </div>
      </section>

      <div class="actions">
        <n-button v-if="!onShelf" type="primary" block @click="addToShelf">加入书架</n-button>
        <template v-else>
          <n-button
            type="primary"
            block
            :disabled="!chapters.length"
            @click="read(chapters[Math.max(0, currentIndex)] ?? chapters[0])"
          >
            {{ currentIndex >= 0 ? `续读第 ${currentIndex + 1} 章` : "开始阅读" }}
          </n-button>
          <n-popconfirm @positive-click="removeFromShelf">
            <template #trigger><n-button quaternary>移出</n-button></template>
            移出书架会同时删掉阅读进度，确定吗？
          </n-popconfirm>
        </template>
      </div>

      <section v-if="info.intro" class="intro">
        <p class="intro__text" :class="{ 'intro__text--clamped': !introExpanded }">
          {{ info.intro }}
        </p>
        <n-button text size="tiny" @click="introExpanded = !introExpanded">
          {{ introExpanded ? "收起" : "展开" }}
        </n-button>
      </section>

      <section v-if="onShelf" class="offline">
        <div class="offline__head">
          <span>离线下载</span>
          <span class="offline__count">已缓存 {{ cachedIndexes.length }} 章</span>
        </div>
        <n-progress
          v-if="downloading"
          type="line"
          :percentage="downloading.total ? Math.round((downloading.done / downloading.total) * 100) : 0"
          :status="downloading.state === 'error' ? 'error' : 'default'"
          :indicator-placement="'inside'"
        />
        <p v-if="downloading?.state === 'error'" class="offline__error">
          下载失败：{{ downloading.detail }}
        </p>
        <div class="offline__actions">
          <n-button
            size="small"
            :disabled="downloading?.state === 'running'"
            @click="download"
          >
            <template #icon><n-icon><CloudDownloadOutline /></n-icon></template>
            下载未缓存章节
          </n-button>
          <n-popconfirm v-if="cachedIndexes.length" @positive-click="clearCache">
            <template #trigger><n-button size="small" quaternary>清空缓存</n-button></template>
            清空后离线读不到了，确定吗？
          </n-popconfirm>
        </div>
      </section>

      <section class="toc">
        <div class="toc__head">
          <span>目录 {{ chapters.length ? `(${chapters.length})` : "" }}</span>
          <n-button text size="tiny" @click="reversed = !reversed">
            {{ reversed ? "正序" : "倒序" }}
          </n-button>
        </div>
        <n-input
          v-model:value="chapterFilter"
          placeholder="在目录里找章节"
          clearable
          size="small"
          class="toc__filter"
        >
          <template #prefix><n-icon><SearchOutline /></n-icon></template>
        </n-input>

        <n-spin :show="tocLoading">
          <n-result
            v-if="tocError"
            status="warning"
            title="目录加载失败"
            :description="tocError"
            size="small"
          >
            <template #footer>
              <n-button size="small" @click="loadToc">重试</n-button>
              <n-button v-if="onShelf" size="small" text @click="openSources">换个源</n-button>
            </template>
          </n-result>
          <ChapterList
            v-else
            :chapters="chapters"
            :cached-indexes="cachedIndexes"
            :current-index="currentIndex"
            :filter="chapterFilter"
            :reversed="reversed"
            @pick="read"
          />
        </n-spin>
      </section>
    </template>

    <SwitchSourceDrawer
      v-model:show="showSources"
      :page="switchPage"
      :loading="sourcesLoading"
      :error="switchError"
      @pick="switchTo"
      @reload="loadSources"
    />
  </div>
</template>

<style scoped>
.state {
  padding: var(--space-6) var(--space-4);
}

.hero {
  display: flex;
  gap: var(--space-4);
  padding: var(--space-4) var(--space-3);
}

.hero__body {
  min-width: 0;
  flex: 1;
}

.hero__title {
  margin: 0 0 6px;
  font-size: 18px;
  font-weight: 600;
  line-height: 1.3;
}

.hero__meta {
  display: flex;
  gap: var(--space-3);
  margin: 0 0 4px;
  font-size: 13px;
  color: var(--text-muted);
}

.hero__source {
  margin: var(--space-2) 0 0;
  font-size: 12px;
  color: var(--accent);
}

.actions {
  display: flex;
  gap: var(--space-2);
  padding: 0 var(--space-3) var(--space-3);
}

.intro,
.offline,
.toc {
  padding: var(--space-3);
  border-top: 1px solid var(--border-subtle);
}

.intro__text {
  margin: 0 0 var(--space-2);
  font-size: 13px;
  line-height: 1.7;
  color: var(--text-muted);
  white-space: pre-wrap;
}

.intro__text--clamped {
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
}

.offline__head,
.toc__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--space-2);
  font-size: 13px;
  font-weight: 600;
}

.offline__count {
  font-size: 12px;
  font-weight: 400;
  color: var(--text-muted);
}

.offline__error {
  margin: var(--space-2) 0 0;
  font-size: 12px;
  color: #d03050;
}

.offline__actions {
  display: flex;
  gap: var(--space-2);
  margin-top: var(--space-2);
}

.toc__filter {
  margin-bottom: var(--space-2);
}

.source {
  display: flex;
  gap: var(--space-2);
  align-items: center;
}

.source__name {
  flex: 1;
}

.source__current {
  font-size: 11px;
  color: var(--accent);
}
</style>
