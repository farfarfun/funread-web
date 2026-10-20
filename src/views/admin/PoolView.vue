<script setup lang="ts">
/**
 * 候选源池：查看与人工干预。
 *
 * 这张表（`reader_source_prefs`）一直记着每个源的静态判定与实跑结果 —— 书源池
 * 5,606 个可用源、订阅源 142 个 —— 但在这一页之前完全没有出口。
 *
 * 和「采集源」页的区别：那一页管的是**产出书源列表的 URL**，这一页管的是采集
 * 下来的**单个源**。两者容易混，所以页头写了一句。
 *
 * 汇总里最该看的是 `proven`（实跑成功过的数量）—— 那才是池子的真实健康度。
 * `enabled` 只是静态判定的结果，而实测 150 个标着可用的源里只有 6 个真能跑通。
 */
import { CreateOutline, OptionsOutline, RefreshOutline, SearchOutline, SparklesOutline, TrashOutline } from "@vicons/ionicons5";
import type { DataTableColumns, DataTableSortState } from "naive-ui";
import { NButton, NSpace, NSwitch, NTag, useMessage } from "naive-ui";
import { computed, h, onMounted, onUnmounted, ref } from "vue";
import { useRoute } from "vue-router";

import { api } from "../../api/client";
import type { PoolPage, PoolRules, PoolSource, SourceTestProgress, SourceType } from "../../api/types";
import { formatTime, fromNow } from "../../utils/display";

const message = useMessage();
const route = useRoute();

const page = ref<PoolPage | null>(null);
const loading = ref(false);
const scanning = ref(false);
const bulkBusy = ref(false);
const error = ref("");
const selectedIds = ref<number[]>([]);
const editing = ref<PoolRules | null>(null);
const editorOpen = ref(false);
const editorLoading = ref(false);
const editorSaving = ref(false);
const editorText = ref("");
const editorError = ref("");
const editorHint = ref("");
const optimizingId = ref<number | null>(null);

async function openEditor(row: PoolSource) {
  editorOpen.value = true;
  editorLoading.value = true;
  editorError.value = "";
  editorHint.value = "";
  editing.value = null;
  try {
    editing.value = await api.poolRules(row.source_type, row.url_id);
    editorText.value = JSON.stringify(editing.value.rules, null, 2);
  } catch (reason) {
    editorError.value = reason instanceof Error ? reason.message : "读取规则失败";
  } finally {
    editorLoading.value = false;
  }
}

async function optimize(row: PoolSource) {
  if (optimizingId.value !== null) return;
  await openEditor(row);
  if (!editing.value) return;
  optimizingId.value = row.url_id;
  try {
    const result = await api.optimizePoolRss(row.url_id);
    editorText.value = JSON.stringify(result.rules, null, 2);
    editorHint.value = result.status === "ok"
      ? `当前规则可用，解析到 ${result.before_count} 篇文章`
      : `${result.reason} · 验证通过 ${result.after_count} 篇文章`;
  } catch (reason) {
    editorError.value = reason instanceof Error ? reason.message : "规则优化失败";
  } finally {
    optimizingId.value = null;
  }
}

async function saveEditor() {
  if (!editing.value || editorSaving.value) return;
  let rules: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(editorText.value);
    if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") throw new Error("规则必须是 JSON 对象");
    rules = parsed as Record<string, unknown>;
  } catch (reason) {
    editorError.value = reason instanceof Error ? reason.message : "JSON 格式错误";
    return;
  }
  editorSaving.value = true;
  editorError.value = "";
  try {
    const current = editing.value;
    await api.savePoolRules(current.source.source_type, current.source.url_id, rules, current.updated_at);
    editorOpen.value = false;
    message.success("规则已保存");
    await load();
  } catch (reason) {
    editorError.value = reason instanceof Error ? reason.message : "保存失败";
  } finally {
    editorSaving.value = false;
  }
}

const sourceType = ref<SourceType>(route.query.source_type === "rss" ? "rss" : "book");
const state = ref("any");
const sort = ref("rank");
const keyword = ref("");
const pageNo = ref(1);
const pageSize = ref(50);

const STATE_OPTIONS = [
  { label: "全部", value: "any" },
  { label: "已启用", value: "enabled" },
  { label: "已停用", value: "disabled" },
  { label: "有失败记录", value: "failing" },
  { label: "未测试", value: "untested" },
];

