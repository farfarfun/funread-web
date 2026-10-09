<script setup lang="ts">
/**
 * 正文阅读。沉浸式：没有顶栏也没有 TabBar，工具栏点中部才出来。
 *
 * 三处值得说明的决定：
 *
 * - **进度存 `char_offset` 而不是滚动像素。** 换了字号、设备或字体之后像素值
 *   毫无意义；字符偏移还能换算回大致位置。恢复时按「已读字符 / 总字符」乘以
 *   可滚高度，不精确但稳定。
 * - **进度回写节流 3 秒，并在离开页面时补一次。** 不节流会在滚动时每帧发请求；
 *   只节流不补写则会丢掉最后一段 —— 用户往往读到一半就直接切走。
 * - **滚动式而不是翻页。** 不做翻页动画：分页要先测量渲染后的文本高度，一旦
 *   字号/行距可调就得反复重排，而滚动在移动端是原生手感。
 */
import {
  ChevronBackOutline,
  ChevronForwardOutline,
} from "@vicons/ionicons5";
import { useMessage } from "naive-ui";
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";

import { api } from "../../api/client";
import type {
  BookInfo,
  Chapter,
  ChapterContent,
  ShelfBook,
  SwitchCandidate,
  SwitchSourcePage,
  SwitchSourceResult,
} from "../../api/types";
import ChapterList from "../../components/web/ChapterList.vue";
import ReaderMenu from "../../components/web/ReaderMenu.vue";
import ReaderSettingsSheet from "../../components/web/ReaderSettingsSheet.vue";
import SwitchSourceDrawer from "../../components/web/SwitchSourceDrawer.vue";
import { useAutoScroll } from "../../composables/useAutoScroll";
import { useReaderSettings } from "../../composables/useReaderSettings";
import { useShortcuts } from "../../composables/useShortcuts";
import { useSpeech } from "../../composables/useSpeech";
import { useViewport } from "../../composables/useViewport";

/** 进度回写间隔。短了打库太频，长了切走会丢进度。 */
const SAVE_THROTTLE_MS = 3000;
/** 边缘翻章的触控带宽度（屏宽占比）。 */
const EDGE_RATIO = 0.25;

const route = useRoute();
const router = useRouter();
const message = useMessage();
const { settings, colors, contentStyle, paragraphStyle } = useReaderSettings();
const { isTouch, isWide } = useViewport();

const bookKey = computed(() => String(route.params.bookKey));

const info = ref<BookInfo | null>(null);
const chapters = ref<Chapter[]>([]);
const shelfBook = ref<ShelfBook | null>(null);
const content = ref<ChapterContent | null>(null);
const cachedIndexes = ref<number[]>([]);
const switchPage = ref<SwitchSourcePage | null>(null);
const switchError = ref("");

const index = ref(0);
const urlId = ref(0);
const loading = ref(true);
const error = ref("");
const showToolbar = ref(false);
const showToc = ref(false);
const showSettings = ref(false);
const showSources = ref(false);
const sourcesLoading = ref(false);
const chapterFilter = ref("");

/**
 * 亮度。0-100，100 = 不压暗。
 *
 * Web 没有屏幕亮度 API，所以这是一层半透明黑色遮罩 —— **只能压暗不能调亮**。
 * 夜里读书时「再暗一点」是真实需求（系统最低亮度仍然刺眼），所以值得做；
 * 但界面上必须说明这个限制，否则用户会拖到 100 以为能更亮。
 */
const BRIGHTNESS_KEY = "funread.reader.brightness";
const brightness = ref(Number(localStorage.getItem(BRIGHTNESS_KEY)) || 100);
watch(brightness, (value) => {
  try {
    localStorage.setItem(BRIGHTNESS_KEY, String(value));
  } catch {
    //  隐私模式写不了，本次会话内仍生效
  }
});

const scroller = ref<HTMLElement | null>(null);
const autoScroll = useAutoScroll(scroller);
const speech = useSpeech();
let saveTimer: number | undefined;
let pendingOffset = 0;

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

const current = computed(() => chapters.value[index.value] ?? null);
const hasPrev = computed(() => index.value > 0);
const hasNext = computed(() => index.value < chapters.value.length - 1);

const paragraphs = computed(() =>
  (content.value?.text || "")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean),
);

const totalChars = computed(() => (content.value?.text || "").length);

