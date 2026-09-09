import type { SourceType } from "../api/types";

export const SOURCE_TYPE_LABEL: Record<SourceType, string> = {
  book: "书源",
  rss: "RSS 源",
};

export function formatTime(value: string | null): string {
  if (!value) return "从未";
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function fromNow(value: string | null): string {
  if (!value) return "从未";
  const seconds = Math.round((new Date(value).getTime() - Date.now()) / 1000);
  const ranges: [number, Intl.RelativeTimeFormatUnit][] = [
    [86_400, "day"],
    [3_600, "hour"],
    [60, "minute"],
  ];
  const formatter = new Intl.RelativeTimeFormat("zh-CN", { numeric: "auto" });
  for (const [size, unit] of ranges) {
    if (Math.abs(seconds) >= size) return formatter.format(Math.round(seconds / size), unit);
  }
  return formatter.format(seconds, "second");
}
