<script setup lang="ts">
/** 「我的」。管理端入口放在这里，不进 TabBar —— 读者用不着看到它。 */
import {
  ChevronForwardOutline,
  CloudUploadOutline,
  CompassOutline,
  LayersOutline,
  MoonOutline,
  PhonePortraitOutline,
  StarOutline,
  SunnyOutline,
  TimeOutline,
} from "@vicons/ionicons5";
import { useMessage } from "naive-ui";
import { computed, onActivated, onMounted, ref } from "vue";
import { useRouter } from "vue-router";

import { api } from "../../api/client";
import { clearSession, loadSession } from "../../api/packaged";
import TopBar from "../../components/web/TopBar.vue";
import { useAuth } from "../../composables/useAuth";
import { useSearchHistory } from "../../composables/useSearchHistory";
import { useTheme } from "../../composables/useTheme";
import { clearAllOffline, countAllCachedChapters } from "../../utils/offline";

/**
 * funread light（Capacitor 套壳）往 WebView 上挂的原生对象，只有「回到填地址的
 * 启动页」这一个动作，见 mobile/android/app/src/main/java/…/MainActivity.java。
 *
 * 套壳加载的是用户自己服务器上的这个页面，页面来源是远端，所以 Capacitor 的
 * JS bridge 不会注入进来 —— 能用的只有 addJavascriptInterface 挂上去的这个。
 * 浏览器里它不存在，下面的入口也就不会出现。
 */
interface FunreadShell {
  openSetup?: () => void;
}

const router = useRouter();
const message = useMessage();
const auth = useAuth();
const shell = (window as unknown as { FunreadShell?: FunreadShell }).FunreadShell;
//  不用 ref：原生对象在页面脚本跑起来之前就挂好了，之后不会变。
const inShell = typeof shell?.openSetup === "function";
//  打包版（Web 资源打进 app、跨站、设备 token）。构建期常量，浏览器和 light 版
//  那两份产物里下面这些分支连同它们引到的代码一起被删掉。
const packaged = __FUNREAD_PACKAGED__;
const packagedServer = packaged ? (loadSession()?.server ?? "") : "";
const { dark, toggle } = useTheme();
const { history, clear: clearHistory } = useSearchHistory();

const cachedTotal = ref(0);
const counting = ref(true);

//  两种形态下「退出」的后果不一样：浏览器里是注销会话，打包版里是把这台设备的
//  token 吊销掉。文案得跟着变，否则用户以为只是登出、下次打开才发现要重配。
const logoutHint = computed(() =>
  packaged
    ? auth.oidcEnabled.value
      ? "退出会吊销这台设备的凭据，下次需要重新连接。确定吗？"
      : "退出会吊销这台设备的 token，下次打开要重新填服务器地址和账号口令。确定吗？"
    : "退出后书架和订阅需要重新登录才能看到，确定吗？",
);

const cachedLabel = computed(() =>
  counting.value ? "统计中…" : `${cachedTotal.value} 章已缓存（本机）`,
);

async function countCache() {
  counting.value = true;
  try {
    //  直接统计本机 IndexedDB 离线存储，零网络 N+1 请求且断网可用
    cachedTotal.value = await countAllCachedChapters();
  } catch {
    cachedTotal.value = 0;
  } finally {
    counting.value = false;
  }
}

async function clearAllCache() {
  try {
    await clearAllOffline();
    cachedTotal.value = 0;
    message.success("已清空本机离线缓存");
  } catch (reason) {
    message.error(reason instanceof Error ? reason.message : "清空失败");
  }
}

async function logout() {
  if (__FUNREAD_PACKAGED__) {
    //  打包版没有会话可注销，「退出」就是扔掉这台设备的 token。先吊销再清本地
    //  —— 反过来的话就没有凭据可用来吊销了，服务端会留下一条谁也认不出来的
    //  僵尸记录。吊销失败照样往下走：本地清掉至少这台设备看不到数据了，服务端
    //  那条用户可以在别的设备的「我的设备」里删。
    const session = loadSession();
    if (session?.token_id) await api.revokeDevice(session.token_id).catch(() => undefined);
    clearSession();
    router.replace({ name: "packaged-setup" });
    return;
  }
  await auth.logout();
  router.replace({ name: "login" });
}