const SORT_OPTIONS = [
  { label: "默认排序", value: "rank" },
  { label: "最近测试 · 新到旧", value: "last_test_desc" },
  { label: "最近测试 · 旧到新", value: "last_test_asc" },
];
const sortOptions = computed(() => {
  if (SORT_OPTIONS.some((option) => option.value === sort.value)) return SORT_OPTIONS;
  const [key, direction] = sort.value.match(/^(.*)_(asc|desc)$/)?.slice(1) ?? [];
  const label = key === "name" ? "名称" : COLUMN_OPTIONS.find((item) => item.value === key)?.label;
  return label ? [...SORT_OPTIONS, { label: `${label} · ${direction === "asc" ? "升序" : "降序"}`, value: sort.value }] : SORT_OPTIONS;
});
const COLUMN_OPTIONS = [
  { label: "ID", value: "url_id" },
  { label: "域名", value: "domain" },
  { label: "完整 URL", value: "source_url" },
  { label: "判定", value: "verdict" },
  { label: "实跑", value: "proven" },
  { label: "成功率", value: "success_rate" },
  { label: "最近测试", value: "last_test_at" },
  { label: "最近错误", value: "last_error" },
  { label: "权重", value: "weight" },
  { label: "启用", value: "enabled" },
];
const defaultColumns = COLUMN_OPTIONS.filter((item) => item.value !== "source_url").map((item) => item.value);
function storedColumns(): string[] {
  try {
    const stored = JSON.parse(localStorage.getItem("pool-columns") || "null");
    return Array.isArray(stored) ? stored.filter((key) => COLUMN_OPTIONS.some((item) => item.value === key)) : defaultColumns;
  } catch { return defaultColumns; }
}
const visibleColumns = ref(storedColumns());
function setVisibleColumns(keys: string[]) {
  visibleColumns.value = keys;
  localStorage.setItem("pool-columns", JSON.stringify(keys));
}
function sortOrder(key: string) {
  return sort.value === `${key}_asc` ? "ascend" : sort.value === `${key}_desc` ? "descend" : false;
}

const TYPE_OPTIONS = [
  { label: "书源", value: "book" },
  { label: "订阅源", value: "rss" },
];

const summary = computed(() => page.value?.summary);
const allVisibleSelected = computed(
  () => Boolean(page.value?.items.length) && page.value!.items.every((item) => selectedIds.value.includes(item.url_id)),
);
const partlyVisibleSelected = computed(
  () => !allVisibleSelected.value && Boolean(page.value?.items.some((item) => selectedIds.value.includes(item.url_id))),
);

function toggleVisible(checked: boolean) {
  const ids = new Set(selectedIds.value);
  for (const item of page.value?.items ?? []) checked ? ids.add(item.url_id) : ids.delete(item.url_id);
  selectedIds.value = [...ids];
}

function toggleVisibleItem(urlId: number, checked: boolean) {
  const ids = new Set(selectedIds.value);
  checked ? ids.add(urlId) : ids.delete(urlId);
  selectedIds.value = [...ids];
}

// ----------------------------------------------------------------- 批量测试
//
// 「这个源还能用吗」只有真跑一次才知道。采集侧的可达标记预测力极差，而用户搜索
// 时顺带记下的成败又太稀疏 —— 没被选中的源永远没有记录，没记录又让它更难被选中。
// 批量测试打破这个循环：每个源都测、可以反复测，累计成功率成为第一排序键。

const TEST_POLL_MS = 1500;

const testing = ref<SourceTestProgress[]>([]);
const TEST_TASKS_KEY = "pool-test-tasks";
function rememberTests() {
  sessionStorage.setItem(TEST_TASKS_KEY, JSON.stringify(testing.value.map((task) => task.task_id)));
}
const submittingTest = ref(false);
const testLimit = ref(50);
const untestedOnly = ref(false);
let testTimer: number | undefined;
let pollGeneration = 0;
const clearingQueue = ref(false);
const testTotal = computed(() => testing.value.reduce((total, task) => total + task.total, 0));
const testDone = computed(() => testing.value.reduce((total, task) => total + task.done, 0));

async function startTest(urlIds?: number[]) {
  if (submittingTest.value) return;
  if (urlIds && urlIds.length > 500) {
    message.warning("单次最多测试 500 个源，请缩小选择范围");
    return;
  }
  submittingTest.value = true;
  try {
    const accepted = await api.testSources({
      source_type: sourceType.value,
      limit: testLimit.value,
      untested_only: untestedOnly.value,
      ...(urlIds ? { url_ids: urlIds } : {}),
    });
    message.success(`已排入 ${accepted.queued} 个源`);
    testing.value.push({
      task_id: accepted.task_id,
      state: "running",
      total: accepted.queued,
      done: 0,
      failed: 0,
      detail: "",
    });
    rememberTests();
    pollTest();
  } catch (reason) {
    message.error(reason instanceof Error ? reason.message : "启动测试失败");
  } finally {
    submittingTest.value = false;
  }
}

