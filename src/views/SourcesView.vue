<script setup lang="ts">
import {
  AddOutline,
  CloudUploadOutline,
  EllipsisHorizontalOutline,
  MoonOutline,
  RefreshOutline,
  SunnyOutline,
} from "@vicons/ionicons5";
import type { DropdownOption } from "naive-ui";
import { useDialog, useMessage } from "naive-ui";
import { computed, onMounted, ref, watch } from "vue";

import { api } from "../api/client";
import type { Source, SourceType } from "../api/types";
import { formatTime, fromNow, SOURCE_TYPE_LABEL } from "../utils/display";

defineProps<{ dark: boolean }>();
defineEmits<{ toggleTheme: [] }>();

const message = useMessage();
const dialog = useDialog();
const sourceType = ref<SourceType | null>(null);
const enabledFilter = ref<"true" | "false" | null>(null);
const enabledOptions = [
  { label: "已启用", value: "true" },
  { label: "已停用", value: "false" },
];
const sourceTypeOptions = Object.entries(SOURCE_TYPE_LABEL).map(([value, label]) => ({
  label,
  value,
}));

const PAGE_FETCH_SIZE = 200;
const allSources = ref<Source[]>([]);
const total = computed(() => allSources.value.length);
const page = ref(1);
const size = ref(20);
const loading = ref(false);
const error = ref<string | null>(null);

async function refresh(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    const collected: Source[] = [];
    for (;;) {
      const data = await api.listSources({
        source_type: sourceType.value,
        enabled: enabledFilter.value === null ? null : enabledFilter.value === "true",
        limit: PAGE_FETCH_SIZE,
        offset: collected.length,
      });
      collected.push(...data.items);
      if (data.items.length === 0 || collected.length >= data.total) break;
    }
    allSources.value = collected;
    const currentIds = new Set(collected.map((source) => source.id));
    selectedIds.value = selectedIds.value.filter((id) => currentIds.has(id));
    page.value = Math.min(page.value, Math.max(1, Math.ceil(collected.length / size.value)));
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : String(reason);
    allSources.value = [];
  } finally {
    loading.value = false;
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
}

watch([sourceType, enabledFilter], reload);

type SortKey =
  | "id"
  | "source_type"
  | "url"
  | "source_count"
  | "last_queried_at"
  | "consecutive_failures"
  | "enabled";

const sortKey = ref<SortKey | null>(null);
const sortOrder = ref<"asc" | "desc">("asc");
const sortAccessors: Record<SortKey, (source: Source) => string | number> = {
  id: (source) => source.id,
  source_type: (source) => source.source_type,
  url: (source) => source.url,
  source_count: (source) => source.source_count,
  last_queried_at: (source) => source.last_queried_at,
  consecutive_failures: (source) => source.consecutive_failures,
  enabled: (source) => Number(source.enabled),
};
const columns: { key: SortKey; label: string; width: string }[] = [
  { key: "id", label: "ID", width: "72px" },
  { key: "source_type", label: "类型", width: "100px" },
  { key: "url", label: "采集源地址", width: "auto" },
  { key: "source_count", label: "源数量", width: "100px" },
  { key: "last_queried_at", label: "最近采集", width: "130px" },
  { key: "consecutive_failures", label: "状态", width: "150px" },
  { key: "enabled", label: "启用", width: "74px" },
];

function toggleSort(key: SortKey): void {
  if (sortKey.value === key) sortOrder.value = sortOrder.value === "asc" ? "desc" : "asc";
  else {
    sortKey.value = key;
    sortOrder.value = "asc";
  }
  page.value = 1;
}

const sortedItems = computed(() => {
  if (sortKey.value === null) return allSources.value;
  const accessor = sortAccessors[sortKey.value];
  const direction = sortOrder.value === "asc" ? 1 : -1;
  return [...allSources.value].sort((left, right) => {
    const a = accessor(left);
    const b = accessor(right);
    return a < b ? -direction : a > b ? direction : 0;
  });
});

