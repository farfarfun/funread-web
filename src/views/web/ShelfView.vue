<script setup lang="ts">
/**
 * 书架（C 端首页）。网格 / 列表两种视图，排序纯前端做，不加接口。
 *
 * 分组筛选也在前端做：这个页面本来就要把整架书取回来渲染「全部」，再按分组各发
 * 一次请求只是让切 tab 多等一个来回。分组**列表**仍然走 `GET /shelf/groups` ——
 * 它是权威的那份（后端负责把「未分组」排在最后），而且书架以后分页了也还对。
 */
import {
  AlertCircleOutline,
  BookmarkOutline,
  CheckmarkCircle,
  CloseOutline,
  EllipseOutline,
  GridOutline,
  ListOutline,
  PersonOutline,
  RefreshOutline,
  SearchOutline,
  TimeOutline,
} from "@vicons/ionicons5";
import { useMessage } from "naive-ui";
import { computed, onActivated, onMounted, onUnmounted, ref } from "vue";
import { useRouter } from "vue-router";

import { api } from "../../api/client";
import type { ShelfBook, ShelfGroup } from "../../api/types";
import BookCover from "../../components/web/BookCover.vue";
import SkeletonList from "../../components/web/SkeletonList.vue";
import TopBar from "../../components/web/TopBar.vue";
import { useShortcuts } from "../../composables/useShortcuts";

type ViewMode = "grid" | "list";
type SortKey = "recent" | "added" | "name";

const VIEW_KEY = "funread.shelf.view";
const SORT_KEY = "funread.shelf.sort";
const GROUP_KEY = "funread.shelf.group";

/** 查更新的轮询间隔。一本书两个请求、后端还要礼貌停顿，没必要查太勤。 */
const POLL_MS = 1500;

const router = useRouter();
const message = useMessage();

const books = ref<ShelfBook[]>([]);
const groups = ref<ShelfGroup[]>([]);
const loading = ref(true);
const error = ref("");
const mode = ref<ViewMode>((localStorage.getItem(VIEW_KEY) as ViewMode) || "grid");
const sort = ref<SortKey>((localStorage.getItem(SORT_KEY) as SortKey) || "recent");

//  `null` = 全部，`""` = 未分组，其余 = 组名。三态，所以不能用空串兼表「全部」。
const activeGroup = ref<string | null>(readActiveGroup());

const selecting = ref(false);
const selected = ref<Set<string>>(new Set());
const moving = ref(false);
const moveTarget = ref("");
const newGroup = ref("");

const checking = ref(false);
const checked = ref(0);
const checkTotal = ref(0);
let pollTimer: number | undefined;

const SORT_OPTIONS = [
  { label: "最近阅读", value: "recent" },
  { label: "加入时间", value: "added" },
  { label: "书名", value: "name" },
];

function readActiveGroup(): string | null {
  const raw = localStorage.getItem(GROUP_KEY);
  //  存的是 JSON 而不是裸字符串 —— 否则 `""`（未分组）和「没存过」分不开。
  if (raw === null) return null;
  try {
    const value = JSON.parse(raw);
    return typeof value === "string" ? value : null;
  } catch {
    return null;
  }
}

const sorted = computed(() => {
  const list = [...books.value];
  if (sort.value === "name") return list.sort((a, b) => a.name.localeCompare(b.name, "zh"));
  //  后端已按 updated_at 倒序给了，「最近阅读」就是原序；「加入时间」没有单独
  //  的字段，用 book_key 稳定排一下，至少是确定的顺序而不是随机的。
  if (sort.value === "added") return list.sort((a, b) => a.book_key.localeCompare(b.book_key));
  return list;
});

const visible = computed(() =>
  activeGroup.value === null
    ? sorted.value
    : sorted.value.filter((book) => book.group === activeGroup.value),
);

/** 分组 tab。只有真的有分组时才显示这一行，否则是一条占地方的废带。 */
const tabs = computed(() => {
  if (!groups.value.some((group) => group.name !== "")) return [];
  return [
    { key: null as string | null, label: "全部", count: books.value.length },
    ...groups.value.map((group) => ({
      key: group.name,
      label: group.name === "" ? "未分组" : group.name,
      count: group.count,
    })),
  ];
});

