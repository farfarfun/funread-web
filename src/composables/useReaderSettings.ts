/**
 * 阅读设置：字号、行距、页边距、主题。
 *
 * 存 `localStorage` 而不落库，是因为这是**设备**偏好而不是账号偏好 —— 手机上
 * 调大的字号同步到桌面浏览器只会碍事。模块级单例，正文页和设置面板共用一份。
 */

import { computed, ref, watch } from "vue";

const STORAGE_KEY = "funread.reader.settings";

export type ReaderTheme = "paper" | "night" | "sepia";

export interface ReaderSettings {
  fontSize: number;
  lineHeight: number;
  padding: number;
  theme: ReaderTheme;
}

const DEFAULTS: ReaderSettings = {
  fontSize: 18,
  lineHeight: 1.8,
  padding: 20,
  theme: "paper",
};

export const FONT_SIZE_RANGE = [14, 28] as const;
export const LINE_HEIGHT_RANGE = [1.4, 2.4] as const;
export const PADDING_RANGE = [8, 40] as const;

export const THEME_LABEL: Record<ReaderTheme, string> = {
  paper: "纸白",
  night: "夜间",
  sepia: "护眼",
};

/** 正文配色。和 Naive UI 的全局主题分开 —— 读正文时底色该由读者定。 */
export const THEME_COLORS: Record<ReaderTheme, { bg: string; fg: string; muted: string }> = {
  paper: { bg: "#f7f6f3", fg: "#1f2023", muted: "#6b6d73" },
  night: { bg: "#15161a", fg: "#c8cad0", muted: "#7a7d85" },
  sepia: { bg: "#efe3cd", fg: "#4a3a28", muted: "#897259" },
};

function clamp(value: number, [min, max]: readonly [number, number]): number {
  return Math.min(max, Math.max(min, value));
}

function load(): ReaderSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<ReaderSettings>;
    return {
      //  逐字段校验而不是整体信任：这份数据来自 localStorage，可能是旧版本
      //  写的，也可能被手改过。一个 NaN 字号会让正文整页消失。
      fontSize: clamp(Number(parsed.fontSize) || DEFAULTS.fontSize, FONT_SIZE_RANGE),
      lineHeight: clamp(Number(parsed.lineHeight) || DEFAULTS.lineHeight, LINE_HEIGHT_RANGE),
      padding: clamp(Number(parsed.padding) ?? DEFAULTS.padding, PADDING_RANGE),
      theme: parsed.theme && parsed.theme in THEME_COLORS ? parsed.theme : DEFAULTS.theme,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

const settings = ref<ReaderSettings>(load());

watch(
  settings,
  (value) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    } catch {
      //  隐私模式下写不了。设置在本次会话内仍然生效，不该因此报错。
    }
  },
  { deep: true },
);

export function useReaderSettings() {
  const colors = computed(() => THEME_COLORS[settings.value.theme]);

  /** 直接绑到正文容器的 style 上。 */
  const contentStyle = computed(() => ({
    fontSize: `${settings.value.fontSize}px`,
    lineHeight: String(settings.value.lineHeight),
    padding: `0 ${settings.value.padding}px`,
    color: colors.value.fg,
  }));

  function reset() {
    settings.value = { ...DEFAULTS };
  }

  function nudgeFontSize(delta: number) {
    settings.value.fontSize = clamp(settings.value.fontSize + delta, FONT_SIZE_RANGE);
  }

  return { settings, colors, contentStyle, reset, nudgeFontSize };
}
