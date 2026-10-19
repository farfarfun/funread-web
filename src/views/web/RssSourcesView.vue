<script setup lang="ts">
/**
 * 订阅源目录：浏览归档里**能直接解析**的 Legado 订阅源。
 *
 * 必须把「为什么只有这么几个」说清楚：归档一共 1,344 个源，纯 Python 能跑的
 * 只有 142 个（10.6%），其余要么规则不全、要么需要 JS、要么是 WebView 型。
 * 不解释的话这页看着像个坏了的列表。
 */
import { SearchOutline } from "@vicons/ionicons5";
import { useMessage } from "naive-ui";
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";

import { api } from "../../api/client";
import type { RssSource } from "../../api/types";
import SkeletonList from "../../components/web/SkeletonList.vue";
import TopBar from "../../components/web/TopBar.vue";
import { useAuth } from "../../composables/useAuth";

const PAGE_SIZE = 30;

const message = useMessage();
const router = useRouter();
const { isAdmin } = useAuth();

const items = ref<RssSource[]>([]);
const total = ref(0);
const keyword = ref("");
const loading = ref(true);
const loadingMore = ref(false);
const error = ref("");
const subscribing = ref<number | null>(null);
/**
 * 已订阅的 `url_id`。**进页面时就要拉一次** —— 只记本次点击的话，翻回这一页时
 * 已订阅的源又会显示成可订阅，点下去撞一个「已经订阅过」的错误。
 */
const subscribed = ref<Set<number>>(new Set());

async function load(reset = true) {
  if (reset) {
    loading.value = true;
    items.value = [];
  } else {
    loadingMore.value = true;
  }
  error.value = "";
  try {
    const page = await api.rssSources({
      q: keyword.value.trim(),
      limit: PAGE_SIZE,
      offset: reset ? 0 : items.value.length,
    });
    items.value = reset ? page.items : [...items.value, ...page.items];
    total.value = page.total;
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : "加载失败";
  } finally {
    loading.value = false;
    loadingMore.value = false;
  }
}

/** 拉已订阅列表，用来把目录里已经订过的源置灰。失败不影响浏览目录。 */
async function loadSubscribed() {
  try {
    const subs = await api.subscriptions();
    subscribed.value = new Set(subs.map((item) => item.url_id));
  } catch {
    //  未登录或网络抖动：目录照常能看，按钮退化成可点，点了会收到后端的错误。
  }
}

async function subscribe(source: RssSource) {
  subscribing.value = source.url_id;
  try {
    const created = await api.subscribeLegado(source.url_id);
    message.success(`已订阅「${created.title}」`);
    //  **留在目录页**：订一个就被弹进详情页的话，想连着订第二个还得退回来。
    //  订阅成功的反馈由按钮置灰给出。
    subscribed.value = new Set(subscribed.value).add(source.url_id);
  } catch (reason) {
    message.error(reason instanceof Error ? reason.message : "订阅失败");
  } finally {
    subscribing.value = null;
  }
}

onMounted(() => {
  void load();
  void loadSubscribed();
});
</script>

<template>
  <div>
    <TopBar title="订阅源目录" back fallback="/web/rss" />

    <div class="search">
      <n-input
        v-model:value="keyword"
        placeholder="搜源名"
        clearable
        @keyup.enter="load()"
        @clear="load()"
      >
        <template #prefix><n-icon><SearchOutline /></n-icon></template>
      </n-input>
      <n-button type="primary" :loading="loading" @click="load()">搜索</n-button>
    </div>

    <SkeletonList v-if="loading" :rows="5" :cover="false" />

    <n-result v-else-if="error" status="error" title="目录加载失败" :description="error" class="state">
      <template #footer><n-button @click="load()">重试</n-button></template>
    </n-result>

    <n-empty v-else-if="!items.length && keyword" description="没有匹配的源" class="state" />

    <n-empty v-else-if="!items.length" description="候选源池还是空的" class="state">
      <template #extra>
        <n-button v-if="isAdmin" @click="router.push({ name: 'admin-pool', query: { source_type: 'rss' } })">前往候选源池</n-button>
        <p v-else class="hint">请管理员在候选源池扫描订阅源。</p>
      </template>
    </n-empty>

    <template v-else>
      <p class="stats">
        共 {{ total }} 个可直接解析的源。归档里还有大量源需要 JS 或浏览器环境，
        当前版本不列出来 —— 列出来也点不开。
      </p>

      <n-list hoverable>
        <n-list-item v-for="source in items" :key="source.url_id">
          <div class="source">
            <img
              v-if="source.icon"
              class="source__icon"
              :src="source.icon"
              alt=""
              loading="lazy"
              referrerpolicy="no-referrer"
            />
            <span v-else class="source__icon source__icon--text">
              {{ source.name.slice(0, 1) || "源" }}
            </span>
            <div class="source__body">
              <p class="source__name">{{ source.name || `源 ${source.url_id}` }}</p>
              <p class="source__meta">
                <n-tag v-if="source.group" size="tiny" :bordered="false">{{ source.group }}</n-tag>
                <span v-if="source.categories.length">{{ source.categories.length }} 个分类</span>
              </p>
            </div>
          </div>
          <template #suffix>
            <n-button
              size="small"
              :type="subscribed.has(source.url_id) ? 'default' : 'primary'"
              :disabled="subscribed.has(source.url_id)"
              :loading="subscribing === source.url_id"
              @click="subscribe(source)"
            >
              {{ subscribed.has(source.url_id) ? "已订阅" : "订阅" }}
            </n-button>
          </template>
        </n-list-item>
      </n-list>

      <div v-if="items.length < total" class="more">
        <n-button :loading="loadingMore" block @click="load(false)">加载更多</n-button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.search {
  display: flex;
  gap: var(--space-2);
  padding: var(--space-3);
}

.state {
  padding: var(--space-6) var(--space-4);
}

.hint {
  max-width: 40ch;
  margin: 0 auto;
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-muted);
}

.stats {
  margin: 0;
  padding: 0 var(--space-3) var(--space-2);
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-muted);
}

.source {
  display: flex;
  flex: 1;
  gap: var(--space-3);
  align-items: center;
}

.source__icon {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  object-fit: cover;
  background: var(--surface-sunken);
  border-radius: 8px;
}

.source__icon--text {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-muted);
}

.source__body {
  min-width: 0;
  flex: 1;
}

.source__name {
  margin: 0 0 2px;
  overflow: hidden;
  font-size: 14px;
  font-weight: 500;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.source__meta {
  display: flex;
  gap: var(--space-2);
  align-items: center;
  margin: 0;
  font-size: 11px;
  color: var(--text-muted);
}

.more {
  padding: var(--space-3);
}
</style>
