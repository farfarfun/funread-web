/**
 * 主导航的四个目标。`TabBar`（窄屏底栏）与 `SideRail`（宽屏侧栏）共用这一份 ——
 * 两处各写一份迟早会漂移（加了一个 tab 只改了一边）。
 */

import {
  CompassOutline,
  LibraryOutline,
  NewspaperOutline,
  PersonOutline,
} from "@vicons/ionicons5";
import type { Component } from "vue";
import type { RouteLocationRaw } from "vue-router";

export interface NavTab {
  /** 和路由 `meta.tab` 对应。详情页没有 tab，这时四个都不高亮。 */
  key: string;
  label: string;
  to: RouteLocationRaw;
  icon: Component;
}

export const TABS: NavTab[] = [
  { key: "shelf", label: "书架", to: { name: "shelf" }, icon: LibraryOutline },
  { key: "discover", label: "发现", to: { name: "explore" }, icon: CompassOutline },
  { key: "rss", label: "订阅", to: { name: "rss" }, icon: NewspaperOutline },
  { key: "account", label: "我的", to: { name: "account" }, icon: PersonOutline },
];
