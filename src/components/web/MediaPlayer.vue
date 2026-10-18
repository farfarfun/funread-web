<script setup lang="ts">
/**
 * 订阅文章的音频 / 视频附件。播客 feed 的音频一直在 enclosure 里，后端现在把它
 * 作为 `media_url` 带出来，这里只是给它一个原生播放器。
 *
 * 不引第三方播放器：原生 <audio>/<video> 在手机上就是系统控件，锁屏也能控。
 * 地址只放 http(s) —— 和正文 sanitize() 同一条规矩，data: 一并拦掉。
 */
import { computed } from "vue";

const props = defineProps<{ url: string; type: string; poster?: string }>();

const safeUrl = computed(() => {
  const trimmed = (props.url || "").trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : "";
});

/** MIME 大类缺失时按后缀猜；猜不出按音频，播客里无类型的 enclosure 多是 mp3。 */
const kind = computed<"audio" | "video">(() => {
  const mime = (props.type || "").toLowerCase();
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  return /\.(mp4|m4v|webm|mov|mkv)(\?|$)/i.test(safeUrl.value) ? "video" : "audio";
});
</script>

<template>
  <figure v-if="safeUrl" class="media" :class="`media--${kind}`">
    <video
      v-if="kind === 'video'"
      class="media__video"
      :src="safeUrl"
      :poster="props.poster || undefined"
      controls
      preload="metadata"
      playsinline
    />
    <audio v-else class="media__audio" :src="safeUrl" controls preload="metadata" />
    <figcaption class="media__caption">
      <a :href="safeUrl" target="_blank" rel="noopener noreferrer nofollow">
        {{ kind === "video" ? "在新标签打开视频" : "在新标签打开音频" }}
      </a>
    </figcaption>
  </figure>
</template>

<style scoped>
.media {
  margin: 0 0 var(--space-4);
}

.media__video {
  width: 100%;
  max-height: 60dvh;
  background: #000;
  border-radius: 6px;
}

.media__audio {
  width: 100%;
}

.media__caption {
  margin-top: var(--space-1);
  font-size: 0.75em;
}

.media__caption a {
  color: var(--accent);
}
</style>
