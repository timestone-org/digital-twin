/**
 * @fileoverview 悬浮卡避让的几何：只有越界才翻、翻过去要更好、压在节点身上的不翻，
 * 以及箭头以卡片中线对折。
 */
import { describe, expect, it } from 'vitest'

import { mirroredChildOffset, popupFlipOffset } from '../src/popupFlip'

const BOUNDS = { start: 0, end: 600 }

describe('popupFlipOffset', () => {
  it('朝下的卡片越过舞台下沿时翻到节点上方，间距原样保留', () => {
    // 节点 500–560，卡片在它下方 10px、高 80 → 越出下沿 50
    const dy = popupFlipOffset(
      { start: 500, end: 560 },
      { start: 570, end: 650 },
      BOUNDS,
    )
    // 新上沿 = 500 - 10 - 80 = 410
    expect(dy).toBe(410 - 570)
  })

  it('朝上的卡片越过舞台上沿时翻到节点下方', () => {
    const dy = popupFlipOffset(
      { start: 20, end: 80 },
      { start: -70, end: 10 },
      BOUNDS,
    )
    // 新上沿 = 80 + 10 = 90
    expect(dy).toBe(90 - -70)
  })

  it('放得下就不动', () => {
    expect(
      popupFlipOffset(
        { start: 100, end: 160 },
        { start: 170, end: 250 },
        BOUNDS,
      ),
    ).toBeNull()
  })

  it('两边都放不下时留在越得少的那边', () => {
    // 舞台只有 100 高，卡片 80：朝下越 60，翻上去（上沿 50-10-80=-40）越 40 → 翻
    const small = { start: 0, end: 100 }
    expect(
      popupFlipOffset({ start: 50, end: 70 }, { start: 80, end: 160 }, small),
    ).toBe(-120)
    // 朝下越 10，翻上去越 70 → 不翻
    expect(
      popupFlipOffset({ start: 0, end: 20 }, { start: 30, end: 110 }, small),
    ).toBeNull()
  })

  it('压在节点身上的图元没有另一侧，不翻', () => {
    expect(
      popupFlipOffset(
        { start: 500, end: 560 },
        { start: 540, end: 620 },
        BOUNDS,
      ),
    ).toBeNull()
  })
})

describe('mirroredChildOffset', () => {
  it('贴上沿的箭头对折到下沿', () => {
    // 卡片高 80，箭头上沿在 -4、高 8 → 新上沿 76
    expect(mirroredChildOffset(80, -4, 8)).toBe(76 - -4)
  })
})
