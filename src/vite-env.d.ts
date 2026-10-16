/// <reference types="vite/client" />

/**
 * 当前这份构建是不是**打包版**（Web 资源打进 Android app、跨站、用设备 token）。
 *
 * 由 `vite.config.ts` 的 define 注入成字面量：`vite build --mode packaged` 下是
 * `true`，其余一律 `false`。它不是运行时变量 —— `if (__FUNREAD_PACKAGED__)` 的
 * false 分支在构建期就被删干净了，这正是浏览器和 funread light 的行为分毫不变的
 * 依据。缘由写在 `src/api/packaged.ts` 顶部。
 */
declare const __FUNREAD_PACKAGED__: boolean;
