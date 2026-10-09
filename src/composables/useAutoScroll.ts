/**
 * 自动翻页（匀速滚动）。
 *
 * 用 `requestAnimationFrame` 累加小数位移，而不是 `setInterval` 每次滚整数像素：
 * 后者在低速下会变成「停顿—跳一格—停顿」，看着像卡顿。累加小数、只在跨过整像素
 * 时才写 `scrollTop`，低速也是平滑的。
 */

import { onBeforeUnmount, readonly, ref, type Ref } from "vue";

export function useAutoScroll(target: Ref<HTMLElement | null>) {
  const running = ref(false);
  /** 像素/秒 */
  const speed = ref(40);

  let frame: number | undefined;
  let lastTime = 0;
  /** 累积的小数位移，跨过 1px 才真正滚 */
  let carry = 0;

  function tick(now: number) {
    const element = target.value;
    if (!running.value || !element) return;

    //  第一帧只用来取基准时间 —— 否则 now - 0 是个巨大的 delta，会直接滚到底
    if (!lastTime) {
      lastTime = now;
      frame = requestAnimationFrame(tick);
      return;
    }
    //  切后台回来时 delta 可能是好几秒。上限 100ms，否则一下滚过去一大段。
    const delta = Math.min(100, now - lastTime);
    lastTime = now;

    carry += (speed.value * delta) / 1000;
    const whole = Math.floor(carry);
    if (whole >= 1) {
      carry -= whole;
      const before = element.scrollTop;
      element.scrollTop = before + whole;
      //  到底了就自己停 —— 继续空转只是白耗电，而且用户看不出为什么没反应
      if (element.scrollTop === before) {
        stop();
        return;
      }
    }
    frame = requestAnimationFrame(tick);
  }

  function start(pixelsPerSecond?: number) {
    if (pixelsPerSecond) speed.value = pixelsPerSecond;
    if (running.value) return;
    running.value = true;
    lastTime = 0;
    carry = 0;
    frame = requestAnimationFrame(tick);
  }

  function stop() {
    running.value = false;
    if (frame !== undefined) cancelAnimationFrame(frame);
    frame = undefined;
  }

  function toggle(pixelsPerSecond?: number) {
    if (running.value) stop();
    else start(pixelsPerSecond);
  }

  onBeforeUnmount(stop);

  return { running: readonly(running), speed, start, stop, toggle };
}