async function testAll() {
  if (submittingTest.value) return;
  submittingTest.value = true;
  try {
    const accepted = await api.testAllSources(sourceType.value);
    testing.value.push({ task_id: accepted.task_id, state: "running", total: accepted.queued, done: 0, failed: 0, detail: "" });
    rememberTests();
    message.success(`已排入 ${accepted.queued} 个有规则源`);
    pollTest();
  } catch (reason) {
    message.error(reason instanceof Error ? reason.message : "一键测试失败");
  } finally {
    submittingTest.value = false;
  }
}

function pollTest() {
  window.clearTimeout(testTimer);
  const generation = pollGeneration;
  testTimer = window.setTimeout(async () => {
    const finished = new Set<string>();
    for (const task of [...testing.value]) {
      try {
        const progress = await api.testProgress(task.task_id);
        if (generation !== pollGeneration) return;
        Object.assign(task, progress);
        if (progress.state === "running") continue;
        finished.add(task.task_id);
        if (progress.state === "cancelled") continue;
        if (progress.state === "error") message.error(`测试中断：${progress.detail}`);
        else message.success(`测试完成：${progress.done - progress.failed} 个可用，${progress.failed} 个失败`);
      } catch {
        if (generation !== pollGeneration) return;
        finished.add(task.task_id);
        message.error("测试进度获取失败");
      }
    }
    testing.value = testing.value.filter((task) => !finished.has(task.task_id));
    rememberTests();
    if (finished.size) await load();
    if (testing.value.length) pollTest();
  }, TEST_POLL_MS);
}

async function clearQueue() {
  if (clearingQueue.value) return;
  clearingQueue.value = true;
  try {
    const result = await api.clearTestQueue();
    pollGeneration += 1;
    window.clearTimeout(testTimer);
    testing.value = [];
    rememberTests();
    message.success(`已取消 ${result.cancelled} 轮测试`);
    await load();
  } catch (reason) {
    message.error(reason instanceof Error ? reason.message : "清空队列失败");
  } finally {
    clearingQueue.value = false;
  }
}

async function resetScores() {
  try {
    const result = await api.resetScores(sourceType.value);
    message.success(`已清空 ${result.reset} 个源的测试记录`);
    await load();
  } catch (reason) {
    message.error(reason instanceof Error ? reason.message : "清空失败");
  }
}

onUnmounted(() => window.clearTimeout(testTimer));

async function load() {
  loading.value = true;
  error.value = "";
  try {
    page.value = await api.pool({
      source_type: sourceType.value,
      state: state.value,
      sort: sort.value,
      q: keyword.value.trim(),
      limit: pageSize.value,
      offset: (pageNo.value - 1) * pageSize.value,
    });
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : "加载失败";
  } finally {
    loading.value = false;
  }
}

function reload() {
  selectedIds.value = [];
  pageNo.value = 1;
  return load();
}

function setPageSize(size: number) {
  pageSize.value = size;
  pageNo.value = 1;
  return load();
}

function setSort(next: DataTableSortState | null) {
  const key = next?.columnKey === "last_test_at" ? "last_test" : next?.columnKey;
  sort.value = key && next?.order ? `${key}_${next.order === "ascend" ? "asc" : "desc"}` : "rank";
  selectedIds.value = [];
  pageNo.value = 1;
  return load();
}

function setSelection(keys: Array<string | number>) {
  const visible = new Set(page.value?.items.map((item) => item.url_id) ?? []);
  selectedIds.value = [
    ...selectedIds.value.filter((id) => !visible.has(id)),
    ...keys.map(Number).filter((id) => visible.has(id)),
  ];
}

async function scanSources() {
  if (scanning.value) return;
  scanning.value = true;
  try {
    const result = await api.scan(sourceType.value);
    if (sourceType.value === "book" && result.has_explore === 0) {
      message.warning(`扫描了 ${result.scanned} 个书源，仍没有可浏览分类的源`);
    } else {
      message.success(`扫描 ${result.scanned} 个${sourceType.value === "book" ? "书源" : "订阅源"}，启用 ${result.enabled} 个`);
    }
    await reload();
  } catch (reason) {
    message.error(reason instanceof Error ? reason.message : "扫描失败");
  } finally {
    scanning.value = false;
  }
}

