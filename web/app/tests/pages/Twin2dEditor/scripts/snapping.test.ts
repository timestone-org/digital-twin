/**
 * @fileoverview 契约：落点先吸网格、节点拖动在网格之外还吸同级边线（命中时压过网格
 * 并交出参考线），以及**关掉吸附就真的一点不吸**。
 *
 * ⚠ 留一手「至少吸网格」会让「关掉吸附再对一两个像素」这件事永远做不成。
 * ⚠ 参考线不压过网格的话，线永远差那么一两个像素——而那正是用户要对齐的原因。
 */
import { describe, expect, it } from 'vitest'

import {
  TWIN_2D_DEFAULT_SNAP,
  TWIN_2D_SNAP_THRESHOLD,
  snapNodeBox,
  snapPoint,
  snapThresholdOf,
  snapValue,
} from '@/pages/Twin2dEditor/scripts/snapping'
import type { Twin2dSnapOptions } from '@/pages/Twin2dEditor/scripts/snapping'

const ON: Twin2dSnapOptions = { ...TWIN_2D_DEFAULT_SNAP }
const OFF: Twin2dSnapOptions = { ...ON, enabled: false }
const NO_GUIDES: Twin2dSnapOptions = { ...ON, guides: false }

/** 一个 100 × 50 的节点，左上角在 (23, 37)。 */
const BOX = { x: 23, y: 37, w: 100, h: 50 }

describe('吸网格', () => {
  it('吸到最近的一格', () => {
    expect(snapValue(23, 20)).toBe(20)
    expect(snapValue(31, 20)).toBe(40)
    expect(snapValue(-31, 20)).toBe(-40)
  })

  it('步长非正时原样返回', () => {
    expect(snapValue(23, 0)).toBe(23)
  })

  it('坐标不是数时按 0 算', () => {
    expect(snapValue(NaN, 20)).toBe(0)
  })

  it('落点两轴一起吸', () => {
    expect(snapPoint({ x: 23, y: 37 }, ON)).toEqual({ x: 20, y: 40 })
  })

  it('关掉吸附之后落点一动不动', () => {
    expect(snapPoint({ x: 23, y: 37 }, OFF)).toEqual({ x: 23, y: 37 })
  })
})

describe('阈值换算', () => {
  it('倍率越大，设计像素里的吸附圈越小', () => {
    expect(snapThresholdOf(2)).toBe(TWIN_2D_SNAP_THRESHOLD / 2)
    expect(snapThresholdOf(0.5)).toBe(TWIN_2D_SNAP_THRESHOLD * 2)
  })

  it('倍率非正或不是数时按原值算', () => {
    expect(snapThresholdOf(0)).toBe(TWIN_2D_SNAP_THRESHOLD)
    expect(snapThresholdOf(NaN)).toBe(TWIN_2D_SNAP_THRESHOLD)
  })
})

describe('节点吸附', () => {
  it('没有同级可吸时只吸网格', () => {
    expect(snapNodeBox(BOX, [], ON)).toEqual({ x: 20, y: 40, guides: [] })
  })

  it('阈值之内的同级边线压过网格，并交出一条参考线', () => {
    const peers = [{ x: 18, y: 200, w: 100, h: 50 }]

    expect(snapNodeBox(BOX, peers, ON)).toEqual({
      x: 18,
      y: 40,
      guides: [{ axis: 'x', at: 18 }],
    })
  })

  it('中线对中线也算一次对齐', () => {
    const box = { x: 3, y: 37, w: 100, h: 50 }
    const peers = [{ x: 30, y: 400, w: 46, h: 50 }]

    expect(snapNodeBox(box, peers, ON)).toEqual({
      x: 3,
      y: 40,
      guides: [{ axis: 'x', at: 53 }],
    })
  })

  it('两轴各自吸各自的边线', () => {
    const peers = [{ x: 18, y: 34, w: 100, h: 50 }]

    expect(snapNodeBox(BOX, peers, ON).guides).toEqual([
      { axis: 'x', at: 18 },
      { axis: 'y', at: 34 },
    ])
  })

  it('阈值之外的同级不吸，落回网格', () => {
    const peers = [{ x: 10, y: 200, w: 100, h: 50 }]

    expect(snapNodeBox(BOX, peers, ON)).toEqual({ x: 20, y: 40, guides: [] })
  })

  it('只关参考线时仍吸网格，但不再交出参考线', () => {
    const peers = [{ x: 18, y: 200, w: 100, h: 50 }]

    expect(snapNodeBox(BOX, peers, NO_GUIDES)).toEqual({
      x: 20,
      y: 40,
      guides: [],
    })
  })

  it('关掉吸附之后网格与边线都不吸', () => {
    const peers = [{ x: 18, y: 34, w: 100, h: 50 }]

    expect(snapNodeBox(BOX, peers, OFF)).toEqual({ x: 23, y: 37, guides: [] })
  })

  it('两条同级都够得着时吸更近的那一条', () => {
    const peers = [
      { x: 18, y: 200, w: 100, h: 50 },
      { x: 21, y: 200, w: 100, h: 50 },
    ]

    expect(snapNodeBox(BOX, peers, ON).x).toBe(21)
  })
})
