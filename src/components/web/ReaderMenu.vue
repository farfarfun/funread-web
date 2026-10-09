<script setup lang="ts">
/**
 * 正文页的菜单层。结构对齐 CCSSNE/legado 的 `view_read_menu.xml`：
 *
 * ```
 * 顶栏  当前章节名 · 书源（可点 → 换源）
 * 侧边  亮度滑块
 * 底部  [上一章] ——— 全书进度滑块 ——— [下一章]
 *       目录 | 朗读 | 界面 | 设置      ← 带文字，不是纯图标
 * ```
 *
 * 和原来那一行五个纯图标按钮比，三处是实质改进：
 *
 * - **全书进度滑块。** 上千章的书里跳转，拖滑块比翻目录快得多 —— 这是原版这一屏
 *   最实用的一项。
 * - **按钮带文字。** 纯图标要靠猜，而「界面」和「设置」这两个图标很难区分。
 * - **顶栏显示当前源。** 读到一半发现内容不对时，第一个要看的就是「我在读哪个
 *   源」，而那之前要翻两层才知道。
 *
 * 亮度是**遮罩模拟**：Web 没有屏幕亮度 API。只能压暗，不能调亮 —— 所以滑块的
 * 100% 是「不压暗」，而不是「最亮」。这个限制在界面上说明了，不然用户会以为坏了。
 */
import {
  ChevronBackOutline,
  ChevronForwardOutline,
  ColorPaletteOutline,
  ListOutline,
  PauseOutline,
  SettingsOutline,
  SunnyOutline,
  VolumeHighOutline,
} from "@vicons/ionicons5";
import { computed } from "vue";

const show = defineModel<boolean>("show", { required: true });
/** 0-100。100 = 不压暗。见上面关于「只能压暗」的说明。 */
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
  prev: [];
  next: [];
  jump: [index: number];
  toc: [];
  speech: [];
  style: [];
  settings: [];
  switchSource: [];
}>();

/** 滑块用 1-based —— 用户看到的「第 N 章」和它一致，省掉一次心算。 */
const position = computed({
  get: () => props.index + 1,
  set: (value) => emit("jump", Math.round(value) - 1),
});
</script>

<template>
  <!-- 亮度遮罩。always-on（不随菜单显隐），所以放在菜单组件里但不受 show 控制。 -->
  <div
    v-if="brightness < 100"
    class="dimmer"
    :style="{ opacity: String((100 - brightness) / 100 * 0.75) }"
    aria-hidden="true"
  />

  <Transition name="fade">
    <div v-if="show" class="top" @click.stop>
      <p class="top__chapter">{{ chapterName || "—" }}</p>
      <div class="top__meta">
        <span class="top__position">{{ index + 1 }} / {{ total }}</span>
        <button type="button" class="top__source" @click="emit('switchSource')">
          {{ sourceName || "未知来源" }} · 换源
        </button>
      </div>
    </div>
  </Transition>

  <Transition name="slide-up">
    <div v-if="show" class="menu" @click.stop>
      <!-- 亮度：原版是侧边竖滑块，这里放进菜单里 —— 竖滑块在 Web 上没有原生
           控件，自己做一个纵向拖拽的收益不抵成本 -->
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
          v-model:value="position"
          :min="1"
          :max="Math.max(1, total)"
          :step="1"
          :tooltip="true"
          :format-tooltip="(value: number) => `第 ${value} 章`"
          class="menu__slider"
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
  padding: calc(env(safe-area-inset-top, 0px) + var(--space-3)) var(--space-4) var(--space-3);
  background: var(--surface-raised);
  border-bottom: 1px solid var(--border-subtle);
  backdrop-filter: blur(12px);
}

.top__chapter {
  margin: 0 0 4px;
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
  background: var(--surface-raised);
  border-top: 1px solid var(--border-subtle);
  backdrop-filter: blur(12px);
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