async function setSelectedEnabled(enabled: boolean) {
  if (bulkBusy.value || !selectedIds.value.length) return;
  bulkBusy.value = true;
  try {
    const result = await api.patchPoolSources(sourceType.value, selectedIds.value, enabled);
    selectedIds.value = [];
    await load();
    message.success(`已${enabled ? "启用" : "停用"} ${result.updated} 个源`);
  } catch (reason) {
    message.error(reason instanceof Error ? reason.message : "批量操作失败");
  } finally {
    bulkBusy.value = false;
  }
}

async function setLatestTestEnabled(outcome: "success" | "failure") {
  if (bulkBusy.value || testing.value.length) return;
  bulkBusy.value = true;
  try {
    const type = sourceType.value;
    const result = await api.patchPoolByLatestTest(type, outcome);
    message.success(`已${outcome === "success" ? "启用" : "停用"} ${result.updated} 个${type === "book" ? "书源" : "订阅源"}`);
    await load();
  } catch (reason) {
    message.error(reason instanceof Error ? reason.message : "批量操作失败");
  } finally {
    bulkBusy.value = false;
  }
}

async function patch(row: PoolSource, payload: Record<string, unknown>) {
  try {
    const updated = await api.patchPoolSource(row.source_type, row.url_id, payload);
    Object.assign(row, updated);
  } catch (reason) {
    message.error(reason instanceof Error ? reason.message : "操作失败");
    //  失败时把界面拉回真相，别让 switch 停在一个没生效的状态
    await load();
  }
}

const columns = computed<DataTableColumns<PoolSource>>(() => {
  const available: DataTableColumns<PoolSource> = [
  { type: "selection", multiple: true },
  { title: "ID", key: "url_id", width: 100, sorter: true, sortOrder: sortOrder("url_id") },
  {
    title: "名称",
    key: "name",
    sorter: true,
    sortOrder: sortOrder("name"),
    ellipsis: { tooltip: true },
    render: (row) => row.name || h("span", { class: "muted" }, `源 ${row.url_id}`),
  },
  { title: "域名", key: "domain", width: 170, ellipsis: { tooltip: true }, sorter: true, sortOrder: sortOrder("domain"), render: (row) => row.domain || h("span", { class: "muted" }, "—") },
  { title: "完整 URL", key: "source_url", ellipsis: { tooltip: true }, sorter: true, sortOrder: sortOrder("source_url"), render: (row) => row.source_url || h("span", { class: "muted" }, "—") },
  {
    title: "判定",
    key: "verdict",
    sorter: true,
    sortOrder: sortOrder("verdict"),
    width: 190,
    render: (row) =>
      h(NSpace, { size: 4 }, () => [
        row.is_complete
          ? null
          : h(NTag, { size: "tiny", type: "warning", bordered: false }, () => "规则不全"),
        row.needs_js
          ? h(NTag, { size: "tiny", type: "error", bordered: false }, () => "需要 JS")
          : null,
        row.has_explore
          ? h(NTag, { size: "tiny", type: "info", bordered: false }, () => "可浏览")
          : null,
      ]),
  },
  {
    title: "实跑",
    key: "proven",
    sorter: true,
    sortOrder: sortOrder("proven"),
    width: 160,
    render: (row) => {
      //  这一列才是可用性的真相。静态判定说「能用」不代表真能跑通。
      if (row.last_ok_at) {
        return h(
          "span",
          { title: formatTime(row.last_ok_at) },
          `成功 · ${fromNow(row.last_ok_at)}`,
        );
      }
      if (row.fail_count) return h("span", { class: "bad" }, `失败 ${row.fail_count} 次`);
      return h("span", { class: "muted" }, row.test_count ? "未成功" : "没跑过");
    },
  },
  {
    title: "成功率",
    key: "success_rate",
    sorter: true,
    sortOrder: sortOrder("success_rate"),
    width: 130,
    render: (row) => {
      //  没测过给「—」而不是 0%：「没测过」和「测了全失败」在排序里差着 0.5，
      //  界面上也必须分得开，否则会以为这些源都坏了。
      if (row.success_rate === null) {
        return h("span", { class: "muted" }, "—");
      }
      const percent = Math.round(row.success_rate * 100);
      const tone = percent >= 60 ? "ok" : percent > 0 ? "warn" : "bad";
      return h(
        "span",
        { class: tone, title: `测 ${row.test_count} 次，成功 ${row.test_ok_count} 次` },
        `${percent}%  (${row.test_ok_count}/${row.test_count})`,
      );
    },
  },
  {
    title: "最近测试",
    key: "last_test_at",
    width: 140,
    sorter: true,
    sortOrder: sortOrder("last_test"),
    render: (row) => row.last_test_at
      ? h("span", { title: formatTime(row.last_test_at) }, fromNow(row.last_test_at))
      : h("span", { class: "muted" }, row.test_count ? "时间未知" : "未测试"),
  },
  {
    title: "最近错误",
    key: "last_error",
    sorter: true,
    sortOrder: sortOrder("last_error"),
    ellipsis: { tooltip: true },
    render: (row) => row.last_error || h("span", { class: "muted" }, "—"),
  },
  { title: "权重", key: "weight", width: 90, sorter: true, sortOrder: sortOrder("weight") },
  {
    title: "启用",
    key: "enabled",
    sorter: true,
    sortOrder: sortOrder("enabled"),
    width: 78,
    render: (row) =>
      h(NSwitch, {
        value: row.enabled,
        size: "small",
        "onUpdate:value": (value: boolean) => patch(row, { enabled: value }),
      }),
  },
  {
    title: "操作",
    key: "actions",
    width: 220,
    render: (row) =>
      h(NSpace, { size: 4, wrap: false }, () => [
        h(NButton, { size: "tiny", quaternary: true, onClick: () => openEditor(row) }, { icon: () => h(CreateOutline), default: () => "查看 / 编辑" }),
        row.source_type === "rss" ? h(NButton, { size: "tiny", quaternary: true, loading: optimizingId.value === row.url_id, onClick: () => optimize(row) }, { icon: () => h(SparklesOutline), default: () => "AI 优化" }) : null,
        row.fail_count ? h(
            NButton,
            { size: "tiny", quaternary: true, onClick: () => patch(row, { reset_failures: true }) },
            () => "清失败",
          ) : null,
      ]),
  },
  ];
  return available.filter((column) => !('key' in column) || column.key === "name" || column.key === "actions" || visibleColumns.value.includes(String(column.key)));
});

