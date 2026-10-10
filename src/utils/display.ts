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

/**
 * feed 里的时间。和 `formatTime` 不是一回事：这里的值来自源站，RSS 给的是
 * RFC-822（`Sat, 10 Oct 2026 00:37:07 +0000`）、Atom 给 ISO-8601，还有一大票
 * 自造格式。**不能直接丢给 `fromNow`** —— 解析失败时 `RelativeTimeFormat`
 * 会拿 NaN 抛 RangeError，整张列表跟着白掉。
 *
 * 解析不出来就原样回显：一串看不懂的时间，总好过一条报错或者一片空白。
 */
export function formatFeedDate(value: string | null): string {
  const raw = (value || "").trim();
  if (!raw) return "";
  const time = new Date(raw).getTime();
  if (Number.isNaN(time)) return raw;
  //  一周内用相对时间（手机上一行就一个短词），再往前用日期。
  //  原始的 RFC-822 串有 29 个字符，在 320px 宽的卡片上要吃掉整行。
  if (Math.abs(Date.now() - time) < 7 * 86_400_000) return fromNow(raw);
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "short" }).format(time);
}

/**
 * 取 HTML 里的纯文字，用来做列表里的摘要。
 *
 * feed 的 `description` 常常是一段 HTML（Hacker News 给的就是
 * `<a href="...">Comments</a>`）。直接 `{{ }}` 插出来，用户看到的是一行
 * `<a href="https://...` 的尖括号。这里不走 `v-html`（那要整套白名单消毒，
 * 见 RssArticleView），只要文字。
 *
 * 用 `<template>` 的 content 解析：游离片段不会触发资源加载，也不会执行脚本，
 * 顺带把 `&amp;` 这类实体解开 —— 手写正则两件事都做不到。
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
