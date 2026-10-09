<script setup lang="ts">
/**
 * 换源抽屉。详情页与正文页共用。
 *
 * 这不是一个本地列表 —— 打开它会触发一次**实时聚合搜索**（书架只记了当前在读的
 * 源），所以可能要等十几秒。因此：
 *
 * - 必须有加载态与进度说明，否则用户会以为卡住了；
 * - 必须显示每个候选的**书名 + 作者 + 最新章节**。按 `book_key` 精确筛会静默丢掉
 *   作者名写法不同的源，而那些往往恰恰是还活着的那批 —— 所以宽松匹配、全部列出、
 *   让用户自己判断哪个是同一本；
 * - 空列表要能解释原因：真没有别的源，还是这一轮试的源都挂了。
 */
import { CheckmarkCircle, RefreshOutline } from "@vicons/ionicons5";
import { computed } from "vue";

import type { SwitchCandidate, SwitchSourcePage } from "../../api/types";

const show = defineModel<boolean>("show", { required: true });

const props = defineProps<{
  page: SwitchSourcePage | null;
  loading: boolean;
  error: string;
}>();

const emit = defineEmits<{ pick: [candidate: SwitchCandidate]; reload: [] }>();

/** 精确匹配与近似匹配分开给标题，让用户知道下面那批为什么作者不一样。 */
const exactItems = computed(() => props.page?.items.filter((item) => item.exact) ?? []);
const looseItems = computed(() => props.page?.items.filter((item) => !item.exact) ?? []);

const statsText = computed(() => {
  const page = props.page;
  if (!page) return "";
  const parts = [`试了 ${page.sources_tried} 个源，${page.sources_ok} 个有响应`];
  if (page.js_skipped) parts.push(`${page.js_skipped} 个需要 JS`);
  parts.push(`耗时 ${page.elapsed}s`);
  return parts.join(" · ");
});

/** 空列表的原因。三种处境的下一步动作完全不同。 */
const emptyReason = computed(() => {
  const page = props.page;
  if (!page) return "";
  if (page.sources_tried === 0) return "候选源池还是空的，需要先扫描一次本地源归档。";
  if (page.sources_ok === 0) return "这一轮试的源都没有响应。不是没有别的源，是它们这次都没答上来。";
  if (page.exhausted) return "候选池已经搜完，确实只有当前这一个源有这本书。";
  return "搜到的源里没有同名的书。可以再搜一次试试 —— 每次试的源不完全一样。";
});
</script>

<template>
  <n-drawer v-model:show="show" placement="bottom" :height="460">
    <n-drawer-content closable>
      <template #header>
        <div class="head">
          <span>换源{{ page ? ` · ${page.name}` : "" }}</span>
          <n-button
            quaternary
            size="tiny"
            :loading="loading"
            aria-label="重新搜索"
            @click="emit('reload')"
          >
            <template #icon><n-icon><RefreshOutline /></n-icon></template>
          </n-button>
        </div>
      </template>

      <div v-if="loading" class="pending">
        <n-spin size="large" />
        <p class="pending__text">正在跨源搜索…</p>
        <p class="pending__hint">
          换源列表来自一次实时搜索，不是本地缓存 —— 要逐批试候选源，可能要等十几秒。
        </p>
      </div>

      <n-result
        v-else-if="error"
        status="warning"
        title="换源列表取不到"
        :description="error"
        size="small"
      >
        <template #footer><n-button size="small" @click="emit('reload')">重试</n-button></template>
      </n-result>

      <template v-else-if="page">
        <p class="stats">{{ statsText }}</p>

        <n-empty v-if="!page.items.length" description="没有找到其他来源">
          <template #extra>
            <p class="empty-hint">{{ emptyReason }}</p>
            <n-button size="small" @click="emit('reload')">再搜一次</n-button>
          </template>
        </n-empty>

        <template v-else>
          <n-list hoverable clickable>
            <n-list-item
              v-for="item in exactItems"
              :key="`${item.url_id}-exact`"
              @click="emit('pick', item)"
            >
              <div class="row">
                <div class="row__body">
                  <p class="row__source">
                    {{ item.source_name || `源 ${item.url_id}` }}
                    <n-tag v-if="item.current" size="tiny" type="primary" :bordered="false">
                      当前
                    </n-tag>
                  </p>
                  <p class="row__meta">
                    {{ item.author || "未知作者" }}
                  </p>
                  <p v-if="item.last_chapter" class="row__chapter">
                    最新：{{ item.last_chapter }}
                  </p>
                </div>
                <n-icon v-if="item.current" class="row__check" size="18">
                  <CheckmarkCircle />
                </n-icon>
              </div>
            </n-list-item>
          </n-list>

          <template v-if="looseItems.length">
            <!-- 近似匹配单独一组并说明原因，否则用户会疑惑作者怎么不一样 -->
            <p class="group">
              书名相同、作者写法不同的源（{{ looseItems.length }} 个）。
              作者名的差异通常只是源站的录入习惯，但也可能是另一本同名书 —— 请看一眼再选。
            </p>
            <n-list hoverable clickable>
              <n-list-item
                v-for="item in looseItems"
                :key="`${item.url_id}-loose`"
                @click="emit('pick', item)"
              >
                <div class="row">
                  <div class="row__body">
                    <p class="row__source">{{ item.source_name || `源 ${item.url_id}` }}</p>
                    <p class="row__meta row__meta--warn">
                      {{ item.author || "作者留空" }}
                    </p>
                    <p v-if="item.last_chapter" class="row__chapter">
                      最新：{{ item.last_chapter }}
                    </p>
                  </div>
                </div>
              </n-list-item>
            </n-list>
          </template>
        </template>
      </template>
    </n-drawer-content>
  </n-drawer>
</template>

<style scoped>
.head {
  display: flex;
  flex: 1;
  gap: var(--space-2);
  align-items: center;
  justify-content: space-between;
  font-weight: 600;
}

.pending {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  align-items: center;
  padding: var(--space-6) var(--space-4);
  text-align: center;
}

.pending__text {
  margin: 0;
  font-size: 14px;
}

.pending__hint {
  max-width: 34ch;
  margin: 0;
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-muted);
}

.stats {
  margin: 0 0 var(--space-2);
  font-size: 12px;
  color: var(--text-muted);
}

.empty-hint {
  max-width: 36ch;
  margin: 0 auto var(--space-3);
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-muted);
}

.group {
  margin: var(--space-4) 0 var(--space-2);
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-muted);
}

.row {
  display: flex;
  flex: 1;
  gap: var(--space-2);
  align-items: center;
}

.row__body {
  min-width: 0;
  flex: 1;
}

.row__source {
  display: flex;
  gap: var(--space-2);
  align-items: center;
  margin: 0 0 2px;
  font-size: 14px;
  font-weight: 500;
}

.row__meta {
  margin: 0;
  font-size: 12px;
  color: var(--text-muted);
}

.row__meta--warn {
  color: #f0a020;
}

.row__chapter {
  margin: 2px 0 0;
  overflow: hidden;
  font-size: 11px;
  color: var(--text-muted);
  white-space: nowrap;
  text-overflow: ellipsis;
}

.row__check {
  flex-shrink: 0;
  color: var(--accent);
}
</style>
