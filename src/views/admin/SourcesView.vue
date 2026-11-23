<script setup lang="ts">
/**
 * 采集源管理：统一采用 Naive UI `NDataTable` + 服务端分页/排序/筛选，与候选源池保持一致。
 */
import {
  AddOutline,
  CloudUploadOutline,
  EllipsisHorizontalOutline,
  RefreshOutline,
  SearchOutline,
} from "@vicons/ionicons5";
import type { DataTableColumns, DataTableSortState, DropdownOption } from "naive-ui";
import {
  NButton,
  NDropdown,
  NIcon,
  NSpace,
  NSwitch,
  NTag,
  NText,
  NTooltip,
  useDialog,
  useMessage,
} from "naive-ui";
import { computed, h, onBeforeUnmount, onMounted, ref, watch } from "vue";

import { api } from "../../api/client";
import type { Source, SourceSummary, SourceType } from "../../api/types";
import { useOperationQueue } from "../../composables/useOperationQueue";
import { formatTime, fromNow, SOURCE_TYPE_LABEL } from "../../utils/display";

const message = useMessage();
const dialog = useDialog();

const sourceType = ref<SourceType | null>(null);
const enabledFilter = ref<"true" | "false" | null>(null);
const sourceQuery = ref("");
const sort = ref("id_desc");
const page = ref(1);
const size = ref(20);
const items = ref<Source[]>([]);
const total = ref(0);
const serverSummary = ref<SourceSummary | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);
const selectedIds = ref<number[]>([]);

const enabledOptions = [
  { label: "已启用", value: "true" },
  { label: "已停用", value: "false" },
];
const sourceTypeOptions = Object.entries(SOURCE_TYPE_LABEL).map(([value, label]) => ({
  label,
  value,
}));

const summary = computed<SourceSummary>(() => {
  if (serverSummary.value) return serverSummary.value;
  return {
    total: total.value,
    enabled: items.value.filter((s) => s.enabled).length,
    failing: items.value.filter((s) => s.consecutive_failures > 0).length,
    total_rules: items.value.reduce((acc, s) => acc + Math.max(0, s.source_count), 0),
  };
});

let searchTimer: number | undefined;
let loadVersion = 0;

async function refresh(): Promise<void> {
  const version = ++loadVersion;
  loading.value = true;
  error.value = null;
  try {
    const data = await api.listSources({
      source_type: sourceType.value,
      enabled: enabledFilter.value === null ? null : enabledFilter.value === "true",
      keyword: sourceQuery.value.trim() || null,
      sort: sort.value,
      limit: size.value,
      offset: (page.value - 1) * size.value,
    });
    if (version !== loadVersion) return;
    items.value = data.items;
    total.value = data.total;
    serverSummary.value = data.summary ?? null;
    const currentIds = new Set(data.items.map((source) => source.id));
    selectedIds.value = selectedIds.value.filter((id) => currentIds.has(id));
  } catch (reason) {
    if (version !== loadVersion) return;
    error.value = reason instanceof Error ? reason.message : String(reason);
    items.value = [];
  } finally {
    if (version === loadVersion) loading.value = false;
  }
}

function reload(): void {
  page.value = 1;
  selectedIds.value = [];
  void refresh();
}

function setSize(next: number): void {
  size.value = next;
  page.value = 1;
  void refresh();
}

function setPage(next: number): void {
  page.value = next;
  void refresh();
}

watch([sourceType, enabledFilter], reload);
watch(sourceQuery, () => {
  if (searchTimer !== undefined) window.clearTimeout(searchTimer);
  searchTimer = window.setTimeout(reload, 240);
});

onBeforeUnmount(() => {
  if (searchTimer !== undefined) window.clearTimeout(searchTimer);
});

function sortOrder(key: string): "ascend" | "descend" | false {
  return sort.value === `${key}_asc` ? "ascend" : sort.value === `${key}_desc` ? "descend" : false;
}

function onSorterUpdate(sorter: DataTableSortState | DataTableSortState[] | null): void {
  const active = Array.isArray(sorter) ? sorter[0] : sorter;
  if (!active || !active.order) {
    sort.value = "id_desc";
  } else {
    sort.value = `${String(active.columnKey)}_${active.order === "ascend" ? "asc" : "desc"}`;
  }
  page.value = 1;
  void refresh();
}

