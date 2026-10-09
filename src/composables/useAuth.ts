/**
 * 登录态。模块级单例，不用 pinia —— 整个应用只需要一份会话状态，
 * 一个 composable 加两个 ref 就够，引一套状态管理反而要多维护一层。
 */

import { computed, readonly, ref } from "vue";

import { api } from "../api/client";
import type { SessionState } from "../api/types";

const state = ref<SessionState | null>(null);
const loading = ref(false);
/** 首次探测只做一次，后面并发调用复用同一个 promise。 */
let probe: Promise<SessionState | null> | null = null;

async function fetchState(): Promise<SessionState | null> {
  loading.value = true;
  try {
    state.value = await api.me();
  } catch {
    //  /auth/me 本身不需要登录，所以失败只可能是网络或后端挂了。
    //  当成「未登录」处理，让界面去登录页而不是卡在加载态。
    state.value = null;
  } finally {
    loading.value = false;
  }
  return state.value;
}

export function useAuth() {
  /** 保证会话状态已就绪。路由守卫在跳转前调它。 */
  async function ensure(): Promise<SessionState | null> {
    if (state.value) return state.value;
    probe ??= fetchState().finally(() => {
      probe = null;
    });
    return probe;
  }

  async function refresh() {
    return fetchState();
  }

  async function login(username: string, password: string) {
    state.value = await api.login(username, password);
    return state.value;
  }

  async function register(username: string, password: string, code: string) {
    state.value = await api.register(username, password, code);
    return state.value;
  }

  async function adminLogin(password: string) {
    state.value = await api.adminLogin(password);
    return state.value;
  }

  async function logout() {
    await api.logout();
    state.value = await api.me().catch(() => null);
  }

  return {
    state: readonly(state),
    loading: readonly(loading),
    authenticated: computed(() => Boolean(state.value?.authenticated)),
    isAdmin: computed(() => Boolean(state.value?.admin)),
    /** 还没有任何账号。用于「首次运行」的注册引导。 */
    isLocal: computed(() => Boolean(state.value?.local)),
    registerOpen: computed(() => Boolean(state.value?.register_open)),
    username: computed(() => state.value?.username ?? ""),
    ensure,
    refresh,
    login,
    register,
    adminLogin,
    logout,
  };
}
