/**
 * 统一的 Naive UI 主题令牌，随明暗主题响应式切换。
 *
 * 解决两处设计割裂：
 * 1. 深色模式下 Naive UI `darkTheme` 默认给 Primary 按钮配深色文字，若主色仍沿用
 *    浅色版的深墨绿 `#167A69`，按钮会出现黑字压深绿底、对比度严重不足的问题；
 * 2. `<n-global-style />` 会把 `body` 和卡片覆盖成冷灰黑 `#101014`/`#18181c`，
 *    与 `tokens.css`/`web.css` 里的森系暗绿表面色（`#121a18`/`#1b2522`）形成两层皮。
 *    这里把 Naive UI 的画布、卡片、表格、边框全部对齐到同一套色板。
 */
import type { GlobalThemeOverrides } from "naive-ui";
import { computed, type Ref } from "vue";

const FONT_FAMILY =
  "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif";

const LIGHT_OVERRIDES: GlobalThemeOverrides = {
  common: {
    primaryColor: "#167A69",
    primaryColorHover: "#1B927E",
    primaryColorPressed: "#116557",
    primaryColorSuppl: "#167A69",
    bodyColor: "#F5F7F5",
    cardColor: "#FFFFFF",
    modalColor: "#FFFFFF",
    popoverColor: "#FFFFFF",
    tableColor: "#FFFFFF",
    tableHeaderColor: "#F1F5F2",
    tableColorHover: "#F5F9F6",
    tableColorStriped: "#F8FBF9",
    inputColor: "#FFFFFF",
    borderColor: "#DCE5DF",
    dividerColor: "#E3EBE6",
    textColorBase: "#1B2622",
    textColor1: "#1B2622",
    textColor2: "#33433D",
    textColor3: "#60716B",
    borderRadius: "8px",
    borderRadiusSmall: "6px",
    fontFamily: FONT_FAMILY,
  },
  Card: { borderRadius: "10px" },
  Button: {
    borderRadiusMedium: "8px",
    borderRadiusSmall: "6px",
    borderRadiusTiny: "6px",
    textColorPrimary: "#FFFFFF",
    textColorHoverPrimary: "#FFFFFF",
    textColorPressedPrimary: "#FFFFFF",
    textColorFocusPrimary: "#FFFFFF",
  },
  Input: { borderRadius: "8px" },
  DataTable: {
    borderRadius: "10px",
    thFontWeight: "600",
  },
};

const DARK_OVERRIDES: GlobalThemeOverrides = {
  common: {
    //  深色模式使用提亮后的薄荷青绿，保证按钮文字、Switch 激活态与焦点环均具备高对比度
    primaryColor: "#52BFA0",
    primaryColorHover: "#69D0B2",
    primaryColorPressed: "#3FA387",
    primaryColorSuppl: "#52BFA0",
    bodyColor: "#121A18",
    cardColor: "#1B2522",
    modalColor: "#1B2522",
    popoverColor: "#202D29",
    tableColor: "#18221F",
    tableHeaderColor: "#1E2B27",
    tableColorHover: "#22312C",
    tableColorStriped: "#1B2623",
    inputColor: "#151F1C",
    borderColor: "#2F4038",
    dividerColor: "#293831",
    textColorBase: "#E6EFEA",
    textColor1: "#E6EFEA",
    textColor2: "#C7D7CF",
    textColor3: "#94ACA0",
    borderRadius: "8px",
    borderRadiusSmall: "6px",
    fontFamily: FONT_FAMILY,
  },
  Card: { borderRadius: "10px" },
  Button: {
    borderRadiusMedium: "8px",
    borderRadiusSmall: "6px",
    borderRadiusTiny: "6px",
    textColorPrimary: "#0D1E19",
    textColorHoverPrimary: "#0D1E19",
    textColorPressedPrimary: "#0D1E19",
    textColorFocusPrimary: "#0D1E19",
  },
  Switch: {
    railColorActive: "#46B394",
    buttonColor: "#F5FAF8",
  },
  Input: { borderRadius: "8px" },
  DataTable: {
    borderRadius: "10px",
    thFontWeight: "600",
  },
};

export function useNaiveThemeOverrides(dark: Ref<boolean>) {
  return computed<GlobalThemeOverrides>(() => (dark.value ? DARK_OVERRIDES : LIGHT_OVERRIDES));
}
