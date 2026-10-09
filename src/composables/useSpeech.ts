/**
 * 朗读（TTS）。用浏览器自带的 `speechSynthesis` —— 不需要服务端，也不需要任何
 * 依赖。这是 Legado 的主力功能之一，Web 上恰好有对应能力。
 *
 * 几个必须绕开的坑，都是 Web Speech API 的实际行为而不是理论问题：
 *
 * - **一次只喂一段，不要把整章塞进去。** 各家实现对单次 utterance 的长度都有
 *   隐性上限（Chrome 大约几百字后会静默截断或直接不响），而且长 utterance 没法
 *   精确知道读到哪、也没法「跳到下一段」。所以按段排队，一段一个 utterance。
 * - **`getVoices()` 可能先返回空数组。** 语音列表是异步加载的，首次调用常常是
 *   空的，要等 `voiceschanged`。
 * - **`pause()` 在部分移动端不可靠。** 所以「暂停」实现为 `cancel()` + 记住位置，
 *   恢复时从那一段重新开始 —— 比一个点了没反应的暂停键好。
 * - **必须由用户手势触发第一次 `speak()`。** 自动播放策略会拦掉非手势触发的朗读，
 *   所以不提供「打开章节就自动朗读」。
 */

import { computed, onBeforeUnmount, readonly, ref } from "vue";

export interface SpeechVoiceOption {
  name: string;
  lang: string;
}

const supported =
  typeof window !== "undefined" && "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;

/** 语音列表异步到达，模块级缓存一份，所有实例共用。 */
const voices = ref<SpeechSynthesisVoice[]>([]);

function refreshVoices() {
  if (!supported) return;
  voices.value = window.speechSynthesis.getVoices();
}

if (supported) {
  refreshVoices();
  //  首次 getVoices() 常常是空的 —— 列表异步加载，要等这个事件
  window.speechSynthesis.addEventListener("voiceschanged", refreshVoices);
}

const RATE_RANGE = [0.5, 2.5] as const;
export const SPEECH_RATE_RANGE = RATE_RANGE;

export function useSpeech() {
  const speaking = ref(false);
  /** 正在读第几段。-1 = 没在读。 */
  const index = ref(-1);
  const rate = ref(1);
  const voiceName = ref("");

  let queue: string[] = [];
  let current: SpeechSynthesisUtterance | null = null;
  /** 主动停止时要抑制 onend 的续读，否则 cancel() 会触发下一段 */
  let aborting = false;

  /** 中文音色优先排前面 —— 读中文小说时它们才是有用的那批。 */
  const chineseVoices = computed<SpeechVoiceOption[]>(() => {
    const all = voices.value.map((voice) => ({ name: voice.name, lang: voice.lang }));
    const chinese = all.filter((voice) => voice.lang.toLowerCase().startsWith("zh"));
    const rest = all.filter((voice) => !voice.lang.toLowerCase().startsWith("zh"));
    return [...chinese, ...rest];
  });

  const hasChineseVoice = computed(() =>
    voices.value.some((voice) => voice.lang.toLowerCase().startsWith("zh")),
  );

  function pickVoice(): SpeechSynthesisVoice | undefined {
    if (voiceName.value) {
      const chosen = voices.value.find((voice) => voice.name === voiceName.value);
      if (chosen) return chosen;
    }
    return voices.value.find((voice) => voice.lang.toLowerCase().startsWith("zh"));
  }

  function speakAt(position: number) {
    if (!supported || position < 0 || position >= queue.length) {
      stop();
      return;
    }
    index.value = position;
    const utterance = new SpeechSynthesisUtterance(queue[position]);
    utterance.rate = rate.value;
    const voice = pickVoice();
    if (voice) {
      utterance.voice = voice;
      utterance.lang = voice.lang;
    } else {
      //  没有中文音色时也设 lang —— 有些实现会据此挑一个凑合的
      utterance.lang = "zh-CN";
    }
    utterance.onend = () => {
      if (aborting) return;
      speakAt(position + 1);
    };
    utterance.onerror = () => {
      if (aborting) return;
      //  单段失败就跳过，不要整段停下来 —— 常见原因是某段里有引擎处理不了的字符
      speakAt(position + 1);
    };
    current = utterance;
    window.speechSynthesis.speak(utterance);
    speaking.value = true;
  }

  /**
   * 开始朗读。`paragraphs` 是已经切好的段落。
   *
   * **必须在用户手势的调用栈里调用** —— 自动播放策略会拦掉非手势触发的朗读。
   */
  function start(paragraphs: string[], from = 0) {
    if (!supported) return false;
    queue = paragraphs.filter((line) => line.trim());
    if (!queue.length) return false;
    aborting = true;
    window.speechSynthesis.cancel();
    aborting = false;
    speakAt(Math.min(Math.max(0, from), queue.length - 1));
    return true;
  }

  function stop() {
    if (!supported) return;
    aborting = true;
    window.speechSynthesis.cancel();
    aborting = false;
    speaking.value = false;
    index.value = -1;
    current = null;
  }

  /**
   * 暂停。用 `cancel()` + 记住位置而不是 `pause()` —— 后者在部分移动端浏览器上
   * 不生效，留一个点了没反应的按钮比没有更糟。
   */
  function pause() {
    if (!supported || !speaking.value) return;
    aborting = true;
    window.speechSynthesis.cancel();
    aborting = false;
    speaking.value = false;
  }

  function resume() {
    if (!supported || index.value < 0) return;
    speakAt(index.value);
  }

  function skip(delta: number) {
    if (!supported || index.value < 0) return;
    speakAt(index.value + delta);
  }

  /** 改语速要重新发起当前段 —— 已经在队列里的 utterance 改不了 rate。 */
  function setRate(value: number) {
    rate.value = Math.min(RATE_RANGE[1], Math.max(RATE_RANGE[0], value));
    if (speaking.value) resume();
  }

  function setVoice(name: string) {
    voiceName.value = name;
    if (speaking.value) resume();
  }

  onBeforeUnmount(stop);

  return {
    supported,
    speaking: readonly(speaking),
    index: readonly(index),
    rate: readonly(rate),
    voiceName: readonly(voiceName),
    voices: chineseVoices,
    hasChineseVoice,
    start,
    stop,
    pause,
    resume,
    skip,
    setRate,
    setVoice,
  };
}
