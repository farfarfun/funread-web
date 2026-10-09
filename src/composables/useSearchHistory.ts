/**
 * 最近搜索（功能清单 B3）。只存 localStorage，不落库 —— 搜索词是设备上的
 * 临时痕迹，同步到服务端既没有价值也多一份要保护的个人数据。
 */

import { readonly, ref } from "vue";

const STORAGE_KEY = "funread.search.history";
const MAX_ITEMS = 10;

function load(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string").slice(0, MAX_ITEMS);
  } catch {
    return [];
  }
}

const history = ref<string[]>(load());

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history.value));
  } catch {
    //  隐私模式下写不了。
  }
}

export function useSearchHistory() {
  function remember(keyword: string) {
    const value = keyword.trim();
    if (!value) return;
    //  去重后置顶：重复搜同一个词不该在列表里堆出好几行
    history.value = [value, ...history.value.filter((item) => item !== value)].slice(
      0,
      MAX_ITEMS,
    );
    persist();
  }

  function forget(keyword: string) {
    history.value = history.value.filter((item) => item !== keyword);
    persist();
  }

  function clear() {
    history.value = [];
    persist();
  }

  return { history: readonly(history), remember, forget, clear };
}
