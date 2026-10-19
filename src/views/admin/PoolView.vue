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
import { RefreshOutline, SearchOutline } from "@vicons/ionicons5";
import type { DataTableColumns } from "naive-ui";
import { NButton, NSpace, NSwitch, NTag, useMessage } from "naive-ui";
import { computed, h, onMounted, onUnmounted, ref } from "vue";
import { useRoute } from "vue-router";

import { api } from "../../api/client";
import type { PoolPage, PoolSource, SourceTestProgress, SourceType } from "../../api/types";
import { formatTime, fromNow } from "../../utils/display";

defineProps<{ dark: boolean }>();
defineEmits<{ toggleTheme: [] }>();

const message = useMessage();
const route = useRoute();

const page = ref<PoolPage | null>(null);
const loading = ref(false);
const scanning = ref(false);
const bulkBusy = ref(false);
const error = ref("");
const selectedIds = ref<number[]>([]);

const sourceType = ref<SourceType>(route.query.source_type === "rss" ? "rss" : "book");
const state = ref("any");
const keyword = ref("");
const pageNo = ref(1);
const pageSize = ref(50);

const STATE_OPTIONS = [
  { label: "全部", value: "any" },
  { label: "已启用", value: "enabled" },
  { label: "已停用", value: "disabled" },
  { label: "有失败记录", value: "failing" },
];

const TYPE_OPTIONS = [
  { label: "书源", value: "book" },
  { label: "订阅源", value: "rss" },
];

const summary = computed(() => page.value?.summary);

// ----------------------------------------------------------------- 批量测试
//
// 「这个源还能用吗」只有真跑一次才知道。采集侧的可达标记预测力极差，而用户搜索
// 时顺带记下的成败又太稀疏 —— 没被选中的源永远没有记录，没记录又让它更难被选中。
// 批量测试打破这个循环：每个源都测、可以反复测，累计成功率成为第一排序键。

const TEST_POLL_MS = 1500;

const testing = ref<SourceTestProgress | null>(null);
const testLimit = ref(50);
const untestedOnly = ref(false);
let testTimer: number | undefined;

async function startTest(urlIds?: number[]) {
  if (testing.value) return;
  if (urlIds && urlIds.length > 500) {
    message.warning("单次最多测试 500 个源，请缩小选择范围");
    return;
  }
  try {
    const accepted = await api.testSources({
      source_type: sourceType.value,
      limit: testLimit.value,
      untested_only: untestedOnly.value,
      ...(urlIds ? { url_ids: urlIds } : {}),
    });
    message.success(`已排入 ${accepted.queued} 个源`);
    testing.value = {
      task_id: accepted.task_id,
      state: "running",
      total: accepted.queued,
      done: 0,
      failed: 0,
      detail: "",
    };
    pollTest();
  } catch (reason) {
    message.error(reason instanceof Error ? reason.message : "启动测试失败");
  }
}

