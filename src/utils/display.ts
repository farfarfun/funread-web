import type { SourceType } from "../api/types";

export const SOURCE_TYPE_LABEL: Record<SourceType, string> = {
  book: "书源",
  rss: "RSS 源",
};

//  模块级复用 Intl 格式化器，避免列表/表格每次渲染都重新构造 locale 对象
const DATE_TIME_FMT = new Intl.DateTimeFormat("zh-CN", {
  dateStyle: "medium",
  timeStyle: "short",
});
const SHORT_DATE_FMT = new Intl.DateTimeFormat("zh-CN", { dateStyle: "short" });
const RELATIVE_FMT = new Intl.RelativeTimeFormat("zh-CN", { numeric: "auto" });

/** 仅允许安全的 http(s) 外部链接，拦截 `javascript:` / `data:` 等危险协议。 */
export function safeExternalUrl(raw: string | null | undefined): string {
  const value = (raw || "").trim();
  if (!value) return "";
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.href : "";
  } catch {
    return "";
  }
}

/** 仅允许站内相对跳转路径，拦截 `//evil.com` 或外链开放重定向。 */
export function safeInternalNext(raw: unknown, fallback = "/web"): string {
  const text = String(raw || "").trim();
  return text.startsWith("/") && !text.startsWith("//") ? text : fallback;
}

export function formatTime(value: string | null): string {
  if (!value) return "从未";
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return value;
  return DATE_TIME_FMT.format(time);
}

/**
 * feed 里的时间。解析失败时原样回显，不让非法时间字符串把整张列表炸白。
 */
export function formatFeedDate(value: string | null): string {
  const raw = (value || "").trim();
  if (!raw) return "";
  const time = new Date(raw).getTime();
  if (Number.isNaN(time)) return raw;
  //  一周内用相对时间（手机上一行就一个短词），再往前用日期。
  if (Math.abs(Date.now() - time) < 7 * 86_400_000) return fromNow(raw);
  return SHORT_DATE_FMT.format(time);
}

/**
 * 取 HTML 里的纯文字，用来做列表里的摘要。
 */
export function plainText(html: string | null): string {
  const raw = (html || "").trim();
  if (!raw) return "";
  const holder = document.createElement("template");
  holder.innerHTML = raw;
  return (holder.content.textContent || "").replace(/\s+/g, " ").trim();
}

export function fromNow(value: string | null): string {
  if (!value) return "从未";
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return value;
  const seconds = Math.round((time - Date.now()) / 1000);
  const ranges: [number, Intl.RelativeTimeFormatUnit][] = [
    [86_400, "day"],
    [3_600, "hour"],
    [60, "minute"],
  ];
  for (const [size, unit] of ranges) {
    if (Math.abs(seconds) >= size) return RELATIVE_FMT.format(Math.round(seconds / size), unit);
  }
  return RELATIVE_FMT.format(seconds, "second");
}
