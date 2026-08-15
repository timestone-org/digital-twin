/**
 * @fileoverview 帧时钟：把 rAF 的时刻换成这一帧的时长。
 * ⚠ 上限那一条是这里的要点：标签页切走再回来时 rAF 的间隔能有几十秒，
 * 不夹的话动画会一次推完那么长——用户看到的是切回来那一刻画面猛跳一段。
 */
import { describe, expect, it } from 'vitest'

import { MAX_FRAME_S, createFrameClock } from '../src/frameClock'

describe('帧时长', () => {
  it('第一帧没有上一帧可比，按 0 算', () => {
    expect(createFrameClock().tick(1000)).toBe(0)
  })

  it('第二帧起给出两次之间的秒数', () => {
    const clock = createFrameClock()
    clock.tick(1000)

    expect(clock.tick(1016)).toBeCloseTo(0.016)
  })

  it('切走再回来的那一大段被夹到上限', () => {
    const clock = createFrameClock()
    clock.tick(1000)

    expect(clock.tick(31000)).toBe(MAX_FRAME_S)
  })

  // 有的浏览器换时基时时刻会倒流，减出来是负数
  it('时刻倒流时按 0 算，不产出负时长', () => {
    const clock = createFrameClock()
    clock.tick(5000)

    expect(clock.tick(4000)).toBe(0)
  })

  it('同一时刻连着来两次也是 0', () => {
    const clock = createFrameClock()
    clock.tick(1000)

    expect(clock.tick(1000)).toBe(0)
  })
})

describe('重新计时', () => {
  // 重新挂载渲染循环时不 reset 的话，停摆那一整段会被当成一帧推进
  it('reset 之后下一帧重新按第一帧算', () => {
    const clock = createFrameClock()
    clock.tick(1000)
    clock.reset()

    expect(clock.tick(9000)).toBe(0)
  })
})
