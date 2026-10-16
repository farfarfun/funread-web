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
import { useDialog, useMessage } from "naive-ui";
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";

import { api } from "../../api/client";
import { clearSession, loadSession } from "../../api/packaged";
import type { DeviceToken } from "../../api/types";
import TopBar from "../../components/web/TopBar.vue";
import { formatTime, fromNow } from "../../utils/display";

const router = useRouter();
const message = useMessage();
const dialog = useDialog();

const devices = ref<DeviceToken[]>([]);
const loading = ref(true);
const failed = ref("");
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
 * 而且要重新输一遍账号口令才能回来。
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

    <p class="lede">
      每台装了 funread 客户端的设备在这里占一行。手机丢了、或者借人用过，吊销对应
      的那一条就行 —— 它只断掉那台设备，别的设备和你的口令都不受影响。
    </p>

    <n-spin :show="loading">
      <n-alert v-if="failed" type="error" :bordered="false" class="state">{{ failed }}</n-alert>

      <n-empty
        v-else-if="!devices.length && !loading"
        class="state"
        description="还没有任何设备 token"
      >
        <template #extra>
          <span class="empty-hint">
            装上 funread 的打包版客户端、第一次填完账号口令之后，这里就会出现一条。
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
              吊销后这台设备要重新填账号口令才能用，确定吗？
            </n-popconfirm>
          </template>
        </n-list-item>
      </n-list>
    </n-spin>
  </div>
</template>

<style scoped>
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
