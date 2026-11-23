<script setup lang="ts">
/**
 * 候选源池规则编辑弹窗。从 `PoolView.vue` 拆出，降低巨型页面耦合度。
 */
import type { PoolRules } from "../../api/types";

const show = defineModel<boolean>("show", { required: true });
const text = defineModel<string>("text", { required: true });

defineProps<{
  editing: PoolRules | null;
  loading: boolean;
  saving: boolean;
  optimizing: boolean;
  error: string;
  hint: string;
}>();

const emit = defineEmits<{ save: [] }>();
</script>

<template>
  <n-modal
    v-model:show="show"
    preset="card"
    class="rules-modal"
    :title="editing?.source.name || '源规则'"
    :mask-closable="!saving"
  >
    <n-spin :show="loading">
      <n-alert v-if="error" type="error" :title="error" class="alert" />
      <n-alert v-if="hint" type="info" :title="hint" class="alert" />
      <template v-if="editing">
        <dl class="rules-meta">
          <div><dt>原始地址</dt><dd>{{ editing.source.source_url || "未填写" }}</dd></div>
          <div><dt>索引标识</dt><dd>{{ editing.index_key || "无" }}</dd></div>
          <div>
            <dt>状态</dt>
            <dd>
              {{ editing.source.enabled ? "已启用" : "已停用" }} ·
              {{ editing.source.is_complete ? "规则完整" : "规则不全" }} ·
              {{ editing.source.has_explore ? "可浏览" : "不可浏览" }}
            </dd>
          </div>
        </dl>
        <n-input
          v-model:value="text"
          type="textarea"
          :autosize="{ minRows: 16, maxRows: 26 }"
          spellcheck="false"
          aria-label="源规则 JSON"
          class="rules-editor"
        />
        <div class="rules-actions">
          <n-button @click="show = false">关闭</n-button>
          <n-button type="primary" :loading="saving" :disabled="optimizing" @click="emit('save')">
            保存规则
          </n-button>
        </div>
      </template>
    </n-spin>
  </n-modal>
</template>

<style scoped>
.rules-modal {
  width: min(900px, calc(100vw - 32px));
}

.rules-meta {
  display: grid;
  gap: 8px;
  margin: 0 0 16px;
  font-size: 12px;
}

.rules-meta div {
  display: grid;
  grid-template-columns: 72px minmax(0, 1fr);
  gap: 12px;
}

.rules-meta dt {
  color: var(--text-muted);
}

.rules-meta dd {
  margin: 0;
  overflow-wrap: anywhere;
}

.rules-editor :deep(textarea) {
  font-family: monospace;
}

.rules-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}

.alert {
  margin-bottom: var(--space-3);
}
</style>