const selectedSources = computed(() => {
  const ids = new Set(selectedIds.value);
  return items.value.filter((source) => ids.has(source.id));
});
const allSelected = computed(
  () => items.value.length > 0 && items.value.every((source) => selectedIds.value.includes(source.id)),
);
const partlySelected = computed(
  () => !allSelected.value && items.value.some((source) => selectedIds.value.includes(source.id)),
);

function toggleSelected(id: number, checked: boolean): void {
  const ids = new Set(selectedIds.value);
  if (checked) ids.add(id);
  else ids.delete(id);
  selectedIds.value = [...ids];
}

function toggleAll(checked: boolean): void {
  selectedIds.value = checked ? items.value.map((s) => s.id) : [];
}

const showCreate = ref(false);
const creating = ref(false);
const newUrl = ref("");
const supported = ref<SourceType[]>([]);

async function create(): Promise<void> {
  const url = newUrl.value.trim();
  if (!url) {
    message.warning("请填写采集源地址");
    return;
  }
  creating.value = true;
  try {
    await api.createSource(url);
    message.success("已登记");
    showCreate.value = false;
    newUrl.value = "";
    await refresh();
  } catch (reason) {
    message.error(reason instanceof Error ? reason.message : String(reason));
  } finally {
    creating.value = false;
  }
}

type OperationKind = "collect" | "enable" | "disable" | "reset-cursor" | "delete";

const queue = useOperationQueue({
  concurrency: 4,
  onSuccess: (task, detail) => {
    message.success(`${task.resourceLabel}：${task.label}完成${detail ? `，${detail}` : ""}`);
  },
  onError: (task, reason) => {
    message.error(
      `${task.resourceLabel}：${task.label}失败，${reason instanceof Error ? reason.message : String(reason)}`,
    );
  },
  onCancel: (count) => message.info(`已取消 ${count} 个等待操作`),
});

function sourceLabel(source: Source): string {
  try {
    return new URL(source.url).hostname;
  } catch {
    return source.url;
  }
}

function patchSource(id: number, patch: Partial<Source>): void {
  items.value = items.value.map((source) => (source.id === id ? { ...source, ...patch } : source));
}

function hasPending(source: Source, kind: OperationKind): boolean {
  return queue.hasPending(`${kind}:${source.id}`);
}

function queueCollect(source: Source): boolean {
  return queue.enqueue({
    key: `collect:${source.id}`,
    label: "采集",
    resourceId: source.id,
    resourceLabel: sourceLabel(source),
    run: async () => {
      const report = await api.collectSource(source.id);
      const now = new Date().toISOString();
      if (!report.ok) {
        patchSource(source.id, {
          last_queried_at: now,
          consecutive_failures: source.consecutive_failures + 1,
          last_error: report.error ?? "采集失败",
        });
        throw new Error(report.error ?? "采集失败");
      }
      patchSource(source.id, {
        source_count: report.source_count,
        last_queried_at: now,
        last_success_at: now,
        consecutive_failures: 0,
        last_error: null,
      });
      return `获取 ${report.source_count} 条源`;
    },
  });
}

function queueToggle(source: Source, enabled: boolean): boolean {
  return queue.enqueue({
    key: `${enabled ? "enable" : "disable"}:${source.id}`,
    label: enabled ? "启用" : "停用",
    resourceId: source.id,
    resourceLabel: sourceLabel(source),
    run: async () => {
      const updated = await api.updateSource(source.id, enabled);
      patchSource(source.id, updated);
      return undefined;
    },
  });
}

function queueResetCursor(source: Source): boolean {
  return queue.enqueue({
    key: `reset-cursor:${source.id}`,
    label: "重置刷新时间",
    resourceId: source.id,
    resourceLabel: sourceLabel(source),
    run: async () => {
      await api.resetSourceCursor(source.id);
      patchSource(source.id, {
        last_queried_at: "2000-01-01T00:00:00",
        consecutive_failures: 0,
        last_error: null,
      });
      return undefined;
    },
  });
}

function confirmResetCursor(source: Source): void {
  dialog.warning({
    title: "重置刷新时间",
    content: `确定重置 ${sourceLabel(source)}？已有源数据不会删除，下次管线会重新采集。`,
    positiveText: "重置",
    negativeText: "取消",
    onPositiveClick: () => {
      queueResetCursor(source);
    },
  });
}

