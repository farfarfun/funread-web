<script setup lang="ts">
/** 我的订阅。两种来源（归档源 / 自填 feed）在这里是同一个列表。 */
import { AddOutline, AlertCircle, EllipsisHorizontal, StarOutline } from "@vicons/ionicons5";
import { useMessage } from "naive-ui";
import { computed, onActivated, onMounted, ref } from "vue";
import { useRouter } from "vue-router";

import { api } from "../../api/client";
import type { Subscription } from "../../api/types";
import SkeletonList from "../../components/web/SkeletonList.vue";
import TopBar from "../../components/web/TopBar.vue";

const router = useRouter();
const message = useMessage();

const subscriptions = ref<Subscription[]>([]);
const loading = ref(true);
const error = ref("");
const showAdd = ref(false);
const feedUrl = ref("");
const feedTitle = ref("");
const subscribing = ref(false);
/**
 * 正在看哪一条的报错详情。
 *
 * 抓取失败必须说出来（空列表和「没有新内容」长得一样），但不能摊在列表里 ——
 * 一条带堆栈的错误能占掉半屏，反而把正常的订阅挤没了。所以列表里只留一个红色
 * 图标，详情进弹窗。
 */
const errorDetail = ref<Subscription | null>(null);
const opmlInput = ref<HTMLInputElement | null>(null);
const importing = ref(false);

//  「更多」菜单：OPML 导入导出用得很少，不值得在顶栏占两个按钮位
const moreOptions = [
  { label: "导入 OPML", key: "import" },
  { label: "导出 OPML", key: "export" },
];

function onMore(key: string) {
  if (key === "import") opmlInput.value?.click();
  if (key === "export") exportOpml();
}

async function importOpml(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  importing.value = true;
  try {
    const result = await api.importOpml(await file.text());
    //  导入不验证地址，所以这句不能说「都能用」——挂掉的源会在打开时报错
    message.success(
      result.imported
        ? `导入了 ${result.imported} 个订阅${result.skipped ? `，跳过 ${result.skipped} 个已有的` : ""}`
        : "没有新的订阅可导入",
    );
    await load();
  } catch (reason) {
    message.error(reason instanceof Error ? reason.message : "导入失败");
  } finally {
    importing.value = false;
  }
}