onMounted(() => {
  try {
    const ids = JSON.parse(sessionStorage.getItem(TEST_TASKS_KEY) || "[]");
    if (Array.isArray(ids)) {
      testing.value = ids.filter((id): id is string => typeof id === "string").map((task_id) => ({ task_id, state: "running", total: 0, done: 0, failed: 0, detail: "" }));
      if (testing.value.length) pollTest();
    }
  } catch { sessionStorage.removeItem(TEST_TASKS_KEY); }
  load();
});
</script>

<template>
  <div class="pool">
    <header class="head">
      <div>
        <h1 class="head__title">候选源池</h1>
        <p class="head__sub">书源和订阅源规则</p>
      </div>
      <n-space>
        <n-button type="primary" :loading="scanning" :disabled="Boolean(testing.length) || bulkBusy" @click="scanSources">
          <template #icon><n-icon><RefreshOutline /></n-icon></template>
          扫描{{ sourceType === "book" ? "书源" : "订阅源" }}
        </n-button>
        <n-button quaternary circle aria-label="刷新" :loading="loading" @click="load">
          <template #icon><n-icon><RefreshOutline /></n-icon></template>
        </n-button>
      </n-space>
    </header>

    <section v-if="summary" class="summary">
      <div class="stat">
        <span class="stat__value">{{ summary.total }}</span>
        <span class="stat__label">总数</span>
      </div>
      <div class="stat">
        <span class="stat__value">{{ summary.enabled }}</span>
        <span class="stat__label">已启用</span>
      </div>
      <div class="stat stat--good">
        <span class="stat__value">{{ summary.proven }}</span>
        <span class="stat__label">实跑成功过</span>
      </div>
      <div class="stat stat--bad">
        <span class="stat__value">{{ summary.failing }}</span>
        <span class="stat__label">有失败记录</span>
      </div>
      <div class="stat">
        <span class="stat__value">{{ summary.needs_js }}</span>
        <span class="stat__label">需要 JS</span>
      </div>
      <div class="stat">
        <span class="stat__value">{{ summary.has_explore }}</span>
        <span class="stat__label">可浏览分类</span>
      </div>
    </section>

    <div class="filters">
      <n-select v-model:value="sourceType" :options="TYPE_OPTIONS" class="filters__type" :disabled="scanning || bulkBusy" @update:value="reload" />
      <n-select v-model:value="state" :options="STATE_OPTIONS" class="filters__state" @update:value="reload" />
      <n-select v-model:value="sort" :options="sortOptions" class="filters__sort" @update:value="reload" />
      <n-input v-model:value="keyword" class="filters__keyword" placeholder="搜源名" clearable @keyup.enter="reload" @clear="reload">
        <template #prefix><n-icon><SearchOutline /></n-icon></template>
      </n-input>
      <n-button type="primary" @click="reload">查询</n-button>
      <n-popover trigger="click" placement="bottom-end">
        <template #trigger><n-button aria-label="选择显示列"><template #icon><n-icon><OptionsOutline /></n-icon></template>列设置</n-button></template>
        <n-checkbox-group :value="visibleColumns" @update:value="(keys: (string | number)[]) => setVisibleColumns(keys.map(String))">
          <div class="column-picker"><n-checkbox v-for="item in COLUMN_OPTIONS" :key="item.value" :value="item.value" :label="item.label" /></div>
        </n-checkbox-group>
      </n-popover>
    </div>

    <div class="testbar">
      <div class="testbar__main">
        <span v-if="selectedIds.length">已选 {{ selectedIds.length }} 个</span>
        <n-button v-if="selectedIds.length" size="small" quaternary @click="selectedIds = []">清空选择</n-button>
        <n-button size="small" :disabled="!selectedIds.length || bulkBusy || scanning" @click="setSelectedEnabled(true)">批量启用</n-button>
        <n-button size="small" :disabled="!selectedIds.length || bulkBusy || scanning" @click="setSelectedEnabled(false)">批量停用</n-button>
        <n-button size="small" :disabled="!selectedIds.length || bulkBusy || submittingTest || scanning" @click="startTest(selectedIds)">测试已选</n-button>
        <n-button
          type="primary"
          secondary
          :loading="submittingTest"
          :disabled="bulkBusy || scanning"
          @click="startTest()"
        >
          批量测试
        </n-button>
        <n-button size="small" :disabled="submittingTest || scanning" @click="testAll">一键测试全部</n-button>
        <n-popconfirm @positive-click="setLatestTestEnabled('failure')">
          <template #trigger><n-button size="small" :disabled="!page?.summary.last_test_failed_enabled || bulkBusy || scanning || Boolean(testing.length)">最近一次失败的停用 ({{ page?.summary.last_test_failed_enabled ?? 0 }})</n-button></template>
          停用当前类型中最近一次主动测试失败、目前仍启用的 {{ page?.summary.last_test_failed_enabled ?? 0 }} 个源？
        </n-popconfirm>
        <n-popconfirm @positive-click="setLatestTestEnabled('success')">
          <template #trigger><n-button size="small" :disabled="!page?.summary.last_test_success_disabled || bulkBusy || scanning || Boolean(testing.length)">最近一次成功的启用 ({{ page?.summary.last_test_success_disabled ?? 0 }})</n-button></template>
          启用当前类型中最近一次主动测试成功、目前已停用的 {{ page?.summary.last_test_success_disabled ?? 0 }} 个源？
        </n-popconfirm>
        <n-input-number
          v-model:value="testLimit"
          :min="1"
          :max="500"
          :step="10"
          size="small"
          class="testbar__limit"
          :disabled="submittingTest"
        />
        <n-checkbox v-model:checked="untestedOnly" :disabled="submittingTest">
          只测没测过的
        </n-checkbox>
        <n-popconfirm @positive-click="resetScores">
          <template #trigger>
            <n-button size="small" quaternary :disabled="Boolean(testing.length)">清空成绩</n-button>
          </template>
          会把当前类型下所有源的测试次数与成功次数清零，排序回到未测状态。确定吗？
        </n-popconfirm>
        <n-button v-if="testing.length" size="small" type="error" secondary :loading="clearingQueue" @click="clearQueue"><template #icon><n-icon><TrashOutline /></n-icon></template>清空测试队列</n-button>
      </div>
      <n-progress
        v-if="testing.length"
        type="line"
        :percentage="testTotal ? Math.round((testDone / testTotal) * 100) : 0"
        :indicator-placement="'inside'"
      />
      <span v-if="testing.length" class="testbar__status">{{ testing.length }} 轮测试 · {{ testDone }}/{{ testTotal }}</span>
    </div>

    <n-alert v-if="error" type="error" :title="error" class="alert" />

    <div class="table-scroll">
      <n-data-table
        :columns="columns"
        :data="page?.items ?? []"
        :loading="loading"
        :row-key="(row: PoolSource) => row.url_id"
        :checked-row-keys="selectedIds"
        @update:checked-row-keys="setSelection"
        size="small"
        :bordered="false"
        remote
        @update:sorter="setSort"
      />
    </div>

    <div v-if="page?.items.length" class="mobile-pool-list">
      <n-checkbox :checked="allVisibleSelected" :indeterminate="partlyVisibleSelected" @update:checked="toggleVisible">选择当前页</n-checkbox>
      <article v-for="item in page.items" :key="item.url_id" class="mobile-pool">
        <div class="mobile-pool__head">
          <n-checkbox
            :checked="selectedIds.includes(item.url_id)"
            :aria-label="`选择 ${item.name || `源 ${item.url_id}`}`"
            @update:checked="(checked: boolean) => toggleVisibleItem(item.url_id, checked)"
          />
          <strong>{{ item.name || `源 ${item.url_id}` }}</strong>
          <n-switch :value="item.enabled" size="small" :aria-label="`${item.enabled ? '停用' : '启用'} ${item.name || item.url_id}`" @update:value="(value: boolean) => patch(item, { enabled: value })" />
        </div>
        <div v-if="item.domain" class="mobile-pool__domain">{{ item.domain }}</div>
        <div class="mobile-pool__meta">
          <span v-if="!item.is_complete">规则不全</span>
          <span v-if="item.needs_js">需要 JS</span>
          <span v-if="item.has_explore">可浏览</span>
          <span v-if="item.last_ok_at">成功 · {{ fromNow(item.last_ok_at) }}</span>
          <span v-else-if="item.fail_count">失败 {{ item.fail_count }} 次</span>
          <span v-else>未实跑</span>
          <span v-if="item.success_rate !== null">测试 {{ Math.round(item.success_rate * 100) }}%</span>
          <span v-if="item.last_test_at" :title="formatTime(item.last_test_at)">最近测试 {{ fromNow(item.last_test_at) }}</span>
          <span v-else>{{ item.test_count ? "时间未知" : "未测试" }}</span>
        </div>
        <div v-if="item.last_error" class="mobile-pool__error">{{ item.last_error }}</div>
        <n-button size="small" quaternary class="mobile-pool__reset" @click="openEditor(item)"><template #icon><n-icon><CreateOutline /></n-icon></template>查看 / 编辑</n-button>
        <n-button v-if="item.source_type === 'rss'" size="small" quaternary class="mobile-pool__reset" :loading="optimizingId === item.url_id" @click="optimize(item)"><template #icon><n-icon><SparklesOutline /></n-icon></template>AI 优化</n-button>
        <n-button v-if="item.fail_count" size="small" quaternary class="mobile-pool__reset" @click="patch(item, { reset_failures: true })">清失败记录</n-button>
      </article>
    </div>

    <n-pagination
      v-if="page && page.total > 0"
      v-model:page="pageNo"
      :page-count="Math.ceil(page.total / pageSize)"
      :page-size="pageSize"
      show-size-picker
      :page-sizes="[10, 20, 50, 100, 500, 1000]"
      class="pager"
      @update:page="load"
      @update:page-size="setPageSize"
    />

    <n-modal v-model:show="editorOpen" preset="card" class="rules-modal" :title="editing?.source.name || '源规则'" :mask-closable="!editorSaving">
      <n-spin :show="editorLoading">
        <n-alert v-if="editorError" type="error" :title="editorError" class="alert" />
        <n-alert v-if="editorHint" type="info" :title="editorHint" class="alert" />
        <template v-if="editing">
          <dl class="rules-meta">
            <div><dt>原始地址</dt><dd>{{ editing.source.source_url || '未填写' }}</dd></div>
            <div><dt>索引标识</dt><dd>{{ editing.index_key || '无' }}</dd></div>
            <div><dt>状态</dt><dd>{{ editing.source.enabled ? '已启用' : '已停用' }} · {{ editing.source.is_complete ? '规则完整' : '规则不全' }} · {{ editing.source.has_explore ? '可浏览' : '不可浏览' }}</dd></div>
          </dl>
          <n-input v-model:value="editorText" type="textarea" :autosize="{ minRows: 16, maxRows: 26 }" spellcheck="false" aria-label="源规则 JSON" class="rules-editor" />
          <div class="rules-actions">
            <n-button @click="editorOpen = false">关闭</n-button>
            <n-button type="primary" :loading="editorSaving" :disabled="optimizingId !== null" @click="saveEditor">保存规则</n-button>
          </div>
        </template>
      </n-spin>
    </n-modal>
  </div>
