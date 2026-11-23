import type { SwitchSourceResult } from "../api/types";

/** 换源结果的中文说明。详情页与正文页共用，避免两处文案漂移。 */
export function describeSwitch(result: SwitchSourceResult, sourceName: string): string {
  const where = sourceName ? `「${sourceName}」` : "新源";
  const position = `第 ${result.chapter_index + 1} / ${result.total} 章`;
  switch (result.method) {
    case "exact":
      return `已切换到${where}，定位到${position}`;
    case "normalized":
      return `已切换到${where}，按章节名定位到${position}`;
    case "position":
      return `已切换到${where}，按位置估到${position}，可能有偏差`;
    case "none":
      return `已切换到${where}，但没取到目录，请手动选章`;
    default:
      return `已切换到${where}`;
  }
}
