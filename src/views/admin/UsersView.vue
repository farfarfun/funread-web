<script setup lang="ts">
/**
 * 人员管理：列出账号，改角色（访客 ⇄ 管理员），停用 / 启用。
 *
 * 管理端从「单口令」改成「按账号角色」之后，提权这件事必须有个界面 —— 否则加一个
 * 管理员就只能上服务器敲 `funread-api accounts create-admin`。
 *
 * 两条护栏在后端（`PATCH /auth/users/{id}`），前端只是提前把按钮禁掉、省掉一次
 * 注定失败的请求：不能动自己，不能把最后一个在用的管理员降级或停用。后端那两条
 * 才是真正算数的，前端这层是手感。
 */
import { RefreshOutline } from "@vicons/ionicons5";
import type { DataTableColumns } from "naive-ui";
import { NButton, NSpace, NSwitch, NTag, useMessage } from "naive-ui";
import { computed, h, onMounted, ref } from "vue";

import { api } from "../../api/client";
import type { ManagedUser } from "../../api/types";

const message = useMessage();

const users = ref<ManagedUser[]>([]);
const loading = ref(true);
const error = ref("");
const busy = ref<number | null>(null);

/** 还在用的管理员数量。减到 1 时，那一个就不能再被降级或停用。 */
const activeAdmins = computed(
  () => users.value.filter((item) => item.role === "admin" && item.is_active).length,
);

function isLastAdmin(row: ManagedUser) {
  return row.role === "admin" && row.is_active && activeAdmins.value <= 1;
}

async function load() {
  loading.value = true;
  error.value = "";
  try {
    users.value = await api.users();
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : "加载失败";
  } finally {
    loading.value = false;
  }
}

async function patch(row: ManagedUser, payload: { role?: string; is_active?: boolean }) {
  busy.value = row.user_id;
  try {
    const updated = await api.updateUser(row.user_id, payload);
    users.value = users.value.map((item) =>
      item.user_id === updated.user_id ? { ...updated, is_self: item.is_self } : item,
    );
    message.success(`已更新「${updated.username}」`);
  } catch (reason) {
    message.error(reason instanceof Error ? reason.message : "更新失败");
  } finally {
    busy.value = null;
  }
}

const columns = computed<DataTableColumns<ManagedUser>>(() => [
  {
    title: "账号",
    key: "username",
    render: (row) =>
      h(NSpace, { size: 6, align: "center" }, () => [
        h("span", {}, row.username),
        row.is_self ? h(NTag, { size: "tiny", bordered: false }, () => "我") : null,
      ]),
  },
  {
    title: "角色",
    key: "role",
    width: 180,
    render: (row) => {
      const admin = row.role === "admin";
      //  自己和「最后一个管理员」都不给切 —— 切了会把管理端锁死
      const locked = row.is_self || isLastAdmin(row);
      return h(NSpace, { size: 8, align: "center" }, () => [
        h(
          NTag,
          { size: "small", type: admin ? "success" : "default", bordered: false },
          () => (admin ? "管理员" : "访客"),
        ),
        h(
          NButton,
          {
            size: "tiny",
            quaternary: true,
            disabled: locked,
            loading: busy.value === row.user_id,
            onClick: () => patch(row, { role: admin ? "guest" : "admin" }),
          },
          () => (admin ? "降为访客" : "提为管理员"),
        ),
      ]);
    },
  },
  {
    title: "启用",
    key: "is_active",
    width: 90,
    render: (row) =>
      h(NSwitch, {
        value: row.is_active,
        size: "small",
        disabled: row.is_self || isLastAdmin(row),
        loading: busy.value === row.user_id,
        "onUpdate:value": (value: boolean) => patch(row, { is_active: value }),
      }),
  },
]);

onMounted(load);
</script>

<template>
  <section class="users">
    <header class="users__head">
      <div>
        <h1 class="users__title">人员管理</h1>
        <p class="users__hint">
          管理员才能进入管理端的各个页面。角色由这里决定，不再有单独的管理口令。
        </p>
      </div>
      <n-button :loading="loading" @click="load">
        <template #icon><n-icon :component="RefreshOutline" /></template>
        刷新
      </n-button>
    </header>

    <n-alert v-if="error" type="error" :show-icon="false">{{ error }}</n-alert>
    <n-alert v-else-if="activeAdmins <= 1" type="warning" :show-icon="false" class="users__warn">
      目前只有一个在用的管理员。它不能被降级或停用，否则没有人能再进入管理端。
    </n-alert>

    <n-data-table
      :columns="columns"
      :data="users"
      :loading="loading"
      :row-key="(row: ManagedUser) => row.user_id"
      size="small"
    />
  </section>
</template>

<style scoped>
.users {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.users__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-4);
}

.users__title {
  margin: 0 0 var(--space-1);
  font-size: 20px;
  font-weight: 700;
}

.users__hint {
  margin: 0;
  font-size: 13px;
  color: var(--text-muted);
}

.users__warn {
  font-size: 13px;
}
</style>
