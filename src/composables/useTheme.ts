/**
 * 应用整体的明暗主题（Naive UI 那一层）。
 *
 * 和 `useReaderSettings` 的正文配色是两件事：这个管的是外壳（列表、按钮、
 * 卡片），正文底色由读者在阅读设置里单独定 —— 深色外壳配纸白正文是常见搭配。
 */

import { computed, ref, watchEffect } from "vue";

const STORAGE_KEY = "funread.theme";

const stored = localStorage.getItem(STORAGE_KEY);
//  默认深色：这是个夜里会用的阅读应用。
const dark = ref(stored ? stored === "dark" : true);

watchEffect(() => document.documentElement.classList.toggle("dark", dark.value));

export function useTheme() {
  function toggle() {
    dark.value = !dark.value;
    try {
      localStorage.setItem(STORAGE_KEY, dark.value ? "dark" : "light");
    } catch {
      //  隐私模式下写不了，本次会话内仍然生效。
    }
  }

  return { dark: computed(() => dark.value), toggle };
}
