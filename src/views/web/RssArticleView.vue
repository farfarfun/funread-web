<script setup lang="ts">
/**
 * 文章正文。复用小说那套阅读设置（字号/行距/配色），但内容是 HTML。
 *
 * **正文是富文本，所以要消毒再插。** 后端把源站 HTML 原样带过来，里面可能有
 * `<script>`、`onerror=`、`javascript:` —— 直接 `v-html` 等于把任意源站的脚本
 * 放进我们的同源上下文，而 cookie 是 httpOnly 但 DOM 和已登录会话不是。
 * 这里用浏览器自己的解析器建一棵游离的 DOM 树，白名单过一遍再序列化回去。
 */
import { OpenOutline, SettingsOutline, StarOutline, Star } from "@vicons/ionicons5";
import { useMessage } from "naive-ui";
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";

import { api } from "../../api/client";
import type { RssArticleDetail } from "../../api/types";
import ReaderSettingsSheet from "../../components/web/ReaderSettingsSheet.vue";
import TopBar from "../../components/web/TopBar.vue";
import { useReaderSettings } from "../../composables/useReaderSettings";
import { useShortcuts } from "../../composables/useShortcuts";

/** 允许留在正文里的标签。其余一律拆掉但保留内部文字。 */
const ALLOWED_TAGS = new Set([
  "P", "BR", "HR", "DIV", "SPAN", "SECTION", "ARTICLE",
  "H1", "H2", "H3", "H4", "H5", "H6",
  "STRONG", "B", "EM", "I", "U", "S", "SUB", "SUP", "SMALL", "MARK",
  "UL", "OL", "LI", "DL", "DT", "DD",
  "BLOCKQUOTE", "PRE", "CODE", "FIGURE", "FIGCAPTION",
  "TABLE", "THEAD", "TBODY", "TFOOT", "TR", "TD", "TH", "CAPTION",
  "A", "IMG",
]);

/** 每个标签允许保留的属性。没列出的属性全部删掉。 */
const ALLOWED_ATTRS: Record<string, Set<string>> = {
  A: new Set(["href", "title"]),
  IMG: new Set(["src", "alt", "title", "width", "height"]),
  TD: new Set(["colspan", "rowspan"]),
  TH: new Set(["colspan", "rowspan"]),
};

/** 整棵子树都要丢掉的标签 —— 连里面的文字一起。 */
const DROP_SUBTREE = new Set(["SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED", "NOSCRIPT", "TEMPLATE", "SVG", "MATH"]);

function safeUrl(value: string): string {
  const trimmed = (value || "").trim();
  //  只放 http/https 和协议相对；javascript:、data: 一律拦掉。
  //  data: 看着无害，但 data:text/html 可以执行脚本。
  if (/^(https?:)?\/\//i.test(trimmed)) return trimmed;
  if (/^https?:/i.test(trimmed)) return trimmed;
  return "";
}

function sanitize(html: string): string {
  //  用 <template> 的 content 建游离片段：它不会触发资源加载，
  //  所以 <img src=x onerror=...> 在这一步不会执行。
  const holder = document.createElement("template");
  holder.innerHTML = html || "";
  const fragment = holder.content;

  const walk = (node: Node) => {
    //  先快照子节点：下面会改动 childNodes
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === Node.COMMENT_NODE) {
        child.remove();
        continue;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) continue;
      const element = child as Element;
      const tag = element.tagName.toUpperCase();

      if (DROP_SUBTREE.has(tag)) {
        element.remove();
        continue;
      }

      if (!ALLOWED_TAGS.has(tag)) {
        //  标签不认，但里面的文字要留 —— 直接删会把正文整段吃掉
        walk(element);
        element.replaceWith(...Array.from(element.childNodes));
        continue;
      }

      const allowed = ALLOWED_ATTRS[tag] ?? new Set<string>();
      for (const attribute of Array.from(element.attributes)) {
        const name = attribute.name.toLowerCase();
        if (!allowed.has(name)) {
          element.removeAttribute(attribute.name);
          continue;
        }
        if (name === "href" || name === "src") {
          const url = safeUrl(attribute.value);
          if (url) element.setAttribute(name, url);
          else element.removeAttribute(attribute.name);
        }
      }
      if (tag === "A") {
        element.setAttribute("target", "_blank");
        element.setAttribute("rel", "noopener noreferrer nofollow");
      }
      if (tag === "IMG") {
        element.setAttribute("loading", "lazy");
        element.setAttribute("referrerpolicy", "no-referrer");
      }
      walk(element);
    }
  };

  walk(fragment);
  const output = document.createElement("div");
  output.append(fragment);
  return output.innerHTML;
}

const route = useRoute();
const router = useRouter();
const message = useMessage();
const { colors, contentStyle } = useReaderSettings();

const subId = computed(() => String(route.params.subId));
const link = computed(() => String(route.query.link || ""));

/** 列表页带过来的 variables。解不动就当空 —— 坏的 query 不该让整页打不开。 */
const variables = computed<Record<string, string>>(() => {
  const raw = String(route.query.variables || "");
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
});

const article = ref<RssArticleDetail | null>(null);
const loading = ref(true);
const error = ref("");
const favorited = ref(false);
const showSettings = ref(false);

const safeHtml = computed(() => sanitize(article.value?.content_html || ""));

