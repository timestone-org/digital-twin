/**
 * @fileoverview 契约：三类实体在画布上占的那只盒。节点转过 90 / 270 时占的是换过来的
 * 宽高、两种参考点各自的口径，辅助线取两端的外接盒，一串点取它的外接盒。
 *
 * ⚠ 转过的节点仍按原尺寸算盒不会报错：吸附会吸到一条画面上根本没有的边上，
 * 框选也会框不中看着明明在框里的那一个。
 * ⚠ 中心参考与左上角参考混用同样零报错，表现是整体偏半个身位。
 */
import { normalizeMark, normalizeNode, normalizeNodeStyle } from '@dt/twin2d'
import type { Twin2dMark, Twin2dNode, Twin2dNodeStyle } from '@dt/twin2d'
import { describe, expect, it } from 'vitest'

import {
  markSnapBox,
  nodeSnapBox,
  nodeWorldBox,
  pointsBox,
} from '@/pages/Twin2dEditor/scripts/entityBoxes'

/** 60 × 20 的扁样式：宽高换过来一眼看得出。 */
const STYLE: Twin2dNodeStyle = mustStyle({
  id: 's1',
  name: '扁块',
  size: { w: 60, h: 20 },
})

function mustStyle(raw: unknown): Twin2dNodeStyle {
  const style = normalizeNodeStyle(raw)
  if (style === null) throw new Error('样式没造出来')
  return style
}

function nodeOf(over: Record<string, unknown> = {}): Twin2dNode {
  const node = normalizeNode({
    id: 'n1',
    styleId: 's1',
    x: 100,
    y: 200,
    ...over,
  })
  if (node === null) throw new Error('节点没造出来')
  return node
}

function markOf(raw: Record<string, unknown>): Twin2dMark {
  const mark = normalizeMark(raw)
  if (mark === null) throw new Error('标注没造出来')
  return mark
}

describe('节点的世界盒', () => {
  it('没转过的节点原样占样式那份尺寸', () => {
    expect(nodeWorldBox(nodeOf(), STYLE)).toEqual({
      x: 130,
      y: 210,
      w: 60,
      h: 20,
    })
  })

  it('转过 90 度占的是换过来的宽高', () => {
    expect(nodeWorldBox(nodeOf({ rotate: 90 }), STYLE)).toEqual({
      x: 130,
      y: 210,
      w: 20,
      h: 60,
    })
  })

  it('转过 270 度也一样换', () => {
    expect(nodeWorldBox(nodeOf({ rotate: 270 }), STYLE).w).toBe(20)
  })

  it('转过 180 度不换', () => {
    expect(nodeWorldBox(nodeOf({ rotate: 180 }), STYLE).w).toBe(60)
  })

  it('节点自己写了尺寸就按它自己的算', () => {
    expect(nodeWorldBox(nodeOf({ w: 40, h: 40 }), STYLE)).toEqual({
      x: 120,
      y: 220,
      w: 40,
      h: 40,
    })
  })
})

describe('节点的吸附盒', () => {
  it('没转过时左上角就是节点自己的坐标', () => {
    expect(nodeSnapBox(nodeOf(), STYLE)).toEqual({
      x: 100,
      y: 200,
      w: 60,
      h: 20,
    })
  })

  it('转过 90 度时左上角跟着换过来的宽高回退', () => {
    expect(nodeSnapBox(nodeOf({ rotate: 90 }), STYLE)).toEqual({
      x: 120,
      y: 180,
      w: 20,
      h: 60,
    })
  })
})

describe('标注的吸附盒', () => {
  it('有框的那两档原样给四个数', () => {
    const mark = markOf({ id: 'm1', kind: 'rect', x: 10, y: 20, w: 30, h: 40 })

    expect(markSnapBox(mark)).toEqual({ x: 10, y: 20, w: 30, h: 40 })
  })

  it('辅助线取两端的外接盒', () => {
    const mark = markOf({
      id: 'm2',
      kind: 'line',
      x: 10,
      y: 80,
      x2: 50,
      y2: 20,
    })

    expect(markSnapBox(mark)).toEqual({ x: 10, y: 20, w: 40, h: 60 })
  })

  it('两端反着写也是同一只盒', () => {
    const mark = markOf({
      id: 'm3',
      kind: 'line',
      x: 50,
      y: 20,
      x2: 10,
      y2: 80,
    })

    expect(markSnapBox(mark)).toEqual({ x: 10, y: 20, w: 40, h: 60 })
  })

  it('横平竖直的辅助线有一边是零', () => {
    const mark = markOf({
      id: 'm4',
      kind: 'line',
      x: 10,
      y: 40,
      x2: 90,
      y2: 40,
    })

    expect(markSnapBox(mark).h).toBe(0)
  })
})

describe('一串点的外接盒', () => {
  it('把所有点都圈进去', () => {
    const points = [
      { x: 10, y: 50 },
      { x: 70, y: 20 },
      { x: 30, y: 90 },
    ]

    expect(pointsBox(points)).toEqual({ x: 10, y: 20, w: 60, h: 70 })
  })

  it('只有一个点时是一只零尺寸的盒', () => {
    expect(pointsBox([{ x: 5, y: 6 }])).toEqual({ x: 5, y: 6, w: 0, h: 0 })
  })

  it('一个点都没有时没有盒', () => {
    expect(pointsBox([])).toBeNull()
  })
})
