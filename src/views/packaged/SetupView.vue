<script setup lang="ts">
/**
 * 打包版的配置页：填服务器地址 + 账号口令，换一条设备 token 存下来。
 *
 * **只存在于 `--mode packaged` 的那份构建里** —— 路由表里这条记录包在
 * `__FUNREAD_PACKAGED__` 的分支中，浏览器那份构建里整条连同这个组件一起被删掉。
 *
 * 三件事挤在一屏、没做成向导，是因为后端的 `POST /auth/tokens/issue` 一次调用就
 * 同时验证了地址、账号和口令 —— 拆成三步的话前两步只能假装成功，最后一步才一起
 * 报错，反而更难说清是哪里填错了。
 *
 * 这一页兼三个入口：首次配置、换服务器、重新登录。它们在数据上是同一件事（换一条
 * (服务器, token) 组合），做成三个页面只会有三份同样的表单。
 */
import { useMessage } from "naive-ui";
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";

import { api, issueDeviceToken, UnauthorizedError } from "../../api/client";
import {
  forgetServer,
  guessDeviceName,
  loadSession,
  normalizeServer,
  recentServers,
  saveSession,
} from "../../api/packaged";
import { useAuth } from "../../composables/useAuth";

const route = useRoute();
const router = useRouter();
const message = useMessage();
const auth = useAuth();

const server = ref("");
const username = ref("");
const password = ref("");
const deviceName = ref("");
const submitting = ref(false);
/** 多行文案（排查清单），所以不走 message —— 那是一行就没了的 toast。 */
const error = ref("");
const servers = ref<string[]>([]);

const existing = loadSession();
const next = computed(() => String(route.query.next || "/web"));
const title = computed(() => (existing ? "换一台服务器" : "连接到你的 funread"));

function dropServer(item: string) {
  forgetServer(item);
  servers.value = recentServers();
}

async function submit() {
  const normalized = normalizeServer(server.value);
  if (!normalized.value) {
    error.value = normalized.error ?? "";
    return;
  }
  server.value = normalized.value;
  if (!username.value.trim() || !password.value) {
    error.value = "账号和口令都要填。打包版没有同源 cookie 可借，必须自己换一条 token。";
    return;
  }

  submitting.value = true;
  error.value = "";
  try {
    const issued = await issueDeviceToken({
      server: normalized.value,
      username: username.value.trim(),
      password: password.value,
      device_name: deviceName.value.trim() || guessDeviceName(),
    });
    const previous = loadSession();
    saveSession({
      server: normalized.value,
      token: issued.token,
      token_id: issued.id,
      username: username.value.trim(),
      device_name: issued.device_name,
    });
    //  同一台服务器上重新登录时，把自己上一条 token 吊销掉 —— 不然每换一次
    //  口令、每清一次存储，设备列表里就多一条谁也认不出来的僵尸记录。
    //  换了服务器就不管了（那条 token 在另一台机器上，这里够不着）。
    if (previous && previous.server === normalized.value && previous.token_id) {
      await api.revokeDevice(previous.token_id).catch(() => undefined);
    }
    //  会话状态是模块级单例，上一轮可能缓存着「未登录」。不刷新的话路由守卫
    //  会立刻把人弹回这一页。
    await auth.refresh();
    message.success(`已连接 ${normalized.value}`);
    router.replace(next.value);
  } catch (reason) {
    if (reason instanceof UnauthorizedError) {
      error.value = "账号或口令不对。";
    } else {
      error.value = reason instanceof Error ? reason.message : "连接失败。";
    }
    servers.value = recentServers();
  } finally {
    submitting.value = false;
  }
}

onMounted(() => {
  servers.value = recentServers();
  //  预填：先用当前这条会话的地址，没有就用最近用过的。token 失效被清掉时
  //  地址是单独存的、不会一起没，所以这里基本总能填上 —— 用户只要再敲口令。
  server.value = existing?.server || servers.value[0] || "";
  username.value = existing?.username || "";
  deviceName.value = existing?.device_name || guessDeviceName();
});
</script>