</template>

<style scoped>
.pool {
  width: 100%;
}

.head {
  display: flex;
  gap: var(--space-3);
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: var(--space-4);
}

.head__title {
  margin: 0 0 4px;
  font-size: 20px;
  font-weight: 600;
}

.head__sub {
  max-width: 60ch;
  margin: 0;
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-muted);
}

.summary {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  margin-bottom: var(--space-4);
  border-top: 1px solid var(--border-subtle);
  border-bottom: 1px solid var(--border-subtle);
}

.stat {
  min-width: 0;
  padding: var(--space-3) var(--space-4);
  border-right: 1px solid var(--border-subtle);
}

.stat:last-child { border-right: 0; }

.stat__value {
  display: block;
  font-size: 20px;
  font-weight: 600;
  line-height: 1.2;
}

.stat__label {
  font-size: 11px;
  color: var(--text-muted);
}

.stat--good .stat__value {
  color: #18a058;
}

.stat--bad .stat__value {
  color: #d03050;
}

.filters {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin-bottom: var(--space-3);
}

.filters__type {
  width: 120px;
}

.filters__state {
  width: 140px;
}

.filters__sort {
  width: 180px;
}

.filters__keyword { width: 220px; flex: 1 1 220px; max-width: 360px; }

.column-picker { display: grid; grid-template-columns: repeat(2, minmax(100px, 1fr)); gap: 8px 16px; }
.mobile-pool__domain { color: var(--text-muted); font-size: 12px; overflow-wrap: anywhere; }

