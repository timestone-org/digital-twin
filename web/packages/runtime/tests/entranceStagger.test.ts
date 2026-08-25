/**
 * @fileoverview 守入场错峰的排队口径：按视觉序（上到下、左到右）而不是渲染序、
 * 同位并列按 id 稳定、错峰有封顶、容器子层拿父格延迟接力。
 */
import { describe, expect, it } from 'vitest'

import {
  ENTER_STAGGER_MS,
  MAX_STAGGERED_NODES,
  entranceDelays,
} from '../src/entranceStagger'
import type { RuntimeNode } from '../src/nodeTree'

function nodeAt(id: string, x: number, y: number): RuntimeNode {
  return {
    id,
    moduleType: 'leaf',
    box: { x, y, w: 100, h: 50 },
    zIndex: 1,
    isVisible: true,
    isContainer: false,
    config: {},
    children: [],
    bindings: [],
  }
}

describe('入场错峰', () => {
  it('按视觉序排队：先上后下，同一行先左后右', () => {
    const delays = entranceDelays(
      [nodeAt('right', 500, 0), nodeAt('below', 0, 300), nodeAt('left', 0, 0)],
      0,
    )

    expect(delays.get('left')).toBe(0)
    expect(delays.get('right')).toBe(ENTER_STAGGER_MS)
    expect(delays.get('below')).toBe(ENTER_STAGGER_MS * 2)
  })

  it('坐标完全相同的并列格按 id 定序，两次算出来一个样', () => {
    const nodes = [nodeAt('b', 0, 0), nodeAt('a', 0, 0)]

    expect(entranceDelays(nodes, 0)).toEqual(
      entranceDelays([...nodes].reverse(), 0),
    )
    expect(entranceDelays(nodes, 0).get('a')).toBe(0)
  })

  it('错峰封顶：排在上限之后的格子与最后一档同时出现', () => {
    const nodes = Array.from({ length: MAX_STAGGERED_NODES + 5 }, (_, index) =>
      nodeAt(`n${String(index).padStart(2, '0')}`, 0, index * 10),
    )
    const delays = entranceDelays(nodes, 0)
    const cap = MAX_STAGGERED_NODES * ENTER_STAGGER_MS

    expect(delays.get(`n${MAX_STAGGERED_NODES}`)).toBe(cap)
    expect(delays.get(`n${MAX_STAGGERED_NODES + 4}`)).toBe(cap)
  })

  it('起拍延迟整体平移每一格', () => {
    const delays = entranceDelays([nodeAt('a', 0, 0), nodeAt('b', 0, 10)], 200)

    expect(delays.get('a')).toBe(200)
    expect(delays.get('b')).toBe(200 + ENTER_STAGGER_MS)
  })
})
