<script setup lang="ts">
/**
 * 正文页的菜单层。结构对齐 CCSSNE/legado 的 `view_read_menu.xml`：
 *
 * ```
 * 顶栏  [←] 当前章节名 · 书源（可点 → 换源）
 * 底部  亮度滑块
 *       [上一章] ——— 全书进度滑块（松手提交，防高频发包） ——— [下一章]
 *       目录 | 朗读 | 界面 | 设置
 * ```
 */
import {
  ChevronBackOutline,
  ColorPaletteOutline,
  ListOutline,
  PauseOutline,
  SettingsOutline,
  SunnyOutline,
  VolumeHighOutline,
} from "@vicons/ionicons5";
import { ref, watch } from "vue";

const show = defineModel<boolean>("show", { required: true });
/** 20-100。100 = 不压暗。 */
const brightness = defineModel<number>("brightness", { required: true });

const props = defineProps<{
  chapterName: string;
  sourceName: string;
  index: number;
  total: number;
  hasPrev: boolean;
  hasNext: boolean;
  speechSupported: boolean;
  speaking: boolean;
}>();

const emit = defineEmits<{
  back: [];
  prev: [];
  next: [];
  jump: [index: number];
  toc: [];
  speech: [];
  style: [];
  settings: [];
  switchSource: [];
}>();

/** 拖动滑块时只改本地预览值，松手后再真正发起切章请求，避免拖动触发几十次拉章。 */
const draftPosition = ref(props.index + 1);
let commitTimer: number | undefined;

watch(
  () => props.index,
  (val) => {
    draftPosition.value = val + 1;
  },
);

function onSliderUpdate(value: number) {
  draftPosition.value = Math.round(value);
  if (commitTimer !== undefined) window.clearTimeout(commitTimer);
  //  点击轨道（非拖动）不会触发 dragend，用短防抖兜底；拖动过程中持续重置不会早发。
  commitTimer = window.setTimeout(() => {
    commitTimer = undefined;
    commitPosition();
  }, 240);
}

function commitPosition() {
  if (commitTimer !== undefined) {
    window.clearTimeout(commitTimer);
    commitTimer = undefined;
  }
  const target = Math.max(0, Math.round(draftPosition.value) - 1);
  if (target !== props.index) emit("jump", target);
}
</script>

<template>
  <!-- 亮度遮罩。always-on（不随菜单显隐），所以放在菜单组件里但不受 show 控制。 -->
  <div
    v-if="brightness < 100"
    class="dimmer"
    :style="{ opacity: String(((100 - brightness) / 100) * 0.75) }"
    aria-hidden="true"
  />

  <Transition name="fade">
    <div v-if="show" class="top" @click.stop>
      <button type="button" class="top__back" aria-label="返回" title="返回" @click="emit('back')">
        <n-icon size="22"><ChevronBackOutline /></n-icon>
      </button>
      <div class="top__body">
        <p class="top__chapter">{{ chapterName || "—" }}</p>
        <div class="top__meta">
          <span class="top__position">{{ index + 1 }} / {{ total }}</span>
          <button type="button" class="top__source" @click="emit('switchSource')">
            {{ sourceName || "未知来源" }} · 换源
          </button>
        </div>
      </div>
    </div>
  </Transition>

  <Transition name="slide-up">
    <div v-if="show" class="menu" @click.stop>
      <div class="menu__brightness">
        <n-icon size="16"><SunnyOutline /></n-icon>
        <n-slider v-model:value="brightness" :min="20" :max="100" :step="5" />
        <span class="menu__hint">只能压暗（Web 无法调亮屏幕）</span>
      </div>

      <!-- 第一行：上一章 — 全书进度 — 下一章 -->
      <div class="menu__progress">
        <n-button quaternary size="small" :disabled="!hasPrev" @click="emit('prev')">
          上一章
        </n-button>
        <n-slider
          :value="draftPosition"
          :min="1"
          :max="Math.max(1, total)"
          :step="1"
          :tooltip="true"
          :format-tooltip="(value: number) => `第 ${value} 章`"
          class="menu__slider"
          @update:value="onSliderUpdate"
          @dragend="commitPosition"
        />
        <n-button quaternary size="small" :disabled="!hasNext" @click="emit('next')">
          下一章
        </n-button>
      </div>

      <!-- 第二行：四个带文字的按钮 -->
      <div class="menu__actions">
        <button type="button" class="action" @click="emit('toc')">
          <n-icon size="21"><ListOutline /></n-icon>
          <span>目录</span>
        </button>
        <button
          type="button"
          class="action"
          :class="{ 'action--on': speaking }"
          :disabled="!speechSupported"
          @click="emit('speech')"
        >
          <n-icon size="21">
            <PauseOutline v-if="speaking" />
            <VolumeHighOutline v-else />
          </n-icon>
          <span>{{ speaking ? "停止" : "朗读" }}</span>
        </button>
        <button type="button" class="action" @click="emit('style')">
          <n-icon size="21"><ColorPaletteOutline /></n-icon>
          <span>界面</span>
        </button>
        <button type="button" class="action" @click="emit('settings')">
          <n-icon size="21"><SettingsOutline /></n-icon>
          <span>设置</span>
        </button>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.dimmer {
  position: fixed;
  inset: 0;
  z-index: 25;
  background: #000;
  /* 遮罩不能吃掉点击 —— 否则整个正文页点不动 */
  pointer-events: none;
}