async function bootstrap() {
  loading.value = true;
  error.value = "";
  try {
    const shelf = await api.shelf().catch(() => [] as ShelfBook[]);
    shelfBook.value = shelf.find((item) => item.book_key === bookKey.value) ?? null;
    if (!shelfBook.value) {
      error.value = "这本书不在书架里，先从详情页加入书架";
      return;
    }
    urlId.value = Number(route.query.url_id) || shelfBook.value.url_id || 0;
    if (!urlId.value) {
      error.value = "缺少来源信息";
      return;
    }

    info.value = await api.bookInfo({
      url_id: urlId.value,
      book_url: shelfBook.value.book_url,
      name: shelfBook.value.name,
      author: shelfBook.value.author,
    });
    const toc = await api.toc(urlId.value, info.value);
    chapters.value = toc.items;

    const requested = Number(route.query.chapter);
    index.value = Number.isFinite(requested)
      ? Math.min(Math.max(0, requested), Math.max(0, chapters.value.length - 1))
      : (shelfBook.value.progress?.chapter_index ?? 0);

    api
      .cached(bookKey.value)
      .then((state) => (cachedIndexes.value = state.chapter_indexes))
      .catch(() => undefined);

    await loadChapter(shelfBook.value.progress?.char_offset ?? 0);
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : "加载失败";
  } finally {
    loading.value = false;
  }
}

async function loadChapter(restoreOffset = 0) {
  const chapter = current.value;
  if (!chapter || !info.value) return;
  loading.value = true;
  error.value = "";
  content.value = null;
  try {
    content.value = await api.content({
      url_id: urlId.value,
      chapter,
      book: info.value,
      //  带上 book_key，后端就会读写离线缓存 —— 飞行模式下靠这个。
      book_key: bookKey.value,
    });
    //  内容渲染后再恢复位置，否则容器高度还是 0
    requestAnimationFrame(() => restore(restoreOffset));
    void save(restoreOffset, { immediate: true });
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : "正文加载失败";
  } finally {
    loading.value = false;
  }
}

function restore(offset: number) {
  const element = scroller.value;
  if (!element || !offset || !totalChars.value) return;
  const ratio = Math.min(1, offset / totalChars.value);
  element.scrollTop = ratio * (element.scrollHeight - element.clientHeight);
}

/** 当前滚动位置换算成字符偏移。 */
function currentOffset(): number {
  const element = scroller.value;
  if (!element || !totalChars.value) return 0;
  const scrollable = element.scrollHeight - element.clientHeight;
  if (scrollable <= 0) return 0;
  return Math.round((element.scrollTop / scrollable) * totalChars.value);
}

async function save(offset: number, options: { immediate?: boolean } = {}) {
  const chapter = current.value;
  if (!chapter) return;
  pendingOffset = offset;
  if (!options.immediate) return;
  if (saveTimer) window.clearTimeout(saveTimer);
  saveTimer = undefined;
  try {
    await api.saveProgress(bookKey.value, {
      chapter_index: chapter.index,
      chapter_url: chapter.url,
      chapter_name: chapter.name,
      char_offset: pendingOffset,
    });
  } catch {
    //  进度写失败不该打断阅读，下一次节流窗口会再试
  }
}

function onScroll() {
  pendingOffset = currentOffset();
  if (saveTimer) return;
  saveTimer = window.setTimeout(() => {
    saveTimer = undefined;
    void save(pendingOffset, { immediate: true });
  }, SAVE_THROTTLE_MS);
}

/**
 * 朗读开关。
 *
 * **必须由用户点击直接触发** —— 浏览器的自动播放策略会拦掉非手势触发的 speak()，
 * 所以没有「打开章节自动朗读」这个选项。
 */
function toggleSpeech() {
  if (speech.speaking.value) {
    speech.stop();
    return;
  }
  if (!paragraphs.value.length) {
    message.info("这一章还没有正文");
    return;
  }
  if (!speech.start(paragraphs.value)) {
    message.error("朗读启动失败，可能是这台设备没有可用语音");
  }
}

