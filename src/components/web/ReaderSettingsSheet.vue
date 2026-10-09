<script setup lang="ts">
/** 阅读设置面板：字号、行距、页边距、正文配色。全部存本地，见 useReaderSettings。 */
import {
  FONT_SIZE_RANGE,
  LINE_HEIGHT_RANGE,
  PADDING_RANGE,
  THEME_COLORS,
  THEME_LABEL,
  useReaderSettings,
  type ReaderTheme,
} from "../../composables/useReaderSettings";

const show = defineModel<boolean>("show", { required: true });
const { settings, reset } = useReaderSettings();

const themes = Object.keys(THEME_COLORS) as ReaderTheme[];
</script>

<template>
  <n-drawer v-model:show="show" placement="bottom" :height="330" :trap-focus="false">
    <n-drawer-content title="阅读设置" closable>
      <div class="settings">
        <label class="settings__row">
          <span class="settings__label">字号 <b>{{ settings.fontSize }}</b></span>
          <n-slider
            v-model:value="settings.fontSize"
            :min="FONT_SIZE_RANGE[0]"
            :max="FONT_SIZE_RANGE[1]"
            :step="1"
          />
        </label>

        <label class="settings__row">
          <span class="settings__label">行距 <b>{{ settings.lineHeight.toFixed(1) }}</b></span>
          <n-slider
            v-model:value="settings.lineHeight"
            :min="LINE_HEIGHT_RANGE[0]"
            :max="LINE_HEIGHT_RANGE[1]"
            :step="0.1"
          />
        </label>

        <label class="settings__row">
          <span class="settings__label">页边距 <b>{{ settings.padding }}</b></span>
          <n-slider
            v-model:value="settings.padding"
            :min="PADDING_RANGE[0]"
            :max="PADDING_RANGE[1]"
            :step="2"
          />
        </label>

        <div class="settings__row">
          <span class="settings__label">配色</span>
          <div class="settings__themes">
            <button
              v-for="name in themes"
              :key="name"
              type="button"
              class="swatch"
              :class="{ 'swatch--active': settings.theme === name }"
              :style="{ background: THEME_COLORS[name].bg, color: THEME_COLORS[name].fg }"
              :aria-pressed="settings.theme === name"
              @click="settings.theme = name"
            >
              {{ THEME_LABEL[name] }}
            </button>
          </div>
        </div>

        <n-button quaternary size="small" @click="reset">恢复默认</n-button>
      </div>
    </n-drawer-content>
  </n-drawer>
</template>

<style scoped>
.settings {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.settings__row {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.settings__label {
  font-size: 13px;
  color: var(--text-muted);
}

.settings__themes {
  display: flex;
  gap: var(--space-2);
}

.swatch {
  flex: 1;
  min-height: 44px;
  padding: var(--space-2);
  font-size: 13px;
  border: 2px solid transparent;
  border-radius: 8px;
  cursor: pointer;
}

.swatch--active {
  border-color: var(--accent);
}
</style>
