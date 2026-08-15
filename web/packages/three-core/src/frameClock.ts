/**
 * @fileoverview 渲染循环的帧时钟：把 rAF 给的时刻换成「这一帧多长」。
 *
 * ⚠ 时长必须夹上限：标签页切走再回来时 rAF 的间隔能有几十秒，不夹的话动画会
 * 按那个时长一次推进完——用户看到的是切回来那一刻画面突然跳一大段。
 */

/** 一帧最多按这么长推进，秒。 */
export const MAX_FRAME_S = 0.1

export interface FrameClock {
  /** 收下 rAF 的时刻，回这一帧的时长（秒）。第一帧恒为 0。 */
  tick: (nowMs: number) => number
  /** 重新计时；重新挂载渲染循环时调，免得把停摆那段算成一帧。 */
  reset: () => void
}

/** 造一个帧时钟。 */
export function createFrameClock(): FrameClock {
  let previousMs = 0
  return {
    tick: (nowMs) => {
      const previous = previousMs
      previousMs = nowMs
      // 第一帧没有上一帧可比；时刻倒流（有的浏览器换时基会）同样按 0 算
      if (previous === 0 || nowMs <= previous) return 0
      return Math.min((nowMs - previous) / 1000, MAX_FRAME_S)
    },
    reset: () => {
      previousMs = 0
    },
  }
}