.rules-modal { width: min(900px, calc(100vw - 32px)); }
.rules-meta { display: grid; gap: 8px; margin: 0 0 16px; font-size: 12px; }
.rules-meta div { display: grid; grid-template-columns: 72px minmax(0, 1fr); gap: 12px; }
.rules-meta dt { color: var(--text-muted); }
.rules-meta dd { margin: 0; overflow-wrap: anywhere; }
.rules-editor :deep(textarea) { font-family: monospace; }
.rules-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }

.testbar {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: var(--space-3, 12px);
  margin-bottom: var(--space-3, 12px);
  background: var(--surface-raised);
  border: 1px solid var(--border-subtle);
  border-radius: 6px;
}

.testbar__main {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
}

.testbar__limit {
  width: 110px;
}

.alert {
  margin-bottom: var(--space-3);
}

.pager {
  justify-content: flex-end;
  margin-top: var(--space-3);
}

:deep(.muted) {
  color: var(--text-muted);
}

:deep(.bad) {
  color: #d03050;
}

:deep(.ok) {
  color: #18a058;
}

:deep(.warn) {
  color: #f0a020;
}

.mobile-pool-list { display: none; }

@media (max-width: 900px) {
  .head { align-items: flex-start; }
  .summary { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .stat:nth-child(3) { border-right: 0; }
  .stat:nth-child(-n+3) { border-bottom: 1px solid var(--border-subtle); }
}

@media (max-width: 540px) {
  .head { flex-direction: column; }
  .summary { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .stat:nth-child(3) { border-right: 1px solid var(--border-subtle); }
  .stat:nth-child(even) { border-right: 0; }
  .stat:nth-child(4) { border-bottom: 1px solid var(--border-subtle); }
  .filters__type, .filters__state, .filters__sort { flex: 1; width: auto; }
  .filters__keyword { flex-basis: 100%; max-width: none; }
  .table-scroll { display: none; }
  .mobile-pool-list { display: grid; gap: 10px; }
  .mobile-pool {
    display: grid;
    gap: 10px;
    padding: 14px;
    background: var(--surface-raised);
    border: 1px solid var(--border-subtle);
    border-radius: 6px;
  }
  .mobile-pool__head { display: flex; gap: 10px; align-items: center; }
  .mobile-pool__head strong { min-width: 0; flex: 1; overflow-wrap: anywhere; }
  .mobile-pool__meta { display: flex; flex-wrap: wrap; gap: 6px 12px; font-size: 12px; color: var(--text-muted); }
  .mobile-pool__error { overflow-wrap: anywhere; font-size: 12px; color: var(--danger); }
  .mobile-pool__reset { justify-self: start; }
}
</style>