const pagedItems = computed(() => {
  const start = (page.value - 1) * size.value;
  return sortedItems.value.slice(start, start + size.value);
});

const selectedIds = ref<number[]>([]);
const selectedSources = computed(() => {
  const ids = new Set(selectedIds.value);
  return allSources.value.filter((source) => ids.has(source.id));
});
const allSelected = computed(
  () =>
    pagedItems.value.length > 0 &&
    pagedItems.value.every((source) => selectedIds.value.includes(source.id)),
);
const partlySelected = computed(
  () =>
    !allSelected.value && pagedItems.value.some((source) => selectedIds.value.includes(source.id)),
);

function toggleSelected(id: number, checked: boolean): void {
  const ids = new Set(selectedIds.value);
  checked ? ids.add(id) : ids.delete(id);
  selectedIds.value = [...ids];
}

function toggleAll(checked: boolean): void {
  const ids = new Set(selectedIds.value);
  for (const source of pagedItems.value) checked ? ids.add(source.id) : ids.delete(source.id);
  selectedIds.value = [...ids];
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

interface OperationTask {
  key: string;
  label: string;
  sourceId: number;
  sourceLabel: string;
  run: () => Promise<string | undefined>;
}

const operationQueue: OperationTask[] = [];
const pendingOperationKeys = ref(new Set<string>());
const activeSourceIds = new Set<number>();
const queuedOperations = ref(0);
const runningOperations = ref(0);

function sourceLabel(source: Source): string {
  try {
    return new URL(source.url).hostname;
  } catch {
    return source.url;
  }
}

function replaceSource(updated: Source): void {
  const visible =
    (sourceType.value === null || updated.source_type === sourceType.value) &&
    (enabledFilter.value === null || updated.enabled === (enabledFilter.value === "true"));
  if (!visible) {
    allSources.value = allSources.value.filter((source) => source.id !== updated.id);
    selectedIds.value = selectedIds.value.filter((id) => id !== updated.id);
    return;
  }
  allSources.value = allSources.value.map((source) =>
    source.id === updated.id ? updated : source,
  );
}

function patchSource(id: number, patch: Partial<Source>): void {
  const current = allSources.value.find((source) => source.id === id);
  if (current) replaceSource({ ...current, ...patch });
}

function hasPending(source: Source, kind: OperationKind): boolean {
  return pendingOperationKeys.value.has(`${kind}:${source.id}`);
}

function enqueueOperation(
  source: Source,
  kind: OperationKind,
  label: string,
  run: OperationTask["run"],
): boolean {
  const key = `${kind}:${source.id}`;
  if (pendingOperationKeys.value.has(key)) return false;
  operationQueue.push({ key, label, sourceId: source.id, sourceLabel: sourceLabel(source), run });
  pendingOperationKeys.value = new Set(pendingOperationKeys.value).add(key);
  queuedOperations.value = operationQueue.length;
  drainQueue();
  return true;
}

function drainQueue(): void {
  while (runningOperations.value < 4) {
    const index = operationQueue.findIndex((task) => !activeSourceIds.has(task.sourceId));
    if (index < 0) return;
    const [task] = operationQueue.splice(index, 1);
    if (!task) return;
    queuedOperations.value = operationQueue.length;
    runningOperations.value += 1;
    activeSourceIds.add(task.sourceId);
    void executeOperation(task);
  }
}

function cancelQueuedOperations(): void {
  const canceled = operationQueue.splice(0);
  const keys = new Set(pendingOperationKeys.value);
  for (const task of canceled) keys.delete(task.key);
  pendingOperationKeys.value = keys;
  queuedOperations.value = 0;
  message.info(`已取消 ${canceled.length} 个等待操作`);
}

async function executeOperation(task: OperationTask): Promise<void> {
  try {
    const detail = await task.run();
    message.success(`${task.sourceLabel}：${task.label}完成${detail ? `，${detail}` : ""}`);
  } catch (reason) {
    message.error(
      `${task.sourceLabel}：${task.label}失败，${reason instanceof Error ? reason.message : String(reason)}`,
    );
  } finally {
    const keys = new Set(pendingOperationKeys.value);
    keys.delete(task.key);
    pendingOperationKeys.value = keys;
    activeSourceIds.delete(task.sourceId);
    runningOperations.value -= 1;
    drainQueue();
  }
}

function queueCollect(source: Source): boolean {
  return enqueueOperation(source, "collect", "采集", async () => {
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
  });
}

function queueToggle(source: Source, enabled: boolean): boolean {
  return enqueueOperation(source, enabled ? "enable" : "disable", enabled ? "启用" : "停用", async () => {
    replaceSource(await api.updateSource(source.id, enabled));
    return undefined;
  });
}

function queueResetCursor(source: Source): boolean {
  return enqueueOperation(source, "reset-cursor", "重置刷新时间", async () => {
    await api.resetSourceCursor(source.id);
    patchSource(source.id, {
      last_queried_at: "2000-01-01T00:00:00",
      consecutive_failures: 0,
      last_error: null,
    });
    return undefined;
  });
}

function confirmResetCursor(source: Source): void {
  dialog.warning({
    title: "重置刷新时间",
    content: `确定重置 ${sourceLabel(source)}？已有源数据不会删除，下次管线会重新采集。`,
    positiveText: "重置",
    negativeText: "取消",
    onPositiveClick: () => queueResetCursor(source),
  });
}

function queueRemove(source: Source): boolean {
  return enqueueOperation(source, "delete", "删除", async () => {
    await api.deleteSource(source.id);
    allSources.value = allSources.value.filter((item) => item.id !== source.id);
    selectedIds.value = selectedIds.value.filter((id) => id !== source.id);
    return undefined;
  });
}

function confirmRemove(source: Source): void {
  dialog.warning({
    title: "删除采集源",
    content: `确定删除 ${sourceLabel(source)}？已生成的具体书源/RSS 源记录会保留。`,
    positiveText: "删除",
    negativeText: "取消",
    onPositiveClick: () => queueRemove(source),
  });
}

const rowMenuOptions: DropdownOption[] = [
  { label: "重置刷新时间", key: "reset-cursor" },
  { type: "divider", key: "divider" },
  { label: "删除", key: "delete" },
];
const bulkMenuOptions: DropdownOption[] = rowMenuOptions;

function onRowMenuSelect(key: string, source: Source): void {
  if (key === "reset-cursor") confirmResetCursor(source);
  else if (key === "delete") confirmRemove(source);
}

function queueSelected(action: OperationKind): void {
  let added = 0;
  for (const source of selectedSources.value) {
    const queued =
      action === "collect"
        ? queueCollect(source)
        : action === "enable"
          ? queueToggle(source, true)
          : action === "disable"
            ? queueToggle(source, false)
            : action === "reset-cursor"
              ? queueResetCursor(source)
              : queueRemove(source);
    added += Number(queued);
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
  <main class="page">
    <n-space align="center" justify="space-between" class="head" :wrap="true">
      <n-space align="center" :size="8">
        <n-icon size="22" color="#2b7fff"><CloudUploadOutline /></n-icon>
        <n-h2 class="title">采集源</n-h2>
      </n-space>
      <n-space>
        <n-tooltip>
          <template #trigger>
            <n-button circle size="small" :aria-label="dark ? '切换到浅色主题' : '切换到深色主题'" @click="$emit('toggleTheme')">
              <template #icon><n-icon><SunnyOutline v-if="dark" /><MoonOutline v-else /></n-icon></template>
            </n-button>
          </template>
          {{ dark ? "浅色主题" : "深色主题" }}
        </n-tooltip>
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

    <n-card size="small" class="mb">
      <div class="filter-row">
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
        <n-text depth="3">共 {{ total }} 个</n-text>
      </div>
    </n-card>

    <n-alert v-if="error" type="error" class="mb">{{ error }}</n-alert>

    <div
      v-if="selectedSources.length > 0 || runningOperations + queuedOperations > 0"
      class="operation-bar"
    >
      <n-space v-if="selectedSources.length > 0" align="center" :size="8" wrap>
        <n-text>已选 {{ selectedSources.length }} 个</n-text>
        <n-button size="tiny" @click="queueSelected('collect')">采集</n-button>
        <n-button size="tiny" @click="queueSelected('enable')">启用</n-button>
        <n-button size="tiny" @click="queueSelected('disable')">停用</n-button>
        <n-dropdown trigger="click" :options="bulkMenuOptions" @select="onBulkMenuSelect">
          <n-button size="tiny">
            更多
            <template #icon><n-icon><EllipsisHorizontalOutline /></n-icon></template>
          </n-button>
        </n-dropdown>
      </n-space>
      <n-space
        v-if="runningOperations + queuedOperations > 0"
        align="center"
        :size="8"
        class="queue-status"
      >
        <n-text depth="3" role="status" aria-live="polite">
          执行中 {{ runningOperations }}，等待 {{ queuedOperations }}
        </n-text>
        <n-button
          size="tiny"
          :disabled="queuedOperations === 0"
          aria-label="取消所有等待中的操作"
          @click="cancelQueuedOperations"
        >
          取消
        </n-button>
      </n-space>
    </div>

    <n-spin :show="loading" class="table-scroll">
      <n-empty v-if="!loading && allSources.length === 0" description="还没有采集源" class="empty">
        <template #extra>
          <n-button size="small" @click="showCreate = true">登记第一个</n-button>
        </template>
      </n-empty>

      <n-table v-else :single-line="false" size="small" class="source-table">
        <thead>
          <tr>
            <th class="select-cell">
              <n-checkbox
                :checked="allSelected"
                :indeterminate="partlySelected"
                aria-label="选择当前页"
                @update:checked="toggleAll"
              />
            </th>
            <th
              v-for="column in columns"
              :key="column.key"
              :style="{ width: column.width }"
              :aria-sort="
                sortKey === column.key
                  ? sortOrder === 'asc'
                    ? 'ascending'
                    : 'descending'
                  : undefined
              "
            >
              <button type="button" class="sortable" @click="toggleSort(column.key)">
                {{ column.label }}
                <span aria-hidden="true" class="sort-arrow" :class="{ active: sortKey === column.key }">
                  {{ sortKey === column.key && sortOrder === "desc" ? "▼" : "▲" }}
                </span>
              </button>
            </th>
            <th class="actions-column">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="source in pagedItems"
            :key="source.id"
            :class="{
              'row-failing': source.consecutive_failures > 0,
              'row-selected': selectedIds.includes(source.id),
            }"
          >
            <td class="select-cell">
              <n-checkbox
                :checked="selectedIds.includes(source.id)"
                :aria-label="`选择 ${sourceLabel(source)}`"
                @update:checked="(checked: boolean) => toggleSelected(source.id, checked)"
              />
            </td>
            <td><n-text code class="source-id">{{ source.id }}</n-text></td>
            <td>{{ SOURCE_TYPE_LABEL[source.source_type] }}</td>
            <td>
              <n-button text tag="a" :href="source.url" target="_blank" rel="noopener noreferrer" class="source-link">
                {{ source.url }}
              </n-button>
            </td>
            <td>{{ source.source_count < 0 ? "-" : source.source_count.toLocaleString() }}</td>
            <td>
              <n-tooltip>
                <template #trigger><span>{{ fromNow(source.last_queried_at) }}</span></template>
                最近成功：{{ formatTime(source.last_success_at) }}
              </n-tooltip>
            </td>
            <td>
              <n-tooltip v-if="source.last_error">
                <template #trigger>
                  <n-tag size="small" type="error">失败 {{ source.consecutive_failures }} 次</n-tag>
                </template>
                {{ source.last_error }}
              </n-tooltip>
              <n-tag v-else-if="source.last_success_at" size="small" type="success">正常</n-tag>
              <n-tag v-else size="small">待采集</n-tag>
            </td>
            <td>
              <n-switch
                size="small"
                :value="source.enabled"
                :loading="hasPending(source, 'enable') || hasPending(source, 'disable')"
                :aria-label="`${source.enabled ? '停用' : '启用'} ${sourceLabel(source)}`"
                @update:value="(enabled: boolean) => queueToggle(source, enabled)"
              />
            </td>
            <td>
              <n-space :size="4" :wrap="false">
                <n-button
                  size="tiny"
                  :loading="hasPending(source, 'collect')"
                  @click="queueCollect(source)"
                >
                  采集
                </n-button>
                <n-dropdown
                  trigger="click"
                  :options="rowMenuOptions"
                  @select="(key: string) => onRowMenuSelect(key, source)"
                >
                  <n-button size="tiny" quaternary circle :aria-label="`${sourceLabel(source)} 更多操作`">
                    <template #icon><n-icon><EllipsisHorizontalOutline /></n-icon></template>
                  </n-button>
                </n-dropdown>
              </n-space>
            </td>
          </tr>
        </tbody>
      </n-table>
    </n-spin>

    <n-pagination
      v-if="total > size"
      class="pager"
      :page="page"
      :page-size="size"
      :item-count="total"
      show-quick-jumper
      show-size-picker
      :page-sizes="[10, 20, 50, 100]"
      @update:page="page = $event"
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
  </main>
</template>

<style scoped>
.page {
  width: min(calc(100% - 32px), 1440px);
  margin: 0 auto;
  padding: 28px 0 48px;
}

.head,
.mb {
  margin-bottom: 16px;
}

.title {
  margin: 0;
}

.type-filter {
  width: 150px;
}

.status-filter {
  width: 130px;
}

.filter-row {
  display: grid;
  grid-template-columns: 150px 130px auto;
  align-items: center;
  gap: 12px;
}

.operation-bar {
  min-height: 44px;
  margin-bottom: 12px;
  padding: 8px 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border: 1px solid var(--n-border-color, rgba(128, 128, 128, 0.24));
  border-radius: 4px;
}

.queue-status {
  flex: none;
  font-variant-numeric: tabular-nums;
}

.source-table {
  min-width: 1080px;
  table-layout: fixed;
}

.source-table :deep(tbody tr:nth-child(even)) {
  background: rgba(128, 128, 128, 0.05);
}

.source-table :deep(tbody tr.row-failing) {
  box-shadow: inset 3px 0 0 #e88080;
}

.source-table :deep(tbody tr.row-selected) {
  background: color-mix(in srgb, #6d5ef8 8%, transparent);
}

.select-cell {
  width: 44px;
  text-align: center;
}

.actions-column {
  width: 130px;
}

.source-id {
  font-size: 11px;
}

.source-link {
  display: inline-block;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  vertical-align: middle;
}

.sortable {
  appearance: none;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  font-weight: inherit;
  cursor: pointer;
  user-select: none;
  white-space: nowrap;
}

.sortable:hover {
  color: var(--n-primary-color, #6d5ef8);
}

.sort-arrow {
  font-size: 10px;
  opacity: 0.25;
}

.sort-arrow.active {
  opacity: 1;
}

.empty {
  padding: 48px 0;
}

.pager {
  margin-top: 20px;
  justify-content: center;
}

.create-modal {
  width: min(520px, calc(100vw - 32px));
}

.hint {
  display: block;
  margin-top: 8px;
  font-size: 12px;
}

@media (pointer: coarse) {
  .sortable {
    min-height: 44px;
  }
}

@media (max-width: 640px) {
  .page {
    width: min(calc(100% - 24px), 1440px);
    padding-top: 20px;
  }

  .head {
    align-items: flex-start !important;
  }

  .operation-bar {
    align-items: flex-start;
    flex-direction: column;
  }

  .type-filter,
  .status-filter {
    width: 100%;
  }

  .filter-row {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  }

  .filter-row > :last-child {
    grid-column: 1 / -1;
  }
}
</style>
