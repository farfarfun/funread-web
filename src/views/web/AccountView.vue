<script setup lang="ts">
/** 「我的」。管理端入口放在这里，不进 TabBar —— 读者用不着看到它。 */
import { MoonOutline, SunnyOutline } from "@vicons/ionicons5";
import { useMessage } from "naive-ui";
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";

import { api } from "../../api/client";
import type { ShelfBook } from "../../api/types";
import TopBar from "../../components/web/TopBar.vue";
import { useAuth } from "../../composables/useAuth";
import { useSearchHistory } from "../../composables/useSearchHistory";
import { useTheme } from "../../composables/useTheme";

const router = useRouter();
const message = useMessage();
const auth = useAuth();
const { dark, toggle } = useTheme();
const { history, clear: clearHistory } = useSearchHistory();

const books = ref<ShelfBook[]>([]);
const cachedTotal = ref(0);
const counting = ref(true);

const cachedLabel = computed(() =>
  counting.value ? "统计中…" : `${cachedTotal.value} 章已缓存`,
);

async function countCache() {
  counting.value = true;
  try {
    books.value = await api.shelf();
    //  逐本问一次。书架通常是几本到几十本，串起来也只是几十个小请求，
    //  比为这一个数字加一个聚合接口划算。
    const results = await Promise.all(
      books.value.map((book) =>
        api
          .cached(book.book_key)
          .then((state) => state.chapter_indexes.length)
          .catch(() => 0),
      ),
    );
    cachedTotal.value = results.reduce((sum, value) => sum + value, 0);
  } catch {
    cachedTotal.value = 0;
  } finally {
    counting.value = false;
  }
}

async function clearAllCache() {
  try {
    await Promise.all(books.value.map((book) => api.clearCache(book.book_key).catch(() => undefined)));
    cachedTotal.value = 0;
    message.success("已清空所有离线缓存");
  } catch (reason) {
    message.error(reason instanceof Error ? reason.message : "清空失败");
  }
}

async function logout() {
  await auth.logout();
  router.replace({ name: "login" });
}

onMounted(() => {
  auth.ensure();
  countCache();
});
</script>

<template>
  <div>
    <TopBar title="我的">
      <template #actions>
        <n-button
          quaternary
          circle
          :aria-label="dark ? '切换到浅色主题' : '切换到深色主题'"
          @click="toggle"
        >
          <template #icon>
            <n-icon><SunnyOutline v-if="dark" /><MoonOutline v-else /></n-icon>
          </template>
        </n-button>
      </template>
    </TopBar>

    <section class="identity">
      <div class="identity__avatar">{{ (auth.username.value || "读").slice(0, 1) }}</div>
      <div>
        <p class="identity__name">{{ auth.username.value || "未登录" }}</p>
        <p v-if="auth.isLocal.value" class="identity__note">
          还没有账号，当前是本机身份。注册一个账号就能接管这些数据。
        </p>
        <p v-else-if="auth.authenticated.value" class="identity__note">已登录</p>
      </div>
    </section>

    <n-list hoverable>
      <n-list-item>
        <div class="row">
          <span>离线缓存</span>
          <span class="row__value">{{ cachedLabel }}</span>
        </div>
        <template #suffix>
          <n-popconfirm v-if="cachedTotal" @positive-click="clearAllCache">
            <template #trigger><n-button size="small" quaternary>清空</n-button></template>
            清空后所有书都要重新下载才能离线读，确定吗？
          </n-popconfirm>
        </template>
      </n-list-item>

      <n-list-item>
        <div class="row">
          <span>搜索历史</span>
          <span class="row__value">{{ history.length }} 条</span>
        </div>
        <template #suffix>
          <n-button v-if="history.length" size="small" quaternary @click="clearHistory">
            清空
          </n-button>
        </template>
      </n-list-item>

      <n-list-item @click="router.push({ name: 'rss-sources' })">
        <div class="row"><span>订阅源目录</span></div>
      </n-list-item>

      <n-list-item>
        <div class="row">
          <span>采集源管理</span>
          <span class="row__value">管理端</span>
        </div>
        <template #suffix>
          <n-button size="small" quaternary tag="a" href="/admin/sources">打开</n-button>
        </template>
      </n-list-item>
    </n-list>

    <div class="footer">
      <n-button v-if="auth.isLocal.value && auth.registerOpen.value" block @click="router.push({ name: 'register' })">
        注册账号
      </n-button>
      <n-popconfirm v-else-if="auth.authenticated.value" @positive-click="logout">
        <template #trigger><n-button block>退出登录</n-button></template>
        退出后书架和订阅需要重新登录才能看到，确定吗？
      </n-popconfirm>
    </div>
  </div>
</template>

<style scoped>
.identity {
  display: flex;
  gap: var(--space-3);
  align-items: center;
  padding: var(--space-5) var(--space-3);
}

.identity__avatar {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 52px;
  height: 52px;
  font-size: 22px;
  font-weight: 600;
  color: #fff;
  background: var(--accent);
  border-radius: 50%;
}

.identity__name {
  margin: 0 0 2px;
  font-size: 17px;
  font-weight: 600;
}

.identity__note {
  max-width: 30ch;
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-muted);
}

.row {
  display: flex;
  flex: 1;
  gap: var(--space-3);
  align-items: center;
  justify-content: space-between;
  font-size: 14px;
}

.row__value {
  font-size: 12px;
  color: var(--text-muted);
}

.footer {
  padding: var(--space-5) var(--space-3);
}
</style>