async function exportOpml() {
  try {
    const result = await api.exportOpml();
    if (!result.count) {
      message.info("没有可导出的 feed 订阅（归档源没有通用地址，不在导出之列）");
      return;
    }
    const blob = new Blob([result.opml], { type: "text/x-opml" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "funread-subscriptions.opml";
    anchor.click();
    URL.revokeObjectURL(url);
  } catch (reason) {
    message.error(reason instanceof Error ? reason.message : "导出失败");
  }
}
const showError = computed({
  get: () => errorDetail.value !== null,
  set: (value: boolean) => {
    if (!value) errorDetail.value = null;
  },
});

async function load() {
  loading.value = true;
  error.value = "";
  try {
    subscriptions.value = await api.subscriptions();
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : "加载失败";
  } finally {
    loading.value = false;
  }
}

async function addFeed() {
  const url = feedUrl.value.trim();
  if (!url) return;
  subscribing.value = true;
  try {
    const created = await api.subscribeFeed(url, feedTitle.value.trim());
    message.success(
      created.preview
        ? `已订阅「${created.title}」，当前 ${created.preview} 篇`
        : `已订阅「${created.title}」`,
    );
    showAdd.value = false;
    feedUrl.value = "";
    feedTitle.value = "";
    await load();
  } catch (reason) {
    //  后端会把「这是一个 HTML 页面而不是 feed 地址」这类原因带回来，
    //  原样显示 —— 这是用户唯一能据此改正的东西。
    message.error(reason instanceof Error ? reason.message : "订阅失败");
  } finally {
    subscribing.value = false;
  }
}

async function remove(subscription: Subscription) {
  try {
    await api.unsubscribe(subscription.sub_id);
    subscriptions.value = subscriptions.value.filter(
      (item) => item.sub_id !== subscription.sub_id,
    );
    message.success(`已退订「${subscription.title}」`);
  } catch (reason) {
    message.error(reason instanceof Error ? reason.message : "退订失败");
  }
}

onMounted(load);
onActivated(load);
</script>

<template>
  <div>
    <TopBar title="订阅">
      <template #actions>
        <n-button quaternary circle aria-label="收藏" @click="router.push({ name: 'rss-favorites' })">
          <template #icon><n-icon><StarOutline /></n-icon></template>
        </n-button>
        <n-button quaternary circle aria-label="添加订阅" @click="showAdd = true">
          <template #icon><n-icon><AddOutline /></n-icon></template>
        </n-button>
        <n-dropdown :options="moreOptions" trigger="click" @select="onMore">
          <n-button quaternary circle aria-label="更多" :loading="importing">
            <template #icon><n-icon><EllipsisHorizontal /></n-icon></template>
          </n-button>
        </n-dropdown>
      </template>
    </TopBar>
    <input
      ref="opmlInput"
      type="file"
      accept=".opml,.xml,text/xml,text/x-opml"
      class="visually-hidden"
      @change="importOpml"
    />

    <SkeletonList v-if="loading" :rows="4" :cover="false" />

    <n-result v-else-if="error" status="error" title="订阅列表加载失败" :description="error" class="state">
      <template #footer><n-button @click="load">重试</n-button></template>
    </n-result>

    <n-empty v-else-if="!subscriptions.length" description="还没有订阅" class="state">
      <template #extra>
        <div class="empty-actions">
          <n-button type="primary" @click="router.push({ name: 'rss-sources' })">
            浏览订阅源目录
          </n-button>
          <n-button @click="showAdd = true">贴一个 feed 地址</n-button>
        </div>
      </template>
    </n-empty>

    <template v-else>
      <div class="toolbar">
        <n-button size="small" @click="router.push({ name: 'rss-sources' })">订阅源目录</n-button>
        <span class="toolbar__count">{{ subscriptions.length }} 个订阅</span>
      </div>

      <n-list hoverable clickable>
        <n-list-item
          v-for="subscription in subscriptions"
          :key="subscription.sub_id"
          @click="router.push({ name: 'rss-feed', params: { subId: subscription.sub_id } })"
        >
          <div class="sub">
            <img
              v-if="subscription.icon"
              class="sub__icon"
              :src="subscription.icon"
              alt=""
              loading="lazy"
              referrerpolicy="no-referrer"
            />
            <span v-else class="sub__icon sub__icon--text">
              {{ subscription.title.slice(0, 1) || "订" }}
            </span>
            <div class="sub__body">
              <p class="sub__title">
                <span class="sub__title-text">{{ subscription.title }}</span>
                <!-- 失败只占一个图标位，详情进弹窗 -->
                <n-icon
                  v-if="subscription.last_error"
                  class="sub__warn"
                  :component="AlertCircle"
                  title="上次刷新失败，点击查看"
                  @click.stop="errorDetail = subscription"
                />
              </p>
              <p class="sub__meta">
                <n-tag size="tiny" :bordered="false">
                  {{ subscription.kind === "feed" ? "feed" : "归档源" }}
                </n-tag>
                <span v-if="subscription.read_count">已读 {{ subscription.read_count }} 篇</span>
              </p>
            </div>
          </div>
          <template #suffix>
            <n-popconfirm @positive-click="remove(subscription)">
              <template #trigger>
                <n-button quaternary size="small" @click.stop>退订</n-button>
              </template>
              退订会同时清掉这个订阅下的已读与收藏记录，确定吗？
            </n-popconfirm>
          </template>
        </n-list-item>
      </n-list>
    </template>

    <n-modal v-model:show="showAdd" preset="card" title="添加订阅" class="add-modal">
      <n-form-item label="feed 地址" :show-feedback="false">
        <n-input
          v-model:value="feedUrl"
          placeholder="https://example.com/feed.xml"
          :input-props="{ type: 'url', autocapitalize: 'off', autocorrect: 'off' }"
        />
      </n-form-item>
      <n-form-item label="自定名称（可留空）" :show-feedback="false">
        <n-input v-model:value="feedTitle" placeholder="留空则用 feed 自己的标题" />
      </n-form-item>
      <p class="hint hint--left">
        支持 RSS 2.0 与 Atom。订阅前服务端会先抓一次验证，贴错地址会当场告诉你。
      </p>
      <template #footer>
        <div class="modal-actions">
          <n-button @click="showAdd = false">取消</n-button>
          <n-button type="primary" :loading="subscribing" @click="addFeed">订阅</n-button>
        </div>
      </template>
    </n-modal>

    <n-modal v-model:show="showError" preset="card" title="上次刷新失败" class="error-modal">
      <p class="error-modal__name">{{ errorDetail?.title }}</p>
      <pre class="error-modal__body">{{ errorDetail?.last_error }}</pre>
      <template #footer>
        <div class="modal-actions">
          <n-button @click="showError = false">知道了</n-button>
        </div>
      </template>
    </n-modal>
  </div>
</template>

<style scoped>
.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
}

.state {
  padding: var(--space-6) var(--space-4);
}

.empty-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  justify-content: center;
  margin-bottom: var(--space-3);
}

.hint {
  max-width: 40ch;
  margin: 0 auto;
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-muted);
}

.hint--left {
  margin: var(--space-2) 0 0;
  text-align: left;
}

.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-2) var(--space-3);
}

.toolbar__count {
  font-size: 12px;
  color: var(--text-muted);
}

.sub {
  display: flex;
  flex: 1;
  gap: var(--space-3);
  align-items: flex-start;
}

.sub__icon {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  object-fit: cover;
  background: var(--surface-sunken);
  border-radius: 8px;
}

.sub__icon--text {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-muted);
}

.sub__body {
  min-width: 0;
  flex: 1;
}

.sub__title {
  /* 改成 flex 让警告图标贴在标题右侧；截断交给里面的 .sub__title-text */
  display: flex;
  gap: 5px;
  align-items: center;
  margin: 0 0 2px;
  overflow: hidden;
  font-size: 14px;
  font-weight: 600;
}

.sub__meta {
  display: flex;
  gap: var(--space-2);
  align-items: center;
  margin: 0;
  font-size: 11px;
  color: var(--text-muted);
}

.sub__title-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sub__warn {
  flex: none;
  font-size: 15px;
  color: #d03050;
  cursor: pointer;
}

.error-modal {
  width: min(92vw, 460px);
}

.error-modal__name {
  margin: 0 0 var(--space-2);
  font-size: 13px;
  font-weight: 600;
}

.error-modal__body {
  /* 错误原文可能很长、也可能一行不断 —— 两种都要收在框里，不能把弹窗撑爆 */
  max-height: 46vh;
  margin: 0;
  overflow: auto;
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 12px;
  line-height: 1.6;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.add-modal {
  width: min(92vw, 420px);
}

.modal-actions {
  display: flex;
  gap: var(--space-2);
  justify-content: flex-end;
}
</style>