.top {
  position: fixed;
  inset-inline: 0;
  top: 0;
  z-index: 30;
  display: flex;
  gap: var(--space-2);
  align-items: center;
  padding: calc(env(safe-area-inset-top, 0px) + var(--space-2)) var(--space-4) var(--space-2);
  /* 半透明底色配合 blur 才能呈现真实毛玻璃质感 */
  background: color-mix(in srgb, var(--surface-raised) 86%, transparent);
  border-bottom: 1px solid var(--border-subtle);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
}

.top__back {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  margin-left: -8px;
  padding: 0;
  color: inherit;
  background: none;
  border: none;
  border-radius: 50%;
  cursor: pointer;
}

.top__back:active {
  background: var(--surface-sunken);
}

.top__body {
  min-width: 0;
  flex: 1;
}

.top__chapter {
  margin: 0 0 2px;
  overflow: hidden;
  font-size: 15px;
  font-weight: 600;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.top__meta {
  display: flex;
  gap: var(--space-3);
  align-items: center;
  font-size: 12px;
  color: var(--text-muted);
}

.top__source {
  padding: 0;
  font-size: 12px;
  color: var(--accent);
  background: none;
  border: none;
  cursor: pointer;
}

.menu {
  position: fixed;
  inset-inline: 0;
  bottom: 0;
  z-index: 30;
  padding: var(--space-3) var(--space-3) calc(var(--space-2) + env(safe-area-inset-bottom, 0px));
  background: color-mix(in srgb, var(--surface-raised) 88%, transparent);
  border-top: 1px solid var(--border-subtle);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
}

.menu__brightness {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: var(--space-2) var(--space-3);
  align-items: center;
  padding-bottom: var(--space-2);
}

.menu__hint {
  grid-column: 2;
  font-size: 10px;
  color: var(--text-muted);
}

.menu__progress {
  display: flex;
  gap: var(--space-2);
  align-items: center;
  padding: var(--space-2) 0;
  border-top: 1px solid var(--border-subtle);
}

.menu__slider {
  flex: 1;
}

.menu__actions {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  padding-top: var(--space-2);
  border-top: 1px solid var(--border-subtle);
}

.action {
  display: flex;
  flex-direction: column;
  gap: 3px;
  align-items: center;
  justify-content: center;
  /* 44px 下限：这四个按钮挨得很近 */
  min-height: 52px;
  padding: 0;
  font-size: 11px;
  color: var(--text-muted);
  background: none;
  border: none;
  cursor: pointer;
}

.action--on {
  color: var(--accent);
}

.action:disabled {
  opacity: 0.35;
  cursor: default;
}

.slide-up-enter-active,
.slide-up-leave-active {
  transition: transform 0.2s var(--ease);
}

.slide-up-enter-from,
.slide-up-leave-to {
  transform: translateY(100%);
}

.fade-enter-active,
.fade-leave-active {
  transition: transform 0.2s var(--ease);
}

.fade-enter-from,
.fade-leave-to {
  transform: translateY(-100%);
}
</style>
