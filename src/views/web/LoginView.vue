<script setup lang="ts">
/** 读者登录。失败一律同一句文案 —— 后端刻意不区分「用户不存在」和「口令错」。 */
import { useMessage } from "naive-ui";
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";

import { useAuth } from "../../composables/useAuth";

const route = useRoute();
const router = useRouter();
const message = useMessage();
const auth = useAuth();

const username = ref("");
const password = ref("");
const submitting = ref(false);

const next = computed(() => String(route.query.next || "/web"));

async function submit() {
  if (!username.value.trim() || !password.value) return;
  submitting.value = true;
  try {
    await auth.login(username.value.trim(), password.value);
    router.replace(next.value);
  } catch (reason) {
    message.error(reason instanceof Error ? reason.message : "登录失败");
  } finally {
    submitting.value = false;
  }
}

onMounted(() => auth.ensure());
</script>

<template>
  <div class="gate">
    <div class="gate__card">
      <h1 class="gate__title">funread</h1>
      <p class="gate__subtitle">登录后同步书架、阅读进度和订阅</p>

      <n-form @submit.prevent="submit">
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
        <n-button
          type="primary"
          block
          size="large"
          class="gate__submit"
          :loading="submitting"
          attr-type="submit"
        >
          登录
        </n-button>
      </n-form>

      <!-- isLocal 也放行：零账号那条路服务端不受 FUNREAD_REGISTER_OPEN 约束，
           这边藏掉链接会让设了该变量的新机器永远开不出第一个账号。 -->
      <p v-if="auth.registerOpen.value || auth.isLocal.value" class="gate__alt">
        还没有账号？
        <RouterLink :to="{ name: 'register', query: { next } }">
          {{ auth.isLocal.value ? "注册第一个账号" : "用邀请码注册" }}
        </RouterLink>
      </p>
      <p v-else class="gate__alt gate__alt--muted">
        注册未开放。需要管理员签发一张邀请码才能开新账号。
      </p>

      <p class="gate__admin">
        <RouterLink :to="{ name: 'admin-login' }">管理端登录</RouterLink>
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
  color: var(--text-muted);
  text-align: center;
}

.gate__submit {
  margin-top: var(--space-4);
}

.gate__alt,
.gate__admin {
  margin: var(--space-4) 0 0;
  font-size: 12px;
  color: var(--text-muted);
  text-align: center;
}

.gate__alt--muted {
  line-height: 1.6;
}

.gate__admin {
  margin-top: var(--space-5);
}

.gate__alt a,
.gate__admin a {
  color: var(--accent);
}
</style>