<template>
  <div class="gate">
    <div class="gate__card">
      <h1 class="gate__title">{{ title }}</h1>
      <p class="gate__subtitle">
        funread 是自托管的，没有官方服务器可连。填上你自己那台的地址和账号，
        这台设备会换到一条长期有效的凭据，之后就不用再登录了。
      </p>

      <n-form @submit.prevent="submit">
        <n-form-item label="服务器地址" :show-feedback="false">
          <!-- 不用 type="url"：浏览器按「绝对 URL」校验，用户敲的
               `192.168.1.10:8811` 会被拦在提交之前，normalizeServer 里自动补
               http:// 的那段根本没机会跑。 -->
          <n-input
            v-model:value="server"
            placeholder="http://192.168.1.10:8811"
            :input-props="{
              inputmode: 'url',
              autocapitalize: 'off',
              autocorrect: 'off',
              spellcheck: false,
            }"
          />
        </n-form-item>

        <div v-if="servers.length" class="recent">
          <span class="recent__label">用过的</span>
          <n-tag
            v-for="item in servers"
            :key="item"
            size="small"
            closable
            class="recent__item"
            @click="server = item"
            @close="dropServer(item)"
          >
            {{ item }}
          </n-tag>
        </div>

        <n-form-item label="用户名" :show-feedback="false">
          <n-input
            v-model:value="username"
            placeholder="用户名"
            :input-props="{ autocapitalize: 'off', autocorrect: 'off', autocomplete: 'username' }"
          />
        </n-form-item>

        <n-form-item label="口令" :show-feedback="false">
          <n-input
            v-model:value="password"
            type="password"
            show-password-on="click"
            placeholder="口令"
            :input-props="{ autocomplete: 'current-password' }"
            @keyup.enter="submit"
          />
        </n-form-item>

        <n-form-item label="设备名" :show-feedback="false">
          <n-input v-model:value="deviceName" placeholder="这台设备在「我的设备」里显示的名字" />
        </n-form-item>

        <n-button
          type="primary"
          block
          size="large"
          class="gate__submit"
          :loading="submitting"
          attr-type="submit"
        >
          连接
        </n-button>
      </n-form>

      <p v-if="error" class="gate__error">{{ error }}</p>

      <p v-if="existing" class="gate__alt">
        <!-- 带着一条还能用的会话进来的（从「我的」点进来改地址），得有路回去。 -->
        <n-button text @click="router.back()">取消，回到 {{ existing.server }}</n-button>
      </p>

      <p class="gate__note">
        口令不会存在这台设备上 —— 存的是服务端签发的设备 token，可以在任意一台
        设备的「我的 → 我的设备」里单独吊销。
      </p>
    </div>
  </div>
</template>

<style scoped>
.gate {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100dvh;
  padding: var(--space-4);
}

.gate__card {
  width: min(100%, 360px);
}

.gate__title {
  margin: 0 0 var(--space-1);
  font-size: 26px;
  font-weight: 700;
  text-align: center;
}

.gate__subtitle {
  margin: 0 0 var(--space-5);
  font-size: 13px;
  line-height: 1.6;
  color: var(--text-muted);
  text-align: center;
}

.gate__submit {
  margin-top: var(--space-4);
}

.gate__error {
  /* 排查清单是多行的，必须保住换行 —— 挤成一段就没人看了 */
  margin: var(--space-4) 0 0;
  font-size: 13px;
  line-height: 1.6;
  color: var(--danger);
  white-space: pre-line;
}

.gate__alt {
  margin: var(--space-4) 0 0;
  font-size: 12px;
  text-align: center;
}

.gate__note {
  margin: var(--space-5) 0 0;
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-muted);
  text-align: center;
}

.recent {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  align-items: center;
  margin: var(--space-2) 0 var(--space-3);
}

.recent__label {
  font-size: 12px;
  color: var(--text-muted);
}

.recent__item {
  cursor: pointer;
}
</style>
