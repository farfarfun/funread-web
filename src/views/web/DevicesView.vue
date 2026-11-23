<script setup lang="ts">
/**
 * 「我的设备」：列出 `GET /auth/tokens`，能单条吊销。
 *
 * 两种形态下都是活的，这是故意的 —— 后端那组端点认 cookie 会话也认 Bearer：
 *
 * - 浏览器 / funread light 里走 cookie 会话。**手机丢了就是在这里吊销它**，
 *   而那时唯一能用的设备恰恰不是手机。
 * - 打包版里走自己那条设备 token，所以能看到并吊销自己。
 *
 * 服务端不会告诉我们哪一条是自己（列表里没有 token 明文，也没有 is_self）。
 * 客户端在签发时把 `id` 存了下来，靠它对号；浏览器里没有这个 id，于是一条都不
 * 标 —— 浏览器本来也不是一条设备 token。
 */
import { AddOutline, CopyOutline } from "@vicons/ionicons5";
import { useDialog, useMessage } from "naive-ui";
import { onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";

import { api } from "../../api/client";
import { clearSession, loadSession } from "../../api/packaged";
import type { DeviceToken, DeviceTokenCreated } from "../../api/types";
import TopBar from "../../components/web/TopBar.vue";
import { formatTime, fromNow } from "../../utils/display";

const router = useRouter();
const message = useMessage();
const dialog = useDialog();

const devices = ref<DeviceToken[]>([]);
const loading = ref(true);
const failed = ref("");
const newName = ref("");
const creating = ref(false);
const created = ref<DeviceTokenCreated | null>(null);
const showCreated = ref(false);
watch(showCreated, (show) => {
  if (!show) created.value = null;
});
/** 打包版里是自己这条 token 的 id；浏览器里是 0，谁也对不上。 */
const currentId = __FUNREAD_PACKAGED__ ? (loadSession()?.token_id ?? 0) : 0;

async function load() {
  loading.value = true;
  failed.value = "";
  try {
    devices.value = await api.devices();
  } catch (reason) {
    failed.value = reason instanceof Error ? reason.message : "读不到设备列表";
  } finally {
    loading.value = false;
  }
}

async function create() {
  if (creating.value) return;
  creating.value = true;
  try {
    created.value = await api.createDevice(newName.value.trim() || "新设备");
    newName.value = "";
    showCreated.value = true;
    await load();
  } catch (reason) {
    message.error(reason instanceof Error ? reason.message : "创建失败");
  } finally {
    creating.value = false;
  }
}

async function copyToken() {
  if (!created.value) return;
  try {
    await navigator.clipboard.writeText(created.value.token);
    message.success("已复制设备凭据");
  } catch {
    message.error("复制失败，请选中凭据手动复制");
  }
}

async function revoke(device: DeviceToken) {
  try {
    await api.revokeDevice(device.id);
  } catch (reason) {
    message.error(reason instanceof Error ? reason.message : "吊销失败");
    return;
  }
  if (__FUNREAD_PACKAGED__ && device.id === currentId) {
    //  刚把自己手上这条凭据删了，本地再留着它只会让下一个请求撞 401。
    clearSession();
    router.replace({ name: "packaged-setup" });
    return;
  }
  devices.value = devices.value.filter((item) => item.id !== device.id);
  message.success(`已吊销「${device.device_name || "未命名设备"}」`);
}

/**
 * 吊销当前这台设备 = 把自己踢下线，所以在列表那一次 popconfirm 之后再拦一道。
 * 两次点击之间说清后果：不是「下次打开要重新登录」，是**这一下就退到配置页**，
 * 而且要重新连接服务器才能回来。
 */
function confirmRevoke(device: DeviceToken) {
  if (!__FUNREAD_PACKAGED__ || device.id !== currentId) {
    void revoke(device);
    return;
  }
  dialog.warning({
    title: "这是你正在用的这台设备",
    content:
      "吊销之后这台设备立刻退回到「连接服务器」那一页，书架、进度都要重新登录才看得到" +
      "（服务器上的数据不会动）。确定吗？",
    positiveText: "吊销并退出",
    negativeText: "取消",
    onPositiveClick: () => {
      void revoke(device);
    },
  });
}

onMounted(load);
</script>

<template>
  <div>
    <TopBar title="我的设备" back fallback="/web/account" />

    <div class="device-create">
      <n-input
        v-model:value="newName"
        maxlength="128"
        placeholder="设备名称"
        @keyup.enter="create"
      />
      <n-button type="primary" :loading="creating" @click="create">
        <template #icon><n-icon :component="AddOutline" /></template>
        创建凭据
      </n-button>
    </div>

    <n-modal v-model:show="showCreated" preset="card" title="设备凭据" class="token-modal">
      <p class="token-note">请立即保存。关闭后无法再次查看，可吊销并重新创建。</p>
      <n-input :value="created?.token ?? ''" readonly class="token-value" />
      <n-button class="token-copy" @click="copyToken">
        <template #icon><n-icon :component="CopyOutline" /></template>
        复制凭据
      </n-button>
    </n-modal>

    <p class="lede">
      每台装了 funread 客户端的设备在这里占一行。手机丢了、或者借人用过，吊销对应
      的那一条就行。其他设备的凭据不受影响。
    </p>

    <n-spin :show="loading">
      <n-alert v-if="failed" type="error" :bordered="false" class="state">{{ failed }}</n-alert>

      <n-empty
        v-else-if="!devices.length && !loading"
        class="state"
        description="还没有任何设备凭据"
      >
        <template #extra>
          <span class="empty-hint">
            为打包客户端创建凭据后，设备会出现在这里。
          </span>
        </template>
      </n-empty>

      <n-list v-else hoverable>
        <n-list-item v-for="device in devices" :key="device.id">
          <div class="device">
            <div class="device__name">
              <span>{{ device.device_name || "未命名设备" }}</span>
              <n-tag v-if="device.id === currentId" size="small" type="success" :bordered="false">
                当前设备
              </n-tag>
            </div>
            <p class="device__meta">
              最近使用 {{ fromNow(device.last_seen_at) }} · 添加于
              {{ formatTime(device.created_at) }}
            </p>
          </div>
          <template #suffix>
            <n-popconfirm @positive-click="confirmRevoke(device)">
              <template #trigger>
                <n-button size="small" quaternary type="error">吊销</n-button>
              </template>
              吊销后这台设备需要重新连接，确定吗？
            </n-popconfirm>
          </template>
        </n-list-item>
      </n-list>
    </n-spin>
  </div>
</template>

<style scoped>
.device-create {
  display: flex;
  gap: var(--space-2);
  padding: var(--space-3);
}

.device-create .n-input {
  flex: 1;
  min-width: 0;
}

.device-create .n-button {
  flex: none;
}

.token-modal {
  width: min(420px, calc(100vw - 32px));
}

.token-note {
  margin: 0 0 var(--space-3);
  font-size: 13px;
  color: var(--text-muted);
}

.token-value :deep(input) {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12px;
}

.token-copy {
  margin-top: var(--space-3);
}

.lede {
  margin: 0;
  padding: var(--space-4) var(--space-3);
  font-size: 13px;
  line-height: 1.6;
  color: var(--text-muted);
}

.state {
  margin: var(--space-5) var(--space-3);
}

.empty-hint {
  display: block;
  max-width: 34ch;
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-muted);
}

.device {
  display: flex;
  flex: 1;
  min-width: 0;
  flex-direction: column;
  gap: var(--space-1);
}

.device__name {
  display: flex;
  gap: var(--space-2);
  align-items: center;
  font-size: 14px;
}

.device__meta {
  margin: 0;
  font-size: 12px;
  color: var(--text-muted);
}
</style>