function queueRemove(source: Source): boolean {
  return queue.enqueue({
    key: `delete:${source.id}`,
    label: "删除",
    resourceId: source.id,
    resourceLabel: sourceLabel(source),
    run: async () => {
      await api.deleteSource(source.id);
      await refresh();
      return undefined;
    },
  });
}

function confirmRemove(source: Source): void {
  dialog.warning({
    title: "删除采集源",
    content: `确定删除 ${sourceLabel(source)}？已生成的具体书源/RSS 源记录会保留。`,
    positiveText: "删除",
    negativeText: "取消",
    onPositiveClick: () => {
      queueRemove(source);
    },
  });
}

const rowMenuOptions: DropdownOption[] = [
  { label: "重置刷新时间", key: "reset-cursor" },
  { type: "divider", key: "divider" },
  { label: "删除", key: "delete" },
];

function onRowMenuSelect(key: string, source: Source): void {
  if (key === "reset-cursor") confirmResetCursor(source);
  else if (key === "delete") confirmRemove(source);
}

function queueSelected(action: OperationKind): void {
  let added = 0;
  for (const source of selectedSources.value) {
    const ok =
      action === "collect"
        ? queueCollect(source)
        : action === "enable"
          ? queueToggle(source, true)
          : action === "disable"
            ? queueToggle(source, false)
            : action === "reset-cursor"
              ? queueResetCursor(source)
              : queueRemove(source);
    added += Number(ok);
  }
  message.info(added ? `已加入 ${added} 个操作` : "所选操作已在队列中");
}

function confirmSelected(action: "reset-cursor" | "delete"): void {
  const title = action === "delete" ? "删除采集源" : "重置刷新时间";
  dialog.warning({
    title,
    content: `确定对选中的 ${selectedSources.value.length} 个采集源执行“${title}”？`,
    positiveText: action === "delete" ? "删除" : "重置",
    negativeText: "取消",
    onPositiveClick: () => queueSelected(action),
  });
}

function onBulkMenuSelect(key: string): void {
  if (key === "reset-cursor" || key === "delete") confirmSelected(key);
}

const columns = computed<DataTableColumns<Source>>(() => [
  { type: "selection", width: 44 },
  {
    title: "ID",
    key: "id",
    width: 72,
    sorter: true,
    sortOrder: sortOrder("id"),
    render: (row) => h(NText, { code: true, class: "source-id" }, () => String(row.id)),
  },
  {
    title: "类型",
    key: "source_type",
    width: 96,
    sorter: true,
    sortOrder: sortOrder("source_type"),
    render: (row) =>
      h(NTag, { size: "small", bordered: false }, () => SOURCE_TYPE_LABEL[row.source_type]),
  },
  {
    title: "采集源地址",
    key: "url",
    minWidth: 260,
    ellipsis: { tooltip: true },
    sorter: true,
    sortOrder: sortOrder("url"),
    render: (row) =>
      h(
        NButton,
        {
          text: true,
          tag: "a",
          href: row.url,
          target: "_blank",
          rel: "noopener noreferrer",
          class: "source-link",
        },
        () => row.url,
      ),
  },
  {
    title: "源数量",
    key: "source_count",
    width: 96,
    sorter: true,
    sortOrder: sortOrder("source_count"),
    render: (row) => (row.source_count < 0 ? "-" : row.source_count.toLocaleString()),
  },
  {
    title: "最近采集",
    key: "last_queried_at",
    width: 120,
    sorter: true,
    sortOrder: sortOrder("last_queried_at"),
    render: (row) =>
      h(NTooltip, null, {
        trigger: () => h("span", fromNow(row.last_queried_at)),
        default: () => `最近成功：${formatTime(row.last_success_at)}`,
      }),
  },
  {
    title: "状态",
    key: "consecutive_failures",
    width: 120,
    sorter: true,
    sortOrder: sortOrder("consecutive_failures"),
    render: (row) => {
      if (row.last_error) {
        return h(NTooltip, null, {
          trigger: () =>
            h(NTag, { size: "small", type: "error" }, () => `失败 ${row.consecutive_failures} 次`),
          default: () => row.last_error,
        });
      }
      if (row.last_success_at) {
        return h(NTag, { size: "small", type: "success" }, () => "正常");
      }
      return h(NTag, { size: "small" }, () => "待采集");
    },
  },
  {
    title: "启用",
    key: "enabled",
    width: 78,
    sorter: true,
    sortOrder: sortOrder("enabled"),
    render: (row) =>
      h(NSwitch, {
        size: "small",
        value: row.enabled,
        loading: hasPending(row, "enable") || hasPending(row, "disable"),
        "aria-label": `${row.enabled ? "停用" : "启用"} ${sourceLabel(row)}`,
        onUpdateValue: (enabled: boolean) => queueToggle(row, enabled),
      }),
  },
  {
    title: "操作",
    key: "actions",
    width: 116,
    render: (row) =>
      h(NSpace, { size: 4, wrap: false }, () => [
        h(
          NButton,
          {
            size: "tiny",
            loading: hasPending(row, "collect"),
            onClick: () => queueCollect(row),
          },
          () => "采集",
        ),
        h(
          NDropdown,
          {
            trigger: "click",
            options: rowMenuOptions,
            onSelect: (key: string) => onRowMenuSelect(key, row),
          },
          {
            default: () =>
              h(
                NButton,
                {
                  size: "tiny",
                  quaternary: true,
                  circle: true,
                  "aria-label": `${sourceLabel(row)} 更多操作`,
                },
                { icon: () => h(NIcon, null, () => h(EllipsisHorizontalOutline)) },
              ),
          },
        ),
      ]),
  },
]);