/** 当前停在一个真实分组上（不是「全部」也不是「未分组」）—— 才能改名/解散。 */
const editableGroup = computed(() =>
  activeGroup.value !== null && activeGroup.value !== "" ? activeGroup.value : "",
);

const unreadTotal = computed(() => books.value.reduce((sum, book) => sum + book.unread, 0));

async function load() {
  loading.value = true;
  error.value = "";
  try {
    const [shelf, shelfGroups] = await Promise.all([api.shelf(), api.shelfGroups()]);
    books.value = shelf;
    groups.value = shelfGroups;
    //  刚才停在的分组可能已经被解散/改名了，别把界面留在一个空列表上
    if (activeGroup.value !== null && !shelfGroups.some((g) => g.name === activeGroup.value)) {
      setGroup(null);
    }
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : "加载失败";
  } finally {
    loading.value = false;
  }
}

/** 只刷数据，不动骨架屏 —— 查更新结束后用，免得整页闪一下。 */
async function refresh() {
  try {
    const [shelf, shelfGroups] = await Promise.all([api.shelf(), api.shelfGroups()]);
    books.value = shelf;
    groups.value = shelfGroups;
  } catch {
    //  后台刷新失败就留着旧数据，不打断用户 —— 下次进页面还会再取。
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

function setGroup(value: string | null) {
  activeGroup.value = value;
  if (value === null) localStorage.removeItem(GROUP_KEY);
  else localStorage.setItem(GROUP_KEY, JSON.stringify(value));
}

/** 点书架项 = 续读。没有进度就去详情页选章。 */
function open(book: ShelfBook) {
  if (selecting.value) {
    toggle(book);
    return;
  }
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
    await refresh();
    message.success(`已移出书架：${book.name}`);
  } catch (reason) {
    message.error(reason instanceof Error ? reason.message : "移出失败");
  }
}

// ------------------------------------------------------------------ 多选与分组

function toggle(book: ShelfBook) {
  //  整体换一个 Set，而不是原地 add/delete —— Set 的内容变化不会触发重渲染。
  const next = new Set(selected.value);
  if (next.has(book.book_key)) next.delete(book.book_key);
  else next.add(book.book_key);
  selected.value = next;
}

function startSelecting() {
  selecting.value = true;
  selected.value = new Set();
}

function stopSelecting() {
  selecting.value = false;
  selected.value = new Set();
}

function openMove() {
  //  默认停在当前分组上，「把这组里的几本挪出去」是最常见的一次操作
  moveTarget.value = editableGroup.value;
  newGroup.value = "";
  moving.value = true;
}

async function confirmMove() {
  const group = (newGroup.value.trim() || moveTarget.value).trim();
  const keys = [...selected.value];
  if (!keys.length) return;
  try {
    const { affected } = await api.assignShelfGroup(keys, group);
    moving.value = false;
    stopSelecting();
    await refresh();
    message.success(group ? `已移动 ${affected} 本到「${group}」` : `已移出分组 ${affected} 本`);
  } catch (reason) {
    message.error(reason instanceof Error ? reason.message : "移动失败");
  }
}

async function renameGroup() {
  const name = window.prompt("新的分组名", editableGroup.value)?.trim();
  if (!name || name === editableGroup.value) return;
  try {
    await api.renameShelfGroup(editableGroup.value, name);
    setGroup(name);
    await refresh();
    message.success(`已改名为「${name}」`);
  } catch (reason) {
    message.error(reason instanceof Error ? reason.message : "改名失败");
  }
}

async function dissolveGroup() {
  const name = editableGroup.value;
  try {
    //  `new=""` 就是解散：分组没有自己的表，书退回未分组而不是被删掉。
    const { affected } = await api.renameShelfGroup(name, "");
    setGroup(null);
    await refresh();
    message.success(`已解散「${name}」，${affected} 本退回未分组`);
  } catch (reason) {
    message.error(reason instanceof Error ? reason.message : "解散失败");
  }
}

// ------------------------------------------------------------------ 检查更新

function stopPolling() {
  if (pollTimer !== undefined) window.clearTimeout(pollTimer);
  pollTimer = undefined;
}

async function poll(taskId: string) {
  try {
    const progress = await api.checkUpdatesProgress(taskId);
    checked.value = progress.done + progress.failed;
    checkTotal.value = progress.total;
    if (progress.state === "running") {
      pollTimer = window.setTimeout(() => poll(taskId), POLL_MS);
      return;
    }
    checking.value = false;
    await refresh();
    if (progress.state === "error") message.error(progress.detail || "检查更新失败");
    else if (progress.failed) message.warning(`查完了，其中 ${progress.failed} 本没查到`);
    else message.success("已是最新");
  } catch {
    //  任务条目过期（结束十分钟后清掉）也会走到这里。结果本身已经落在书架上，
    //  所以刷一下就行，不必报错。
    checking.value = false;
    await refresh();
  }
}

async function checkUpdates() {
  if (checking.value) return;
  checking.value = true;
  checked.value = 0;
  checkTotal.value = 0;
  try {
    //  只查当前筛出来的这些 —— 停在一个分组上时，用户要的是这一组的更新。
    const keys = activeGroup.value === null ? undefined : visible.value.map((b) => b.book_key);
    const accepted = await api.checkShelfUpdates(keys, 1);
    checkTotal.value = accepted.queued;
    await poll(accepted.task_id);
  } catch (reason) {
    checking.value = false;
    message.error(reason instanceof Error ? reason.message : "检查更新失败");
  }
}

useShortcuts({
  "/": () => router.push({ name: "search" }),
  g: () => setMode(mode.value === "grid" ? "list" : "grid"),
  r: checkUpdates,
});

onMounted(load);
//  从正文页返回时进度变了，书架上的「读到第 N 章」要跟着更新
onActivated(load);
onUnmounted(stopPolling);
</script>

<template>
  <div>
    <TopBar title="书架">
      <template #actions>
        <n-button v-if="selecting" quaternary size="small" @click="stopSelecting">完成</n-button>
        <template v-else>
          <n-button quaternary circle aria-label="搜索" @click="router.push({ name: 'search' })">
            <template #icon><n-icon><SearchOutline /></n-icon></template>
          </n-button>
          <n-button
            quaternary
            circle
            :loading="checking"
            :disabled="checking || !books.length"
            aria-label="检查更新"
            @click="checkUpdates"
          >
            <template #icon><n-icon><RefreshOutline /></n-icon></template>
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
      <nav v-if="tabs.length" class="tabs">
        <button
          v-for="tab in tabs"
          :key="tab.key ?? '__all__'"
          type="button"
          class="tabs__item"
          :class="{ 'tabs__item--on': activeGroup === tab.key }"
          @click="setGroup(tab.key)"
        >
          {{ tab.label }} {{ tab.count }}
        </button>
      </nav>

      <div class="toolbar">
        <n-select
          :value="sort"
          :options="SORT_OPTIONS"
          size="small"
          class="toolbar__sort"
          @update:value="setSort"
        />
        <template v-if="editableGroup">
          <n-button quaternary size="tiny" @click="renameGroup">改名</n-button>
          <n-popconfirm @positive-click="dissolveGroup">
            <template #trigger><n-button quaternary size="tiny">解散</n-button></template>
            解散「{{ editableGroup }}」只会把书退回未分组，不会删书。
          </n-popconfirm>
        </template>
        <span class="toolbar__spacer" />
        <n-button v-if="!selecting" quaternary size="tiny" @click="startSelecting">多选</n-button>
        <span class="toolbar__count">
          <template v-if="checking">检查中 {{ checked }}/{{ checkTotal }}</template>
          <template v-else-if="unreadTotal">{{ visible.length }} 本 · {{ unreadTotal }} 未读</template>
          <template v-else>{{ visible.length }} 本</template>
        </span>
      </div>

      <n-empty v-if="!visible.length" description="这个分组还是空的" class="state" />

      <ul v-else-if="mode === 'grid'" class="grid">
        <li v-for="book in visible" :key="book.book_key">
          <button type="button" class="grid__item" @click="open(book)">
            <span class="grid__cover">
              <BookCover :src="book.cover_url" :name="book.name" :width="100" :height="138" />
              <n-icon v-if="selecting" class="grid__check" size="22">
                <CheckmarkCircle v-if="selected.has(book.book_key)" />
                <EllipseOutline v-else />
              </n-icon>
              <span v-else-if="book.unread" class="grid__badge">{{ book.unread }}</span>
            </span>
            <span class="grid__name">{{ book.name }}</span>
            <span v-if="book.progress" class="grid__progress">
              读到第 {{ book.progress.chapter_index + 1 }} 章
            </span>
            <span v-else class="grid__progress grid__progress--none">未开始</span>
          </button>
        </li>
      </ul>

      <n-list v-else hoverable clickable>
        <n-list-item v-for="book in visible" :key="book.book_key">
          <!-- 结构对齐 CCSSNE 的 item_bookshelf_list.xml：封面 66×90、书名 16sp、
               三行带图标的信息（作者 / 读到哪 / 最新章节），都是 13sp -->
          <div class="row" @click="open(book)">
            <n-icon v-if="selecting" size="22" class="row__check">
              <CheckmarkCircle v-if="selected.has(book.book_key)" />
              <EllipseOutline v-else />
            </n-icon>
            <BookCover :src="book.cover_url" :name="book.name" :width="66" :height="90" />
            <div class="row__body">
              <p class="row__name">
                {{ book.name }}
                <n-tag v-if="book.unread" size="tiny" type="error" round>
                  {{ book.unread }} 未读
                </n-tag>
                <n-tooltip v-if="book.last_check_error" trigger="hover">
                  <template #trigger>
                    <n-icon size="14" class="row__warn"><AlertCircleOutline /></n-icon>
                  </template>
                  {{ book.last_check_error }}
                </n-tooltip>
              </p>
              <p class="row__line">
                <n-icon size="13"><PersonOutline /></n-icon>
                <span>{{ book.author || "未知作者" }}</span>
                <span v-if="book.group" class="row__group">{{ book.group }}</span>
              </p>
              <p class="row__line row__line--read">
                <n-icon size="13"><BookmarkOutline /></n-icon>
                <span>
                  {{
                    book.progress
                      ? `读到第 ${book.progress.chapter_index + 1} 章${book.progress.chapter_name ? ` · ${book.progress.chapter_name}` : ""}`
                      : "未开始"
                  }}
                </span>
              </p>
              <p v-if="book.last_chapter" class="row__line">
                <n-icon size="13"><TimeOutline /></n-icon>
                <span>{{ book.last_chapter }}</span>
              </p>
            </div>
          </div>
          <template v-if="!selecting" #suffix>
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

    <!-- 多选操作条。固定在底部 TabBar 之上，让拇指够得到 -->
    <div v-if="selecting" class="bulk">
      <span class="bulk__count">已选 {{ selected.size }} 本</span>
      <n-button size="small" :disabled="!selected.size" @click="openMove">移动到分组</n-button>
      <n-button size="small" quaternary circle aria-label="退出多选" @click="stopSelecting">
        <template #icon><n-icon><CloseOutline /></n-icon></template>
      </n-button>
    </div>

    <n-modal
      v-model:show="moving"
      preset="card"
      title="移动到分组"
      class="move"
      :bordered="false"
    >
      <n-radio-group v-model:value="moveTarget" class="move__list">
        <n-radio value="">未分组</n-radio>
        <n-radio
          v-for="group in groups.filter((g) => g.name !== '')"
          :key="group.name"
          :value="group.name"
        >
          {{ group.name }}
        </n-radio>
      </n-radio-group>
      <n-input
        v-model:value="newGroup"
        placeholder="或者新建一个分组"
        maxlength="128"
        class="move__new"
        @keyup.enter="confirmMove"
      />
      <template #footer>
        <div class="move__actions">
          <n-button quaternary @click="moving = false">取消</n-button>
          <n-button type="primary" @click="confirmMove">移动</n-button>
        </div>
      </template>
    </n-modal>
  </div>
</template>

<style scoped>
.state {
  padding: var(--space-6) var(--space-4);
}

.tabs {
  display: flex;
  gap: var(--space-2);
  /* 分组多了就横向滚，不换行 —— 换行会把书架推下去半屏 */
  overflow-x: auto;
  padding: var(--space-2) var(--space-3) 0;
  scrollbar-width: none;
}

.tabs::-webkit-scrollbar {
  display: none;
}

.tabs__item {
  flex: none;
  padding: 5px 12px;
  color: var(--text-muted);
  font-size: 13px;
  background: var(--surface-raised);
  border: 1px solid var(--border-subtle);
  border-radius: 999px;
  cursor: pointer;
}

.tabs__item--on {
  color: #fff;
  background: var(--accent);
  border-color: var(--accent);
}

.toolbar {
  display: flex;
  gap: var(--space-2);
  align-items: center;
  padding: var(--space-2) var(--space-3);
}

.toolbar__sort {
  width: 130px;
}

.toolbar__spacer {
  flex: 1;
}

.toolbar__count {
  font-size: 12px;
  color: var(--text-muted);
  white-space: nowrap;
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

.grid__cover {
  position: relative;
  display: block;
  width: fit-content;
}

.grid__badge {
  position: absolute;
  top: -4px;
  right: -4px;
  min-width: 18px;
  padding: 0 5px;
  color: #fff;
  font-size: 11px;
  line-height: 18px;
  text-align: center;
  background: var(--danger);
  border-radius: 999px;
}

.grid__check {
  position: absolute;
  top: 4px;
  right: 4px;
  color: var(--accent);
  /* 封面是深色图时白描边才看得见 */
  filter: drop-shadow(0 0 2px rgb(0 0 0 / 60%));
}

.grid__name {
  overflow: hidden;
  /* 12px 对齐原版的 12sp */
  font-size: 12px;
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

.row__check {
  flex: none;
  color: var(--accent);
}

.row__body {
  min-width: 0;
  flex: 1;
}

.row__name {
  display: flex;
  gap: 6px;
  align-items: center;
  margin: 0;
  overflow: hidden;
  /* 16px 对齐原版的 16sp —— 书名是这一行的主体，比信息行明显大一级 */
  font-size: 16px;
  font-weight: 600;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.row__warn {
  flex: none;
  color: var(--warning);
}

.row__line {
  display: flex;
  gap: 5px;
  align-items: center;
  margin: 2px 0 0;
  overflow: hidden;
  font-size: 13px;
  color: var(--text-muted);
  white-space: nowrap;
}

.row__line span {
  overflow: hidden;
  text-overflow: ellipsis;
}

.row__line--read {
  color: var(--accent);
}

.row__group {
  flex: none;
  padding: 0 6px;
  font-size: 11px;
  background: var(--surface-raised);
  border: 1px solid var(--border-subtle);
  border-radius: 999px;
}

.bulk {
  position: fixed;
  right: var(--space-3);
  bottom: calc(var(--tabbar-height) + env(safe-area-inset-bottom, 0px) + var(--space-2));
  left: var(--space-3);
  z-index: 20;
  display: flex;
  gap: var(--space-2);
  align-items: center;
  padding: var(--space-2) var(--space-3);
  background: var(--surface-raised);
  border: 1px solid var(--border-subtle);
  border-radius: 12px;
  box-shadow: 0 6px 20px rgb(0 0 0 / 25%);
}

.bulk__count {
  flex: 1;
  font-size: 13px;
}

.move {
  width: min(92vw, 380px);
}

.move__list {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.move__new {
  margin-top: var(--space-3);
}

.move__actions {
  display: flex;
  gap: var(--space-2);
  justify-content: flex-end;
}

@media (min-width: 900px) {
  /* 列宽设上限，否则宽屏上会变成二十列小方块。minmax 的上界比下界大，
     所以窗口变窄时会先压缩列宽、再减少列数。 */
  .grid {
    grid-template-columns: repeat(auto-fill, minmax(132px, 164px));
    justify-content: start;
  }
}
</style>
