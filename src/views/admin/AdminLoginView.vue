<script setup lang="ts">
/**
 * 管理端登录。单口令，和读者账号是两套凭据 —— 读者 cookie 打不开这里，
 * 管理 cookie 也不是一个读者身份。
 */
import { useMessage } from "naive-ui";
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";

import { useAuth } from "../../composables/useAuth";

const route = useRoute();
const router = useRouter();
const message = useMessage();
const auth = useAuth();

const password = ref("");
const submitting = ref(false);

const next = computed(() => String(route.query.next || "/admin/sources"));

async function submit() {
  submitting.value = true;
  try {
    const state = await auth.adminLogin(password.value);
    if (!state?.auth_required) {
      //  服务端没配口令，所有接口本来就是开放的 —— 直接放行，别卡在这一页。
      message.info("服务端未配置管理口令，已直接进入");
    }
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
      <h1 class="gate__title">管理端</h1>
      <p class="gate__subtitle">采集源管理。口令由 FUNREAD_API_PASSWORD 配置。</p>

      <n-form @submit.prevent="submit">
        <n-form-item label="口令" :show-feedback="false">
          <n-input
            v-model:value="password"
            type="password"
            show-password-on="click"
            placeholder="管理口令"
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
          进入
        </n-button>
      </n-form>

      <p class="gate__alt"><a href="/web">回到阅读端</a></p>
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

.gate__submit {
  margin-top: var(--space-4);
}

.gate__alt {
  margin: var(--space-5) 0 0;
  font-size: 12px;
  color: var(--text-muted);
  text-align: center;
}

.gate__alt a {
  color: var(--accent);
}
</style>