function pollTest() {
  window.clearTimeout(testTimer);
  testTimer = window.setTimeout(async () => {
    const task = testing.value;
    if (!task) return;
    try {
      const progress = await api.testProgress(task.task_id);
      testing.value = progress;
      if (progress.state === "running") {
        pollTest();
        return;
      }
      //  跑完了刷新列表 —— 成功率是第一排序键，顺序会变
      testing.value = null;
      await load();
      if (progress.state === "error") message.error(`测试中断：${progress.detail}`);
      else {
        const ok = progress.done - progress.failed;
        message.success(`测试完成：${ok} 个可用，${progress.failed} 个失败`);
      }
    } catch {
      //  任务过期（tracker 只保留 10 分钟）就别再问了
      testing.value = null;
      void load();
    }
  }, TEST_POLL_MS);
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

function setSelection(keys: Array<string | number>) {
  selectedIds.value = keys.map(Number);
}

async function scanArchive() {
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
  const failed: number[] = [];
  for (const urlId of selectedIds.value) {
    try {
      await api.patchPoolSource(sourceType.value, urlId, { enabled });
    } catch {
      failed.push(urlId);
    }
  }
  selectedIds.value = failed;
  await load();
  bulkBusy.value = false;
  if (failed.length) message.error(`${failed.length} 个源操作失败，请重试`);
  else message.success(`已${enabled ? "启用" : "停用"}所选源`);
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

const columns = computed<DataTableColumns<PoolSource>>(() => [
  { type: "selection", multiple: true },
  { title: "url_id", key: "url_id", width: 100 },
  {
    title: "名称",
    key: "name",
    ellipsis: { tooltip: true },
    render: (row) => row.name || h("span", { class: "muted" }, `源 ${row.url_id}`),
  },
  {
    title: "判定",
    key: "verdict",
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
      return h("span", { class: "muted" }, "没跑过");
    },
  },
  {
    title: "成功率",
    key: "success_rate",
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
    title: "最近错误",
    key: "last_error",
    ellipsis: { tooltip: true },
    render: (row) => row.last_error || h("span", { class: "muted" }, "—"),
  },
  { title: "权重", key: "weight", width: 72 },
  {
    title: "启用",
    key: "enabled",
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
    width: 110,
    render: (row) =>
      row.fail_count
        ? h(
            NButton,
            { size: "tiny", quaternary: true, onClick: () => patch(row, { reset_failures: true }) },
            () => "清失败",
          )
        : h("span", { class: "muted" }, "—"),
  },
]);

onMounted(load);
</script>

<template>
  <div class="pool">
    <header class="head">
      <div>
        <h1 class="head__title">候选源池</h1>
        <p class="head__sub">
          采集下来的**单个源**的可用性与启停。和「采集源」页不是一回事 ——
          那一页管的是产出源列表的 URL。
        </p>
      </div>
      <n-space>
        <n-button :loading="scanning" :disabled="Boolean(testing) || bulkBusy" @click="scanArchive">
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

    <p class="note">
      「已启用」是扫描时的静态判定（规则完整，所需运行时可用）；
      <b>「实跑成功过」才是真实可用性</b> —— 采集侧的可达标记只代表某次 GET 过站点
      首页，实测预测力极差。
    </p>

    <div class="filters">
      <n-select v-model:value="sourceType" :options="TYPE_OPTIONS" class="filters__type" :disabled="scanning || bulkBusy || Boolean(testing)" @update:value="reload" />
      <n-select v-model:value="state" :options="STATE_OPTIONS" class="filters__state" @update:value="reload" />
      <n-input v-model:value="keyword" placeholder="搜源名" clearable @keyup.enter="reload" @clear="reload">
        <template #prefix><n-icon><SearchOutline /></n-icon></template>
      </n-input>
      <n-button type="primary" @click="reload">查询</n-button>
    </div>

    <div class="testbar">
      <div class="testbar__main">
        <span v-if="selectedIds.length">已选 {{ selectedIds.length }} 个</span>
        <n-button v-if="selectedIds.length" size="small" quaternary @click="selectedIds = []">清空选择</n-button>
        <n-button size="small" :disabled="!selectedIds.length || bulkBusy || Boolean(testing) || scanning" @click="setSelectedEnabled(true)">批量启用</n-button>
        <n-button size="small" :disabled="!selectedIds.length || bulkBusy || Boolean(testing) || scanning" @click="setSelectedEnabled(false)">批量停用</n-button>
        <n-button size="small" :disabled="!selectedIds.length || bulkBusy || Boolean(testing) || scanning" @click="startTest(selectedIds)">测试已选</n-button>
        <n-button
          type="primary"
          secondary
          :loading="Boolean(testing)"
          :disabled="bulkBusy || scanning"
          @click="startTest()"
        >
          批量测试
        </n-button>
        <n-input-number
          v-model:value="testLimit"
          :min="1"
          :max="500"
          :step="10"
          size="small"
          class="testbar__limit"
          :disabled="Boolean(testing)"
        />
        <n-checkbox v-model:checked="untestedOnly" :disabled="Boolean(testing)">
          只测没测过的
        </n-checkbox>
        <n-popconfirm @positive-click="resetScores">
          <template #trigger>
            <n-button size="small" quaternary :disabled="Boolean(testing)">清空成绩</n-button>
          </template>
          会把当前类型下所有源的测试次数与成功次数清零，排序回到未测状态。确定吗？
        </n-popconfirm>
      </div>
      <p class="testbar__hint">
        {{
          sourceType === "book"
            ? "逐个用固定关键词「我的」搜一次，搜出书才算成功。"
            : "逐个真抓一次文章列表，解析出文章才算成功。"
        }}
        串行执行不并发——这些请求直接打在别人站点上。用户真实使用的结果也计入同一组统计。
      </p>
      <n-progress
        v-if="testing"
        type="line"
        :percentage="testing.total ? Math.round((testing.done / testing.total) * 100) : 0"
        :indicator-placement="'inside'"
      />
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
      />
    </div>

    <n-pagination
      v-if="page && page.total > pageSize"
      v-model:page="pageNo"
      :page-count="Math.ceil(page.total / pageSize)"
      :page-size="pageSize"
      class="pager"
      @update:page="load"
    />
  </div>
</template>

<style scoped>
.pool {
  max-width: 1200px;
  margin: 0 auto;
  padding: var(--space-4);
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
  grid-template-columns: repeat(auto-fit, minmax(110px, 1fr));
  gap: var(--space-2);
  margin-bottom: var(--space-3);
}

.stat {
  padding: var(--space-3);
  text-align: center;
  background: var(--surface-sunken);
  border-radius: 8px;
}

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

.note {
  margin: 0 0 var(--space-3);
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-muted);
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

.testbar {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: var(--space-3, 12px);
  margin-bottom: var(--space-3, 12px);
  background: rgba(128, 128, 128, 0.06);
  border-radius: 8px;
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

.testbar__hint {
  margin: 0;
  font-size: 12px;
  color: var(--text-muted, #888);
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
</style>