async function load() {
  loading.value = true;
  error.value = "";
  try {
    article.value = await api.rssArticle({
      sub_id: subId.value,
      link: link.value,
      title: String(route.query.title || ""),
      variables: variables.value,
    });
    //  打开即已读。这是订阅阅读的常规语义，不必再点一下。
    void api
      .markRead(subId.value, article.value.article_key, true, {
        title: article.value.title,
        link: article.value.link,
        pub_date: article.value.pub_date,
        image: article.value.image,
      })
      .catch(() => undefined);
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : "正文加载失败";
  } finally {
    loading.value = false;
  }
}

async function toggleFavorite() {
  if (!article.value) return;
  const next = !favorited.value;
  favorited.value = next;
  try {
    await api.markFavorite(subId.value, article.value.article_key, next, {
      title: article.value.title,
      link: article.value.link,
      pub_date: article.value.pub_date,
      image: article.value.image,
    });
  } catch (reason) {
    favorited.value = !next;
    message.error(reason instanceof Error ? reason.message : "操作失败");
  }
}

useShortcuts({
  s: () => (showSettings.value = !showSettings.value),
  f: () => void toggleFavorite(),
  Escape: () => {
    if (showSettings.value) {
      showSettings.value = false;
      return;
    }
    router.push({ name: "rss-feed", params: { subId: subId.value } });
  },
});

onMounted(load);
</script>

<template>
  <div class="article" :style="{ background: colors.bg }">
    <TopBar :title="article?.title || '文章'" back :fallback="`/web/rss/${subId}`">
      <template #actions>
        <n-button
          quaternary
          circle
          :aria-label="favorited ? '取消收藏' : '收藏'"
          @click="toggleFavorite"
        >
          <template #icon>
            <n-icon><Star v-if="favorited" /><StarOutline v-else /></n-icon>
          </template>
        </n-button>
        <n-button quaternary circle aria-label="阅读设置" @click="showSettings = true">
          <template #icon><n-icon><SettingsOutline /></n-icon></template>
        </n-button>
        <n-button
          v-if="article"
          quaternary
          circle
          aria-label="在浏览器里打开"
          tag="a"
          :href="article.link"
          target="_blank"
          rel="noopener noreferrer"
        >
          <template #icon><n-icon><OpenOutline /></n-icon></template>
        </n-button>
      </template>
    </TopBar>

    <div v-if="loading" class="article__center">
      <n-spin size="large" />
    </div>

    <n-result
      v-else-if="error"
      status="warning"
      title="读不到这篇文章"
      :description="error"
      class="article__center"
    >
      <template #footer>
        <n-button size="small" @click="load">重试</n-button>
        <n-button
          v-if="link"
          size="small"
          tag="a"
          :href="link"
          target="_blank"
          rel="noopener noreferrer"
        >
          在浏览器里打开
        </n-button>
        <n-button size="small" text @click="router.push({ name: 'rss-feed', params: { subId } })">
          回列表
        </n-button>
      </template>
    </n-result>

    <article v-else-if="article" class="article__body" :style="contentStyle">
      <h2 class="article__title">{{ article.title }}</h2>
      <p v-if="article.pub_date" class="article__date" :style="{ color: colors.muted }">
        {{ article.pub_date }}
      </p>
      <!-- eslint-disable-next-line vue/no-v-html -- 已经过 sanitize() 白名单过滤 -->
      <div class="article__html" v-html="safeHtml" />
      <p v-if="!safeHtml.trim()" class="article__empty" :style="{ color: colors.muted }">
        这篇文章没有可显示的正文。
        <a :href="article.link" target="_blank" rel="noopener noreferrer">在浏览器里打开</a>
      </p>
    </article>

    <ReaderSettingsSheet v-model:show="showSettings" />
  </div>
</template>

<style scoped>
.article {
  min-height: 100dvh;
}

.article__center {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: var(--space-6) var(--space-4);
}

.article__body {
  max-width: 44em;
  margin: 0 auto;
  padding-top: var(--space-4);
  padding-bottom: calc(env(safe-area-inset-bottom, 0px) + var(--space-6));
}

.article__title {
  margin: 0 0 var(--space-2);
  font-size: 1.3em;
  font-weight: 600;
  line-height: 1.4;
}

.article__date {
  margin: 0 0 var(--space-4);
  font-size: 0.75em;
}

.article__empty {
  font-size: 0.85em;
}

/* 源站 HTML 的收口：图片不许撑破视口，表格可横滚 */
.article__html :deep(img) {
  max-width: 100%;
  height: auto;
  border-radius: 6px;
}

.article__html :deep(p) {
  margin: 0 0 1em;
}

.article__html :deep(a) {
  color: var(--accent);
}

.article__html :deep(pre) {
  padding: var(--space-3);
  overflow-x: auto;
  font-size: 0.85em;
  background: rgba(127, 127, 127, 0.12);
  border-radius: 6px;
}

.article__html :deep(blockquote) {
  margin: 0 0 1em;
  padding-left: var(--space-3);
  border-left: 3px solid var(--accent);
}

.article__html :deep(table) {
  display: block;
  overflow-x: auto;
  border-collapse: collapse;
}

.article__html :deep(td),
.article__html :deep(th) {
  padding: 4px 8px;
  border: 1px solid var(--border-subtle);
}
</style>
