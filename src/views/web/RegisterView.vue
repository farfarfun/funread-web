<script setup lang="ts">
/**
 * 注册。两条路，分岔只看「现在有没有账号」—— 和服务端的 `POST /auth/register`
 * 一致：零账号时免邀请码且成 admin，已有账号时必须带一张库里签发过的码。
 * 这一页先探一次 `/auth/accounts`，关着就不给表单，而不是让人填完再被拒。
 */
import { useMessage } from "naive-ui";
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";

import { api } from "../../api/client";
import type { AccountSummary } from "../../api/types";
import { useAuth } from "../../composables/useAuth";

const route = useRoute();
const router = useRouter();
const message = useMessage();
const auth = useAuth();

const summary = ref<AccountSummary | null>(null);
const username = ref("");
const password = ref("");
const confirm = ref("");
const code = ref("");
const submitting = ref(false);
const probing = ref(true);

const next = computed(() => String(route.query.next || "/web"));
const minLength = computed(() => summary.value?.min_password_length ?? 8);
/** 首次运行：不要邀请码，且提示一句第一个账号会接管之前攒下的书架。 */
const isFirst = computed(() => Boolean(summary.value?.bootstrap));
/**
 * 注册关着**也要**渲染首次运行那条路的表单 —— 服务端的 bootstrap 分支刻意不受
 * `FUNREAD_REGISTER_OPEN` 约束，在这边拦掉会让 `FUNREAD_REGISTER_OPEN=0` 的机器
 * 永远开不出第一个账号。
 */
const closed = computed(
  () => Boolean(summary.value) && !summary.value?.register_open && !isFirst.value,
);

const problem = computed(() => {
  if (username.value && username.value.trim().length < 3) return "用户名至少 3 位";
  if (password.value && password.value.length < minLength.value) {
    return `口令至少 ${minLength.value} 位`;
  }
  if (confirm.value && confirm.value !== password.value) return "两次输入的口令不一致";
  return "";
});

const ready = computed(
  () =>
    !problem.value &&
    username.value.trim().length >= 3 &&
    password.value.length >= minLength.value &&
    confirm.value === password.value &&
    //  首次运行那条路服务端不收邀请码，这边要求填就等于把新装的机器堵死。
    (isFirst.value || code.value.trim().length > 0),
);

async function submit() {
  if (!ready.value) return;
  submitting.value = true;
  try {
    await auth.register(username.value.trim(), password.value, code.value.trim());
    message.success("注册成功");
    router.replace(next.value);
  } catch (reason) {
    message.error(reason instanceof Error ? reason.message : "注册失败");
  } finally {
    submitting.value = false;
  }
}

onMounted(async () => {
  try {
    summary.value = await api.accounts();
  } catch {
    //  探测失败就按「可能开着」渲染，让用户试一次 —— 比直接堵住要好
    summary.value = { users: 1, register_open: true, min_password_length: 8, bootstrap: false };
  } finally {
    probing.value = false;
  }
});
</script>

<template>
  <div class="gate">
    <div class="gate__card">
      <h1 class="gate__title">注册</h1>

      <n-spin v-if="probing" class="gate__spin" />

      <template v-else-if="closed">
        <n-result status="info" title="注册未开放" size="small">
          <template #footer>
            <p class="gate__hint">
              服务端设了 <code>FUNREAD_REGISTER_OPEN=0</code>。要放人进来，
              先去掉这个设置，再用 <code>funread-api accounts invite</code> 签发一张邀请码。
            </p>
            <n-button @click="router.replace({ name: 'login', query: { next } })">
              去登录
            </n-button>
          </template>
        </n-result>
      </template>

      <template v-else>
        <p v-if="isFirst" class="gate__subtitle">
          这是第一个账号，之前没有账号时攒下的书架和进度会归到它名下。
        </p>
        <p v-else class="gate__subtitle">需要管理员给的邀请码</p>

        <n-form @submit.prevent="submit">
          <n-form-item label="用户名" :show-feedback="false">
            <n-input
              v-model:value="username"
              placeholder="3-32 位字母、数字、下划线、短横线或点"
              :input-props="{ autocapitalize: 'off', autocorrect: 'off', autocomplete: 'username' }"
            />
          </n-form-item>
          <n-form-item :label="`口令（至少 ${minLength} 位）`" :show-feedback="false">
            <n-input
              v-model:value="password"
              type="password"
              show-password-on="click"
              :input-props="{ autocomplete: 'new-password' }"
            />
          </n-form-item>
          <n-form-item label="再输一次" :show-feedback="false">
            <n-input
              v-model:value="confirm"
              type="password"
              :input-props="{ autocomplete: 'new-password' }"
              @keyup.enter="submit"
            />
          </n-form-item>
          <n-form-item v-if="!isFirst" label="邀请码" :show-feedback="false">
            <n-input
              v-model:value="code"
              placeholder="管理员用 funread-api accounts invite 签发"
              :input-props="{ autocapitalize: 'off', autocorrect: 'off' }"
              @keyup.enter="submit"
            />
          </n-form-item>

          <p v-if="problem" class="gate__problem">{{ problem }}</p>

          <n-button
            type="primary"
            block
            size="large"
            class="gate__submit"
            :disabled="!ready"
            :loading="submitting"
            attr-type="submit"
          >
            注册
          </n-button>
        </n-form>

        <p class="gate__alt">
          已经有账号了？
          <RouterLink :to="{ name: 'login', query: { next } }">去登录</RouterLink>
        </p>
      </template>
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
  font-size: 24px;
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

.gate__spin {
  display: block;
  margin: var(--space-6) auto;
}

.gate__hint {
  max-width: 34ch;
  margin: 0 auto var(--space-3);
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-muted);
}

.gate__problem {
  margin: var(--space-3) 0 0;
  font-size: 12px;
  color: #d03050;
}

.gate__submit {
  margin-top: var(--space-4);
}

.gate__alt {
  margin: var(--space-4) 0 0;
  font-size: 12px;
  color: var(--text-muted);
  text-align: center;
}

.gate__alt a {
  color: var(--accent);
}
</style>
