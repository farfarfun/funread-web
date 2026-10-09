<script setup lang="ts">
/**
 * 阅读设置面板。字段清单对照 Legado 的 `dialog_read_book_style.xml`。
 *
 * 分三组而不是摊成一长列：排版项有九个，一屏放不下，而「配色」和「朗读」是另外
 * 两类决定 —— 混在一起找起来很费劲。
 *
 * 全部存 `localStorage`，不落库（设备偏好而非账号偏好），见 `useReaderSettings`。
 */
import {
  AUTO_SCROLL_RANGE,
  FONT_LABEL,
  FONT_SIZE_RANGE,
  FONT_STACK,
  INDENT_RANGE,
  LETTER_SPACING_RANGE,
  LINE_HEIGHT_RANGE,
  PADDING_RANGE,
  PARAGRAPH_SPACING_RANGE,
  THEME_COLORS,
  THEME_LABEL,
  useReaderSettings,
  type ReaderFont,
  type ReaderTheme,
} from "../../composables/useReaderSettings";
import { SPEECH_RATE_RANGE } from "../../composables/useSpeech";

const show = defineModel<boolean>("show", { required: true });

const props = withDefaults(
  defineProps<{
    /** 朗读能力。正文页传进来，文章页也复用这个面板但不传。 */
    speechSupported?: boolean;
    speechVoices?: { name: string; lang: string }[];
    speechRate?: number;
    speechVoice?: string;
    hasChineseVoice?: boolean;
    autoScrollRunning?: boolean;
  }>(),
  {
    speechSupported: false,
    speechVoices: () => [],
    speechRate: 1,
    speechVoice: "",
    hasChineseVoice: true,
    autoScrollRunning: false,
  },
);

const emit = defineEmits<{
  "update:speechRate": [value: number];
  "update:speechVoice": [value: string];
  toggleAutoScroll: [];
}>();

const { settings, reset } = useReaderSettings();

const themes = Object.keys(THEME_COLORS) as ReaderTheme[];
const fonts = Object.keys(FONT_STACK) as ReaderFont[];
</script>