async function go(delta: number) {
  const next = index.value + delta;
  if (next < 0 || next >= chapters.value.length) return;
  //  切章要把朗读与自动滚停掉 —— 否则会继续读上一章的内容，或者在新章首页
  //  自己往下滚，两者都看不出原因
  speech.stop();
  autoScroll.stop();
  //  切章前把当前进度落下去，否则这一章读到哪就丢了
  await save(currentOffset(), { immediate: true });
  index.value = next;
  showToolbar.value = false;
  if (scroller.value) scroller.value.scrollTop = 0;
  await loadChapter(0);
  void router.replace({
    name: "read",
    params: { bookKey: bookKey.value },
    query: { ...route.query, chapter: String(index.value) },
  });
}

/** 全书进度滑块的落点。滑块给的是目标下标，换算成 delta 复用 go()。 */
async function jumpTo(target: number) {
  const clamped = Math.min(Math.max(0, target), Math.max(0, chapters.value.length - 1));
  if (clamped === index.value) return;
  await go(clamped - index.value);
}

async function pick(chapter: Chapter) {
  showToc.value = false;
  const position = chapters.value.findIndex((item) => item.index === chapter.index);
  if (position < 0) return;
  await go(position - index.value);
}

/**
 * 点击处理。**边缘翻章只在触屏上启用。**
 *
 * 桌面上左右各 25% 的「触控带」是 640px 的死区（2560px 屏），而且鼠标用户会把
 * 点击理解成选中文字而不是翻页 —— 想复制一段话结果跳章了。桌面靠键盘（←/→）
 * 和常驻的翻章按钮，所以这里整屏都只切工具栏。
 */
function onTap(event: MouseEvent) {
  if (!isTouch.value) {
    showToolbar.value = !showToolbar.value;
    return;
  }
  const width = window.innerWidth;
  const x = event.clientX;
  if (x < width * EDGE_RATIO) {
    void go(-1);
    return;
  }
  if (x > width * (1 - EDGE_RATIO)) {
    void go(1);
    return;
  }
  showToolbar.value = !showToolbar.value;
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
    //  换源前把当前进度落下去 —— 后端要靠它（章节名 + 序号）在新源的目录里
    //  重新定位，这一步丢了就只能从第一章开始。
    await save(currentOffset(), { immediate: true });

    const result = await api.switchSource(bookKey.value, source.url_id, source.book_url);
    showSources.value = false;

    if (result.method === "none") {
      //  新源的目录取不到，没法定位。源已经换了，所以回详情页让用户手动选章 ——
      //  留在正文页只能显示一个任意章节。
      message.warning(describeSwitch(result, source.source_name));
      await router.replace({
        name: "book",
        params: { bookKey: bookKey.value },
        query: { url_id: String(source.url_id), book_url: source.book_url },
      });
      return;
    }

    //  **留在正文页接着读**。这是「读到一半源挂了」这个场景的全部意义 ——
    //  把人甩回详情页等于让他在上千章的目录里重新找自己读到哪。
    const text = describeSwitch(result, source.source_name);
    if (result.is_approximate) message.warning(text);
    else message.success(text);

    urlId.value = source.url_id;
    if (shelfBook.value) {
      shelfBook.value = {
        ...shelfBook.value,
        url_id: source.url_id,
        book_url: source.book_url,
      };
    }
    await router.replace({
      name: "read",
      params: { bookKey: bookKey.value },
      query: { url_id: String(source.url_id), chapter: String(result.chapter_index) },
    });
    //  整条链都要用新源重算：BookInfo 的 variables、目录、正文
    await reloadFromNewSource(result.chapter_index);
  } catch (reason) {
    message.error(reason instanceof Error ? reason.message : "换源失败");
  }
}

/** 用新源重新取详情与目录，然后落在 `targetIndex` 这一章。 */
async function reloadFromNewSource(targetIndex: number) {
  loading.value = true;
  error.value = "";
  try {
    info.value = await api.bookInfo({
      url_id: urlId.value,
      book_url: shelfBook.value?.book_url ?? "",
      name: shelfBook.value?.name ?? "",
      author: shelfBook.value?.author ?? "",
    });
    const toc = await api.toc(urlId.value, info.value);
    chapters.value = toc.items;
    index.value = Math.min(Math.max(0, targetIndex), Math.max(0, chapters.value.length - 1));
    //  换源清掉了章节缓存，已下载标记要跟着清
    cachedIndexes.value = [];
    //  换源后来源列表也变了（当前源不同），下次打开重新拉
    switchPage.value = null;
    if (scroller.value) scroller.value.scrollTop = 0;
    await loadChapter(0);
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : "新源的目录读不出来";
  } finally {
    loading.value = false;
  }
}