let skipInitialActivate = false;
onMounted(() => {
  skipInitialActivate = true;
  auth.ensure();
  countCache();
});
onActivated(() => {
  if (skipInitialActivate) {
    skipInitialActivate = false;
    return;
  }
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

      <n-list-item
        clickable
        role="button"
        tabindex="0"
        @click="router.push({ name: 'rss-favorites' })"
        @keyup.enter="router.push({ name: 'rss-favorites' })"
      >
        <div class="row">
          <span class="row__label">
            <n-icon size="17" class="row__icon"><StarOutline /></n-icon>
            <span>收藏的文章</span>
          </span>
          <n-icon size="16" class="row__chevron"><ChevronForwardOutline /></n-icon>
        </div>
      </n-list-item>

      <n-list-item
        clickable
        role="button"
        tabindex="0"
        @click="router.push({ name: 'rss-history' })"
        @keyup.enter="router.push({ name: 'rss-history' })"
      >
        <div class="row">
          <span class="row__label">
            <n-icon size="17" class="row__icon"><TimeOutline /></n-icon>
            <span>阅读历史</span>
          </span>
          <n-icon size="16" class="row__chevron"><ChevronForwardOutline /></n-icon>
        </div>
      </n-list-item>

      <n-list-item
        clickable
        role="button"
        tabindex="0"
        @click="router.push({ name: 'rss-sources' })"
        @keyup.enter="router.push({ name: 'rss-sources' })"
      >
        <div class="row">
          <span class="row__label">
            <n-icon size="17" class="row__icon"><CompassOutline /></n-icon>
            <span>订阅源目录</span>
          </span>
          <n-icon size="16" class="row__chevron"><ChevronForwardOutline /></n-icon>
        </div>
      </n-list-item>

      <n-list-item
        clickable
        role="button"
        tabindex="0"
        @click="router.push({ name: 'devices' })"
        @keyup.enter="router.push({ name: 'devices' })"
      >
        <div class="row">
          <span class="row__label">
            <n-icon size="17" class="row__icon"><PhonePortraitOutline /></n-icon>
            <span>我的设备</span>
          </span>
          <span class="row__trailing">
            <span class="row__value">手机丢了在这里吊销</span>
            <n-icon size="16" class="row__chevron"><ChevronForwardOutline /></n-icon>
          </span>
        </div>
      </n-list-item>

      <n-list-item v-if="inShell">
        <div class="row">
          <span>切换服务器</span>
          <span class="row__value">funread light</span>
        </div>
        <template #suffix>
          <n-button size="small" quaternary @click="shell?.openSetup?.()">更换</n-button>
        </template>
      </n-list-item>

      <!-- 打包版：服务器地址是本机配置的，改地址和重新登录是同一张表单
           （换服务器必然要换一条 token，分开做只会是两份一样的表单）。 -->
      <n-list-item v-if="packaged">
        <div class="row">
          <span>服务器</span>
          <span class="row__value">{{ packagedServer || "未配置" }}</span>
        </div>
        <template #suffix>
          <n-button size="small" quaternary @click="router.push({ name: 'packaged-setup' })">
            更换 / 重新登录
          </n-button>
        </template>
      </n-list-item>

      <template v-if="auth.isAdmin.value">
        <n-list-item
          clickable
          role="button"
          tabindex="0"
          @click="router.push({ name: 'admin-pool' })"
          @keyup.enter="router.push({ name: 'admin-pool' })"
        >
          <div class="row">
            <span class="row__label">
              <n-icon size="17" class="row__icon"><LayersOutline /></n-icon>
              <span>候选源池</span>
            </span>
            <span class="row__trailing">
              <span class="row__value">管理端</span>
              <n-icon size="16" class="row__chevron"><ChevronForwardOutline /></n-icon>
            </span>
          </div>
        </n-list-item>

        <n-list-item
          clickable
          role="button"
          tabindex="0"
          @click="router.push({ name: 'admin-sources' })"
          @keyup.enter="router.push({ name: 'admin-sources' })"
        >
          <div class="row">
            <span class="row__label">
              <n-icon size="17" class="row__icon"><CloudUploadOutline /></n-icon>
              <span>采集源管理</span>
            </span>
            <span class="row__trailing">
              <span class="row__value">管理端</span>
              <n-icon size="16" class="row__chevron"><ChevronForwardOutline /></n-icon>
            </span>
          </div>
        </n-list-item>
      </template>
    </n-list>

    <div class="footer">
      <!-- registerOpen 不参与判断：零账号那条路服务端刻意不受它约束。 -->
      <n-button v-if="auth.isLocal.value" block @click="router.push({ name: 'register' })">
        注册账号
      </n-button>
      <n-popconfirm v-else-if="auth.authenticated.value" @positive-click="logout">
        <template #trigger><n-button block>退出登录</n-button></template>
        {{ logoutHint }}
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
  font-weight: 650;
  color: var(--accent-fg);
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

.row__label {
  display: inline-flex;
  gap: var(--space-2);
  align-items: center;
}

.row__icon {
  color: var(--text-muted);
}

.row__trailing {
  display: inline-flex;
  gap: var(--space-1);
  align-items: center;
}

.row__value {
  font-size: 12px;
  color: var(--text-muted);
}

.row__chevron {
  color: var(--text-muted);
  opacity: 0.7;
}

.footer {
  padding: var(--space-5) var(--space-3);
}
</style>
