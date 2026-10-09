/**
 * 视口形态。决定界面走移动端还是桌面端布局。
 *
 * 为什么不只看宽度：宽度和输入方式是两件事。一台 1280px 的触屏笔记本需要桌面
 * 布局（有空间）**但也需要 44px 的触控区**；一台窄窗口的桌面浏览器需要移动布局
 * 但 hover 是有效的。所以分成两个独立判断：
 *
 * - `isWide` —— 有没有横向空间（走多列、侧栏、更大的内容宽度）
 * - `isTouch` —— 主输入是不是手指（决定触控区尺寸与是否显示 hover 提示）
 *
 * 模块级单例 + 一个 resize 监听，不是每个组件各装一个。
 */

import { computed, ref } from "vue";

/**
 * 桌面断点。768 是「平板竖屏也算窄」的常见取值，而 1024 会把 iPad 横屏
 * （1024px）排除在外 —— 那个尺寸明显该用多列。
 */
export const WIDE_BREAKPOINT = 900;

const width = ref(typeof window === "undefined" ? 1280 : window.innerWidth);
//  `pointer: coarse` 是「主输入是手指」的标准判定，比 UA 嗅探可靠。
const coarse = ref(
  typeof window === "undefined" ? false : window.matchMedia("(pointer: coarse)").matches,
);

if (typeof window !== "undefined") {
  //  不节流：resize 期间只改两个 ref，而 Vue 本来就会把渲染合批到下一帧。
  //  加节流反而会让拖窗口时的布局跟手感变差。
  window.addEventListener("resize", () => (width.value = window.innerWidth), { passive: true });
  const media = window.matchMedia("(pointer: coarse)");
  media.addEventListener("change", (event) => (coarse.value = event.matches));
}

export function useViewport() {
  return {
    width: computed(() => width.value),
    isWide: computed(() => width.value >= WIDE_BREAKPOINT),
    isTouch: computed(() => coarse.value),
    /** 既宽又用鼠标 —— 可以上 hover 态、键盘提示这类纯桌面交互。 */
    isDesktop: computed(() => width.value >= WIDE_BREAKPOINT && !coarse.value),
  };
}
