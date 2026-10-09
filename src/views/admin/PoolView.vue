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
import { computed, h, onMounted, ref } from "vue";

import { api } from "../../api/client";
import type { PoolPage, PoolSource, SourceType } from "../../api/types";
import { formatTime, fromNow } from "../../utils/display";

defineProps<{ dark: boolean }>();
defineEmits<{ toggleTheme: [] }>();

const message = useMessage();

const page = ref<PoolPage | null>(null);
const loading = ref(false);
const error = ref("");

const sourceType = ref<SourceType>("book");
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
  pageNo.value = 1;
  return load();
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
      <n-button quaternary circle aria-label="刷新" :loading="loading" @click="load">
        <template #icon><n-icon><RefreshOutline /></n-icon></template>
      </n-button>
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
      「已启用」是扫描时的静态判定（规则完整、不需要 JS）；
      <b>「实跑成功过」才是真实可用性</b> —— 采集侧的可达标记只代表某次 GET 过站点
      首页，实测预测力极差。
    </p>

    <div class="filters">
      <n-select v-model:value="sourceType" :options="TYPE_OPTIONS" class="filters__type" @update:value="reload" />
      <n-select v-model:value="state" :options="STATE_OPTIONS" class="filters__state" @update:value="reload" />
      <n-input v-model:value="keyword" placeholder="搜源名" clearable @keyup.enter="reload" @clear="reload">
        <template #prefix><n-icon><SearchOutline /></n-icon></template>
      </n-input>
      <n-button type="primary" @click="reload">查询</n-button>
    </div>

    <n-alert v-if="error" type="error" :title="error" class="alert" />

    <div class="table-scroll">
      <n-data-table
        :columns="columns"
        :data="page?.items ?? []"
        :loading="loading"
        :row-key="(row: PoolSource) => `${row.source_type}-${row.url_id}`"
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
</style>