//  离开前补一次写：节流窗口里的最后一段进度否则会丢
function flush() {
  void save(currentOffset(), { immediate: true });
}

onMounted(() => {
  bootstrap();
  window.addEventListener("pagehide", flush);
  document.addEventListener("visibilitychange", onVisibility);
});

function onVisibility() {
  if (document.visibilityState === "hidden") flush();
}

onBeforeUnmount(() => {
  flush();
  //  朗读是全局的（speechSynthesis 不属于组件），不停掉会在离开页面后继续读
  speech.stop();
  if (saveTimer) window.clearTimeout(saveTimer);
  window.removeEventListener("pagehide", flush);
  document.removeEventListener("visibilitychange", onVisibility);
});

/**
 * 键盘导航。桌面上这是**主要**翻章方式 —— 点屏幕左右 25% 在 2560px 宽的屏幕上
 * 是 640px 的死区，完全反直觉。
 *
 * Esc 的层级按「最内层先关」：抽屉 → 工具栏 → 回详情页。这和用户的预期一致，
 * 也避免一次 Esc 把人直接弹出正文。
 */
useShortcuts({
  ArrowLeft: () => void go(-1),
  ArrowRight: () => void go(1),
  //  空格/PageDown 翻页是浏览器默认行为（滚动），不拦 —— 滚动式阅读里那本来就对
  t: () => (showToc.value = !showToc.value),
  s: () => (showSettings.value = !showSettings.value),
  h: () => (showSources.value ? undefined : openSources()),
  p: () => toggleSpeech(),
  a: () => autoScroll.toggle(settings.value.autoScrollSpeed || 40),
  Escape: () => {
    if (showToc.value || showSettings.value || showSources.value) {
      showToc.value = false;
      showSettings.value = false;
      showSources.value = false;
      return;
    }
    if (showToolbar.value) {
      showToolbar.value = false;
      return;
    }
    router.push({ name: "book", params: { bookKey: bookKey.value } });
  },
});

watch(() => settings.value.theme, () => undefined);
</script>

<template>
  <div class="reader" :style="{ background: colors.bg }">
    <div
      ref="scroller"
      class="reader__scroll"
      @scroll.passive="onScroll"
      @click="onTap"
    >
      <div v-if="loading && !content" class="reader__center" :style="{ color: colors.muted }">
        <n-spin size="large" />
        <p>正在抓取正文…</p>
      </div>

      <div v-else-if="error" class="reader__center">
        <n-result status="warning" title="读不到这一章" :description="error">
          <template #footer>
            <n-button size="small" @click="loadChapter()">重试</n-button>
            <n-button size="small" @click.stop="openSources">换个源</n-button>
            <n-button
              size="small"
              text
              @click.stop="router.push({ name: 'book', params: { bookKey } })"
            >
              回详情
            </n-button>
          </template>
        </n-result>
      </div>

      <article v-else class="reader__body" :style="contentStyle">
        <h2 class="reader__title">{{ content?.title || current?.name }}</h2>
        <p
          v-for="(line, position) in paragraphs"
          :key="position"
          class="reader__p"
          :class="{ 'reader__p--speaking': speech.index.value === position }"
          :style="paragraphStyle"
        >
          {{ line }}
        </p>
        <div class="reader__footer" :style="{ color: colors.muted }">
          <n-button v-if="hasPrev" size="small" quaternary @click.stop="go(-1)">上一章</n-button>
          <span class="reader__position">{{ index + 1 }} / {{ chapters.length }}</span>
          <n-button v-if="hasNext" size="small" quaternary @click.stop="go(1)">下一章</n-button>
        </div>
      </article>
    </div>

    <!-- 桌面常驻翻章按钮。触屏上不显示 —— 那里有边缘手势，再加两个浮标只会
         遮住正文。 -->
    <template v-if="!isTouch && isWide && !loading && !error">
      <button
        v-if="hasPrev"
        type="button"
        class="pager pager--prev"
        aria-label="上一章（左方向键）"
        @click.stop="go(-1)"
      >
        <n-icon size="22"><ChevronBackOutline /></n-icon>
      </button>
      <button
        v-if="hasNext"
        type="button"
        class="pager pager--next"
        aria-label="下一章（右方向键）"
        @click.stop="go(1)"
      >
        <n-icon size="22"><ChevronForwardOutline /></n-icon>
      </button>
    </template>

    <ReaderMenu
      v-model:show="showToolbar"
      v-model:brightness="brightness"
      :chapter-name="content?.title || current?.name || ''"
      :source-name="info?.source_name || ''"
      :index="index"
      :total="chapters.length"
      :has-prev="hasPrev"
      :has-next="hasNext"
      :speech-supported="speech.supported"
      :speaking="speech.speaking.value"
      @prev="go(-1)"
      @next="go(1)"
      @jump="jumpTo"
      @toc="showToc = true"
      @speech="toggleSpeech"
      @style="showSettings = true"
      @settings="showSettings = true"
      @switch-source="openSources"
    />

    <n-drawer v-model:show="showToc" placement="bottom" :height="440">
      <n-drawer-content title="目录" closable>
        <n-input v-model:value="chapterFilter" placeholder="找章节" clearable size="small" />
        <ChapterList
          :chapters="chapters"
          :cached-indexes="cachedIndexes"
          :current-index="current?.index ?? -1"
          :filter="chapterFilter"
          @pick="pick"
        />
      </n-drawer-content>
    </n-drawer>

    <ReaderSettingsSheet
      v-model:show="showSettings"
      :speech-supported="speech.supported"
      :speech-voices="speech.voices.value"
      :speech-rate="speech.rate.value"
      :speech-voice="speech.voiceName.value"
      :has-chinese-voice="speech.hasChineseVoice.value"
      :auto-scroll-running="autoScroll.running.value"
      @update:speech-rate="speech.setRate"
      @update:speech-voice="speech.setVoice"
      @toggle-auto-scroll="autoScroll.toggle(settings.autoScrollSpeed || 40)"
    />

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
.reader {
  position: fixed;
  inset: 0;
  transition: background 0.2s var(--ease);
}