<template>
  <n-drawer v-model:show="show" placement="bottom" :height="520" :trap-focus="false">
    <n-drawer-content title="阅读设置" closable>
      <n-tabs type="line" animated>
        <!-- ---------------------------------------------------------- 排版 -->
        <n-tab-pane name="layout" tab="排版">
          <div class="group">
            <label class="row">
              <span class="row__label">字号 <b>{{ settings.fontSize }}</b></span>
              <n-slider
                v-model:value="settings.fontSize"
                :min="FONT_SIZE_RANGE[0]"
                :max="FONT_SIZE_RANGE[1]"
                :step="1"
              />
            </label>

            <label class="row">
              <span class="row__label">行距 <b>{{ settings.lineHeight.toFixed(1) }}</b></span>
              <n-slider
                v-model:value="settings.lineHeight"
                :min="LINE_HEIGHT_RANGE[0]"
                :max="LINE_HEIGHT_RANGE[1]"
                :step="0.1"
              />
            </label>

            <label class="row">
              <span class="row__label">
                段距 <b>{{ settings.paragraphSpacing.toFixed(1) }}</b>
              </span>
              <n-slider
                v-model:value="settings.paragraphSpacing"
                :min="PARAGRAPH_SPACING_RANGE[0]"
                :max="PARAGRAPH_SPACING_RANGE[1]"
                :step="0.1"
              />
            </label>

            <label class="row">
              <span class="row__label">
                字间距 <b>{{ settings.letterSpacing.toFixed(2) }}</b>
              </span>
              <n-slider
                v-model:value="settings.letterSpacing"
                :min="LETTER_SPACING_RANGE[0]"
                :max="LETTER_SPACING_RANGE[1]"
                :step="0.01"
              />
            </label>

            <label class="row">
              <span class="row__label">页边距 <b>{{ settings.padding }}</b></span>
              <n-slider
                v-model:value="settings.padding"
                :min="PADDING_RANGE[0]"
                :max="PADDING_RANGE[1]"
                :step="2"
              />
            </label>

            <label class="row">
              <span class="row__label">首行缩进 <b>{{ settings.indent }} 字</b></span>
              <n-slider
                v-model:value="settings.indent"
                :min="INDENT_RANGE[0]"
                :max="INDENT_RANGE[1]"
                :step="1"
                :marks="{ 0: '无', 2: '两字' }"
              />
            </label>

            <div class="row">
              <span class="row__label">字体</span>
              <div class="chips">
                <button
                  v-for="name in fonts"
                  :key="name"
                  type="button"
                  class="chip"
                  :class="{ 'chip--active': settings.font === name }"
                  :style="{ fontFamily: FONT_STACK[name] }"
                  :aria-pressed="settings.font === name"
                  @click="settings.font = name"
                >
                  {{ FONT_LABEL[name] }}
                </button>
              </div>
            </div>

            <div class="row">
              <span class="row__label">字重</span>
              <n-radio-group v-model:value="settings.fontWeight" size="small">
                <n-radio-button :value="300">细</n-radio-button>
                <n-radio-button :value="400">常规</n-radio-button>
                <n-radio-button :value="500">中</n-radio-button>
                <n-radio-button :value="600">粗</n-radio-button>
              </n-radio-group>
            </div>

            <n-button quaternary size="small" @click="reset">恢复默认</n-button>
          </div>
        </n-tab-pane>

        <!-- ---------------------------------------------------------- 配色 -->
        <n-tab-pane name="theme" tab="配色">
          <div class="group">
            <div class="row">
              <span class="row__label">正文底色</span>
              <div class="chips">
                <button
                  v-for="name in themes"
                  :key="name"
                  type="button"
                  class="chip chip--swatch"
                  :class="{ 'chip--active': settings.theme === name }"
                  :style="{ background: THEME_COLORS[name].bg, color: THEME_COLORS[name].fg }"
                  :aria-pressed="settings.theme === name"
                  @click="settings.theme = name"
                >
                  {{ THEME_LABEL[name] }}
                </button>
              </div>
            </div>
            <p class="note">
              正文底色和应用整体的明暗主题是分开的 —— 深色外壳配纸白正文是常见搭配。
              整体主题在「我的」页切换。
            </p>
          </div>
        </n-tab-pane>

        <!-- ------------------------------------------------------ 朗读与自动 -->
        <n-tab-pane name="voice" tab="朗读">
          <div class="group">
            <div class="row">
              <span class="row__label">自动翻页</span>
              <div class="inline">
                <n-button size="small" @click="emit('toggleAutoScroll')">
                  {{ autoScrollRunning ? "停止" : "开始" }}
                </n-button>
                <n-slider
                  v-model:value="settings.autoScrollSpeed"
                  :min="AUTO_SCROLL_RANGE[0]"
                  :max="AUTO_SCROLL_RANGE[1]"
                  :step="5"
                  class="inline__slider"
                />
                <span class="inline__value">{{ settings.autoScrollSpeed || AUTO_SCROLL_RANGE[0] }}</span>
              </div>
            </div>

            <template v-if="speechSupported">
              <div class="row">
                <span class="row__label">语速 <b>{{ speechRate.toFixed(1) }}×</b></span>
                <n-slider
                  :value="speechRate"
                  :min="SPEECH_RATE_RANGE[0]"
                  :max="SPEECH_RATE_RANGE[1]"
                  :step="0.1"
                  @update:value="emit('update:speechRate', $event as number)"
                />
              </div>

              <div class="row">
                <span class="row__label">音色</span>
                <n-select
                  :value="speechVoice"
                  :options="speechVoices.map((v) => ({ label: `${v.name} (${v.lang})`, value: v.name }))"
                  placeholder="系统默认"
                  clearable
                  size="small"
                  @update:value="emit('update:speechVoice', ($event as string) || '')"
                />
              </div>

              <p v-if="!hasChineseVoice" class="note note--warn">
                这台设备上没有装中文语音，朗读中文可能读不出来或者口音很重。
                语音由操作系统提供，需要在系统设置里安装中文语音包。
              </p>
              <p v-else class="note">
                朗读由浏览器和操作系统提供，音色取决于系统装了哪些语音包。
                朗读需要你先点一下播放按钮 —— 浏览器不允许未经点击就发声。
              </p>
            </template>

            <p v-else class="note note--warn">
              这个浏览器不支持语音合成（<code>speechSynthesis</code>），朗读不可用。
            </p>
          </div>
        </n-tab-pane>
      </n-tabs>
    </n-drawer-content>
  </n-drawer>
</template>

<style scoped>
.group {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding-top: var(--space-2);
}

.row {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.row__label {
  font-size: 13px;
  color: var(--text-muted);
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.chip {
  flex: 1 1 72px;
  min-height: 42px;
  padding: var(--space-2);
  font-size: 13px;
  color: inherit;
  background: var(--surface-sunken);
  border: 2px solid transparent;
  border-radius: 8px;
  cursor: pointer;
}

.chip--active {
  border-color: var(--accent);
}

.inline {
  display: flex;
  gap: var(--space-3);
  align-items: center;
}

.inline__slider {
  flex: 1;
}

.inline__value {
  min-width: 2.5em;
  font-size: 12px;
  color: var(--text-muted);
  text-align: right;
}

.note {
  margin: 0;
  font-size: 11px;
  line-height: 1.7;
  color: var(--text-muted);
}

.note--warn {
  color: #f0a020;
}
</style>
