<script setup lang="ts">
/**
 * 管理端的「权限不足」页。
 *
 * 这里曾经是一个单口令登录页（`[auth] password`）。管理端改成按账号角色鉴权之后
 * 那套口令不再能解锁管理端，所以这一页也不再收口令 —— 路由守卫只在**已经登录、
 * 但不是管理员**时把人送到这儿。没登录的会被送去读者登录页，登完直接回管理端。
 *
 * 为什么要单独一页而不是弹个 toast 把人踢回阅读端：权限不足和没登录是两回事，
 * 后者再登一次就好，前者登多少次都没用，得明确告诉人「找管理员提权」。
 */
import { computed, onMounted } from "vue";
import { useRouter } from "vue-router";

import { useAuth } from "../../composables/useAuth";

const router = useRouter();
const auth = useAuth();

const username = computed(() => auth.username.value);

function toReader() {
  router.replace("/web");
}

async function switchAccount() {
  await auth.logout();
  router.replace({ name: "login", query: { next: "/admin/sources" } });
}

onMounted(() => auth.ensure());
</script>

<template>
  <div class="gate">
    <div class="gate__card">
      <h1 class="gate__title">需要管理员权限</h1>
      <p class="gate__subtitle">
        当前登录的是<strong>{{ username || "未知账号" }}</strong
        >，它是访客账号，进不了采集源管理。<br />
        找一位管理员在「人员管理」里把这个账号提成管理员即可。
      </p>

      <n-button type="primary" block size="large" @click="toReader">回到阅读端</n-button>
      <n-button block size="large" class="gate__alt-btn" @click="switchAccount">
        换个账号登录
      </n-button>

      <p class="gate__hint">
        一个管理员都没有时，可以在服务器上执行
        <code>funread-api accounts create-admin &lt;用户名&gt;</code> 建一个。
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

.gate__alt-btn {
  margin-top: var(--space-3);
}

.gate__hint {
  margin: var(--space-5) 0 0;
  font-size: 12px;
  line-height: 1.7;
  color: var(--text-muted);
  text-align: center;
}

.gate__hint code {
  padding: 1px 4px;
  font-size: 11px;
  background: var(--fill-weak, rgba(128, 128, 128, 0.14));
  border-radius: 4px;
}
</style>
