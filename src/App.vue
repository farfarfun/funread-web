<script setup lang="ts">
/**
 * 应用根。只是一个路由宿主 —— Naive UI 的 provider 和主题下沉到两个 layout 里，
 * 因为 /admin 与 /web 要分别懒加载分包：手机端打开 /web 不该下载后台那张
 * 800 行的数据表格。
 */
</script>

<template>
  <RouterView />
</template>