.reader__scroll {
  height: 100%;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  /* 刘海与手势条都要让开 */
  padding-top: env(safe-area-inset-top, 0);
  padding-bottom: calc(env(safe-area-inset-bottom, 0px) + 24px);
}

.reader__center {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  align-items: center;
  justify-content: center;
  height: 100%;
  padding: var(--space-4);
  text-align: center;
}

.reader__body {
  /* em 而不是 rem：跟着用户设的字号走。44em 在 18px 下约 790px，
     一行 40 来个汉字 —— 中文长文的舒适区间。桌面上不该因为屏幕宽就加宽。 */
  max-width: 44em;
  margin: 0 auto;
  padding-top: var(--space-5);
}

.reader__title {
  margin: 0 0 var(--space-5);
  font-size: 1.05em;
  font-weight: 600;
  text-align: center;
}

.reader__p {
  /* margin-bottom 与 text-indent 由内联 style 给（段距与缩进可调），
     这里只放不随设置变的部分 */
  margin: 0;
  text-align: justify;
  overflow-wrap: break-word;
  transition: background 0.2s var(--ease);
}

/* 正在朗读的那一段。读者要能一眼找到自己听到哪了 —— 否则一分神就得重新找。 */
.reader__p--speaking {
  background: color-mix(in srgb, var(--accent) 18%, transparent);
  border-radius: 4px;
}

.reader__footer {
  display: flex;
  gap: var(--space-3);
  align-items: center;
  justify-content: center;
  padding: var(--space-5) 0 var(--space-6);
  font-size: 0.75em;
}

/* 桌面常驻翻章按钮：贴在内容两侧的空白里，不压正文 */
.pager {
  position: fixed;
  top: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 64px;
  color: var(--text-muted);
  background: var(--surface-raised);
  border: 1px solid var(--border-subtle);
  border-radius: 10px;
  cursor: pointer;
  opacity: 0.45;
  transform: translateY(-50%);
  transition: opacity 0.15s var(--ease);
}

.pager:hover {
  opacity: 1;
}

.pager--prev {
  left: var(--space-4);
}

.pager--next {
  right: var(--space-4);
}

.slide-up-enter-active,
.slide-up-leave-active {
  transition: transform 0.2s var(--ease);
}

.slide-up-enter-from,
.slide-up-leave-to {
  transform: translateY(100%);
}
</style>