function rowClassName(row: Source): string {
  return row.consecutive_failures > 0 ? "row-failing" : "";
}

onMounted(async () => {
  void refresh();
  try {
    supported.value = await api.supportedSourceTypes();
  } catch {
    // The type hint is secondary; list management remains available.
  }
});
</script>

<template>
  <section class="page">
    <n-space align="center" justify="space-between" class="head" :wrap="true">
      <div class="head__left">
        <n-space align="center" :size="8">
          <n-icon size="22" color="var(--accent)"><CloudUploadOutline /></n-icon>
          <n-h2 class="title">采集源</n-h2>
        </n-space>
        <p class="head__sub">管理书源与订阅源列表 URL，定时或手动拉取规则进入候选源池。</p>
      </div>
      <n-space>
        <n-button size="small" :loading="loading" @click="refresh">
          <template #icon><n-icon><RefreshOutline /></n-icon></template>
          刷新
        </n-button>
        <n-button size="small" type="primary" @click="showCreate = true">
          <template #icon><n-icon><AddOutline /></n-icon></template>
          登记采集源
        </n-button>
      </n-space>
    </n-space>

    <!-- 概览统计条，与候选源池统一视觉语言 -->
    <div class="summary mb">
      <div class="stat">
        <span class="stat__value">{{ summary.total.toLocaleString() }}</span>
        <span class="stat__label">采集源总数</span>
      </div>
      <div class="stat stat--good">
        <span class="stat__value">{{ summary.enabled.toLocaleString() }}</span>
        <span class="stat__label">已启用</span>
      </div>
      <div class="stat" :class="{ 'stat--bad': summary.failing > 0 }">
        <span class="stat__value">{{ summary.failing.toLocaleString() }}</span>
        <span class="stat__label">存在失败</span>
      </div>
      <div class="stat">
        <span class="stat__value">{{ summary.total_rules.toLocaleString() }}</span>
        <span class="stat__label">累计规则数</span>
      </div>
    </div>

    <div class="filter-row mb">
      <n-input v-model:value="sourceQuery" clearable placeholder="搜索采集地址" class="query-filter">
        <template #prefix><n-icon><SearchOutline /></n-icon></template>
      </n-input>
      <n-select
        v-model:value="sourceType"
        :options="sourceTypeOptions"
        clearable
        placeholder="全部类型"
        class="type-filter"
      />
      <n-select
        v-model:value="enabledFilter"
        :options="enabledOptions"
        clearable
        placeholder="全部状态"
        class="status-filter"
      />
      <n-text depth="3" class="filter-count">{{ items.length }} / {{ total }} 个</n-text>
    </div>

    <n-alert v-if="error" type="error" class="mb">{{ error }}</n-alert>

    <div
      v-if="selectedSources.length > 0 || queue.runningCount.value + queue.queuedCount.value > 0"
      class="operation-bar"
    >
      <n-space v-if="selectedSources.length > 0" align="center" :size="8" wrap>
        <n-text>已选 {{ selectedSources.length }} 个</n-text>
        <n-button size="tiny" @click="queueSelected('collect')">采集</n-button>
        <n-button size="tiny" @click="queueSelected('enable')">启用</n-button>
        <n-button size="tiny" @click="queueSelected('disable')">停用</n-button>
        <n-dropdown trigger="click" :options="rowMenuOptions" @select="onBulkMenuSelect">
          <n-button size="tiny">
            更多
            <template #icon><n-icon><EllipsisHorizontalOutline /></n-icon></template>
          </n-button>
        </n-dropdown>
      </n-space>
      <n-space
        v-if="queue.runningCount.value + queue.queuedCount.value > 0"
        align="center"
        :size="8"
        class="queue-status"
      >
        <n-text depth="3" role="status" aria-live="polite">
          执行中 {{ queue.runningCount.value }}，等待 {{ queue.queuedCount.value }}
        </n-text>
        <n-button
          size="tiny"
          :disabled="queue.queuedCount.value === 0"
          aria-label="取消所有等待中的操作"
          @click="queue.cancelQueued"
        >
          取消
        </n-button>
      </n-space>
    </div>

    <div class="table-scroll">
      <n-data-table
        remote
        striped
        size="small"
        :loading="loading"
        :columns="columns"
        :data="items"
        :row-key="(row: Source) => row.id"
        :checked-row-keys="selectedIds"
        :row-class-name="rowClassName"
        class="source-table"
        @update:checked-row-keys="(keys: Array<string | number>) => (selectedIds = keys.map(Number))"
        @update:sorter="onSorterUpdate"
      >
        <template #empty>
          <n-empty :description="summary.total ? '没有匹配的采集源' : '还没有采集源'" class="empty">
            <template #extra>
              <n-button v-if="!summary.total" size="small" @click="showCreate = true">登记第一个</n-button>
            </template>
          </n-empty>
        </template>
      </n-data-table>
    </div>

    <div v-if="!loading && items.length" class="mobile-source-list">
      <n-checkbox :checked="allSelected" :indeterminate="partlySelected" @update:checked="toggleAll">
        选择当前页
      </n-checkbox>
      <article v-for="source in items" :key="source.id" class="mobile-source">
        <div class="mobile-source__head">
          <n-checkbox
            :checked="selectedIds.includes(source.id)"
            :aria-label="`选择 ${sourceLabel(source)}`"
            @update:checked="(checked: boolean) => toggleSelected(source.id, checked)"
          />
          <span class="mobile-source__name">{{ sourceLabel(source) }}</span>
          <n-tag size="small" :bordered="false">{{ SOURCE_TYPE_LABEL[source.source_type] }}</n-tag>
        </div>
        <a class="mobile-source__url" :href="source.url" target="_blank" rel="noopener noreferrer">
          {{ source.url }}
        </a>
        <div class="mobile-source__meta">
          <span>{{ source.source_count < 0 ? "待采集" : `${source.source_count.toLocaleString()} 条规则` }}</span>
          <span>{{ fromNow(source.last_queried_at) }}</span>
          <n-tag v-if="source.last_error" size="small" type="error">失败 {{ source.consecutive_failures }} 次</n-tag>
        </div>
        <div class="mobile-source__actions">
          <n-switch
            size="small"
            :value="source.enabled"
            :loading="hasPending(source, 'enable') || hasPending(source, 'disable')"
            :aria-label="`${source.enabled ? '停用' : '启用'} ${sourceLabel(source)}`"
            @update:value="(enabled: boolean) => queueToggle(source, enabled)"
          />
          <span class="mobile-source__spacer" />
          <n-button size="small" :loading="hasPending(source, 'collect')" @click="queueCollect(source)">
            采集
          </n-button>
          <n-dropdown trigger="click" :options="rowMenuOptions" @select="(key: string) => onRowMenuSelect(key, source)">
            <n-button size="small" quaternary circle :aria-label="`${sourceLabel(source)} 更多操作`">
              <template #icon><n-icon><EllipsisHorizontalOutline /></n-icon></template>
            </n-button>
          </n-dropdown>
        </div>
      </article>
    </div>

    <n-pagination
      v-if="total > size"
      class="pager"
      :page="page"
      :page-size="size"
      :item-count="total"
      show-quick-jumper
      show-size-picker
      :page-sizes="[10, 20, 50, 100]"
      @update:page="setPage"
      @update:page-size="setSize"
    />

    <n-modal v-model:show="showCreate" preset="card" title="登记采集源" class="create-modal">
      <n-form-item label="采集源地址" :show-feedback="false">
        <n-input
          v-model:value.trim="newUrl"
          placeholder="https://example.com/sources.json"
          @keyup.enter="create"
        />
      </n-form-item>
      <n-text depth="3" class="hint">
        类型会按内容自动识别。当前支持：{{ supported.map((type) => SOURCE_TYPE_LABEL[type]).join("、") || "加载中…" }}
      </n-text>
      <template #footer>
        <n-space justify="end">
          <n-button size="small" @click="showCreate = false">取消</n-button>
          <n-button size="small" type="primary" :loading="creating" @click="create">登记</n-button>
        </n-space>
      </template>
    </n-modal>
  </section>
