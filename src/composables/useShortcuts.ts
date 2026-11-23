/**
 * 键盘快捷键。PC 支持的核心 —— 在桌面上，翻章靠点屏幕左右 25% 的区域是不可接受
 * 的：2560px 宽的屏幕上那是 640px 的死区，而键盘才是桌面的自然输入。
 *
 * 三条硬规则：
 *
 * 1. **输入框里不拦截。** 在 `<input>` / `<textarea>` / `contenteditable` 里按
 *    左右方向键是移动光标，拦掉会让搜索框没法编辑。
 * 2. **带修饰键的组合不拦截。** `Ctrl+←` 是浏览器/系统的，`Cmd+[` 是后退。
 * 3. **兼容 `<KeepAlive>`。** 组件进入后台缓存时通过 `onDeactivated` 摘除监听，
 *    回到前台时通过 `onActivated` 重新挂上，避免书架等缓存页的快捷键误触发在正文页。
 */

import { onActivated, onBeforeUnmount, onDeactivated, onMounted } from "vue";

export type ShortcutHandler = (event: KeyboardEvent) => void;

/** 键 → 处理函数。键名用 `KeyboardEvent.key` 的原值（区分大小写）。 */
export type ShortcutMap = Record<string, ShortcutHandler>;

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return target.isContentEditable;
}

/**
 * 挂一组快捷键，组件失活或卸载时自动摘掉。
 *
 * 处理函数里**不要**自己 `preventDefault` —— 这里统一做掉了，少一处容易忘。
 */
export function useShortcuts(map: ShortcutMap, options: { enabled?: () => boolean } = {}) {
  let attached = false;

  function onKeydown(event: KeyboardEvent) {
    if (options.enabled && !options.enabled()) return;
    //  修饰键组合留给浏览器与系统
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (isEditable(event.target)) return;
    const handler = map[event.key];
    if (!handler) return;
    event.preventDefault();
    handler(event);
  }

  function attach() {
    if (attached) return;
    attached = true;
    window.addEventListener("keydown", onKeydown);
  }

  function detach() {
    if (!attached) return;
    attached = false;
    window.removeEventListener("keydown", onKeydown);
  }

  onMounted(attach);
  onActivated(attach);
  onDeactivated(detach);
  onBeforeUnmount(detach);
}
