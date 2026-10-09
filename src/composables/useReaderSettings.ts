/**
 * 阅读设置：排版、配色、自动翻页、朗读。
 *
 * 存 `localStorage` 而不落库，是因为这是**设备**偏好而不是账号偏好 —— 手机上
 * 调大的字号同步到桌面浏览器只会碍事。模块级单例，正文页和设置面板共用一份。
 *
 * 字段清单对照 Legado 的 `dialog_read_book_style.xml`（字号/行距/段距/字间距/
 * 页边距/字体/首行缩进/繁简/字重/翻页动画）。没做的几项各有理由，写在下面。
 */

import { computed, ref, watch } from "vue";

const STORAGE_KEY = "funread.reader.settings";

export type ReaderTheme = "paper" | "night" | "sepia" | "green";

/** 正文字体。只给系统字体栈 —— 下载字体要几 MB，而中文字体更大。 */
export type ReaderFont = "system" | "serif" | "sans" | "kai";

export interface ReaderSettings {
  fontSize: number;
  lineHeight: number;
  /** 段间距，单位 em（跟着字号走）。 */
  paragraphSpacing: number;
  /** 字间距，单位 em。中文正文里一点点字间距能明显改善密度感。 */
  letterSpacing: number;
  padding: number;
  /** 首行缩进几个字。Legado 给的是 0-4，中文默认 2。 */
  indent: number;
  font: ReaderFont;
  /** 字重。部分系统字体在 300 下更清淡，长时间读更舒服。 */
  fontWeight: number;
  theme: ReaderTheme;
  /** 自动翻页（滚动）速度，像素/秒。0 = 关。 */
  autoScrollSpeed: number;
}

const DEFAULTS: ReaderSettings = {
  fontSize: 18,
  lineHeight: 1.8,
  paragraphSpacing: 0.8,
  letterSpacing: 0,
  padding: 20,
  indent: 2,
  font: "system",
  fontWeight: 400,
  theme: "paper",
  autoScrollSpeed: 0,
};

export const FONT_SIZE_RANGE = [14, 32] as const;
export const LINE_HEIGHT_RANGE = [1.3, 2.6] as const;
export const PARAGRAPH_SPACING_RANGE = [0, 2.4] as const;
export const LETTER_SPACING_RANGE = [0, 0.3] as const;
export const PADDING_RANGE = [8, 64] as const;
export const INDENT_RANGE = [0, 4] as const;
export const AUTO_SCROLL_RANGE = [10, 160] as const;

export const THEME_LABEL: Record<ReaderTheme, string> = {
  paper: "纸白",
  night: "夜间",
  sepia: "护眼",
  green: "豆绿",
};

/** 正文配色。和 Naive UI 的全局主题分开 —— 读正文时底色该由读者定。 */
export const THEME_COLORS: Record<ReaderTheme, { bg: string; fg: string; muted: string }> = {
  paper: { bg: "#f7f6f3", fg: "#1f2023", muted: "#6b6d73" },
  night: { bg: "#15161a", fg: "#c8cad0", muted: "#7a7d85" },
  sepia: { bg: "#efe3cd", fg: "#4a3a28", muted: "#897259" },
  green: { bg: "#cce8cf", fg: "#2b3a2d", muted: "#5d6f5f" },
};

export const FONT_LABEL: Record<ReaderFont, string> = {
  system: "系统",
  serif: "宋体",
  sans: "黑体",
  kai: "楷体",
};

/**
 * 字体栈。每条都列多个候选 —— 中文字体名在 Windows / macOS / Linux / Android
 * 上完全不同，只写一个会在别的系统上静默回退到默认字体。
 */
export const FONT_STACK: Record<ReaderFont, string> = {
  system:
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif",
  serif:
    "'Songti SC', 'Noto Serif CJK SC', 'Source Han Serif SC', SimSun, 'STSong', Georgia, serif",
  sans: "'PingFang SC', 'Noto Sans CJK SC', 'Source Han Sans SC', 'Microsoft YaHei', SimHei, sans-serif",
  kai: "'Kaiti SC', KaiTi, STKaiti, 'TW-Kai', serif",
};

function clamp(value: number, [min, max]: readonly [number, number]): number {
  return Math.min(max, Math.max(min, value));
}

function num(value: unknown, fallback: number, range: readonly [number, number]): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? clamp(parsed, range) : fallback;
}

function load(): ReaderSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<ReaderSettings>;
    //  逐字段校验而不是整体信任：这份数据来自 localStorage，可能是旧版本写的
    //  （少字段），也可能被手改过。一个 NaN 字号会让正文整页消失。
    return {
      fontSize: num(parsed.fontSize, DEFAULTS.fontSize, FONT_SIZE_RANGE),
      lineHeight: num(parsed.lineHeight, DEFAULTS.lineHeight, LINE_HEIGHT_RANGE),
      paragraphSpacing: num(
        parsed.paragraphSpacing,
        DEFAULTS.paragraphSpacing,
        PARAGRAPH_SPACING_RANGE,
      ),
      letterSpacing: num(parsed.letterSpacing, DEFAULTS.letterSpacing, LETTER_SPACING_RANGE),
      padding: num(parsed.padding, DEFAULTS.padding, PADDING_RANGE),
      indent: Math.round(num(parsed.indent, DEFAULTS.indent, INDENT_RANGE)),
      font: parsed.font && parsed.font in FONT_STACK ? parsed.font : DEFAULTS.font,
      fontWeight: [300, 400, 500, 600].includes(Number(parsed.fontWeight))
        ? Number(parsed.fontWeight)
        : DEFAULTS.fontWeight,
      theme: parsed.theme && parsed.theme in THEME_COLORS ? parsed.theme : DEFAULTS.theme,
      //  自动翻页**不恢复**：上次关页面时还在滚，下次打开不该自己动起来。
      autoScrollSpeed: 0,
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
    letterSpacing: `${settings.value.letterSpacing}em`,
    fontFamily: FONT_STACK[settings.value.font],
    fontWeight: String(settings.value.fontWeight),
    padding: `0 ${settings.value.padding}px`,
    color: colors.value.fg,
  }));

  /** 绑到每个段落上 —— 段距与缩进是段级属性，不能放在容器上。 */
  const paragraphStyle = computed(() => ({
    marginBottom: `${settings.value.paragraphSpacing}em`,
    textIndent: `${settings.value.indent}em`,
  }));

  function reset() {
    settings.value = { ...DEFAULTS };
  }

  function nudgeFontSize(delta: number) {
    settings.value.fontSize = clamp(settings.value.fontSize + delta, FONT_SIZE_RANGE);
  }

  return { settings, colors, contentStyle, paragraphStyle, reset, nudgeFontSize };
}