</template>

<style scoped>
.page {
  width: 100%;
}

.head,
.mb {
  margin-bottom: 16px;
}

.head__left {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.head__sub {
  margin: 0;
  font-size: 12px;
  color: var(--text-muted);
}

.title {
  margin: 0;
}

.summary {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  background: var(--surface-raised);
  border: 1px solid var(--border-subtle);
  border-radius: 10px;
  overflow: hidden;
}

.stat {
  min-width: 0;
  padding: 12px 16px;
  border-right: 1px solid var(--border-subtle);
}

.stat:last-child {
  border-right: 0;
}

.stat__value {
  display: block;
  font-size: 20px;
  font-weight: 650;
  line-height: 1.25;
  font-variant-numeric: tabular-nums;
}

.stat__label {
  font-size: 12px;
  color: var(--text-muted);
}

.stat--good .stat__value {
  color: var(--accent);
}

.stat--bad .stat__value {
  color: var(--danger);
}

.type-filter {
  width: 140px;
}

.status-filter {
  width: 130px;
}

.filter-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
}

.query-filter {
  flex: 1 1 230px;
  max-width: 420px;
}

.filter-count {
  margin-left: auto;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

.operation-bar {
  min-height: 44px;
  margin-bottom: 12px;
  padding: 8px 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  background: var(--accent-soft);
}

.queue-status {
  flex: none;
  font-variant-numeric: tabular-nums;
}

.source-table {
  min-width: 960px;
}

.source-table :deep(tr.row-failing td:first-child) {
  box-shadow: inset 3px 0 0 var(--danger);
}

:deep(.source-id) {
  font-size: 11px;
}

:deep(.source-link) {
  max-width: 100%;
}

.empty {
  padding: 36px 0;
}

.pager {
  margin-top: 20px;
  justify-content: flex-end;
}

.create-modal {
  width: min(520px, calc(100vw - 32px));
}

.hint {
  display: block;
  margin-top: 8px;
  font-size: 12px;
}

.mobile-source-list {
  display: none;
}

@media (max-width: 700px) {
  .summary {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .stat:nth-child(2) {
    border-right: 0;
  }
  .stat:nth-child(-n + 2) {
    border-bottom: 1px solid var(--border-subtle);
  }
  .table-scroll {
    display: none;
  }
  .mobile-source-list {
    display: grid;
    gap: 10px;
  }
  .mobile-source {
    display: grid;
    gap: 10px;
    padding: 14px;
    background: var(--surface-raised);
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
  }
  .mobile-source__head,
  .mobile-source__meta,
  .mobile-source__actions {
    display: flex;
    gap: 10px;
    align-items: center;
  }
  .mobile-source__name {
    min-width: 0;
    flex: 1;
    overflow: hidden;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .mobile-source__url {
    overflow-wrap: anywhere;
    color: var(--accent-secondary);
    font-size: 13px;
    line-height: 1.45;
  }
  .mobile-source__meta {
    flex-wrap: wrap;
    font-size: 12px;
    color: var(--text-muted);
  }
  .mobile-source__actions {
    padding-top: 8px;
    border-top: 1px solid var(--border-subtle);
  }
  .mobile-source__spacer {
    flex: 1;
  }
  .type-filter,
  .status-filter {
    flex: 1 1 calc(50% - 6px);
    width: auto;
  }
  .query-filter {
    flex-basis: 100%;
    max-width: none;
  }
  .filter-count {
    margin-left: 0;
  }
}
</style>
