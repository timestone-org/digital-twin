/**
 * @fileoverview 对齐、等距分布、级联落点与拖动吸附的几何。
 */
import { describe, expect, it } from 'vitest'

import type { NodeRect } from '@/pages/Modeling/Canvas/scripts/nodeLayout'
import {
  ALIGN_KINDS,
  alignTo,
  cascadeFrom,
  distributeAlong,
  snapAgainst,
  snapToGrid,
} from '@/pages/Modeling/Canvas/scripts/nodeLayout'

function rect(id: string, left: number, top: number, width = 100, height = 60) {
  return { id, left, top, width, height } satisfies NodeRect
}

describe('对齐', () => {
  const rects = [rect('a', 0, 0, 100, 60), rect('b', 40, 200, 60, 40)]

  it('左对齐把两张卡片的左缘对到最左那条线上', () => {
    const moves = alignTo(rects, 'left')

    expect(moves.get('a')?.left).toBe(0)
    expect(moves.get('b')?.left).toBe(0)
  })

  it('右对齐对的是右缘，宽度不同也要贴齐', () => {
    const moves = alignTo(rects, 'right')

    expect(moves.get('a')?.left).toBe(0)
    expect(moves.get('b')?.left).toBe(40)
  })

  it('水平居中对的是中线', () => {
    const moves = alignTo(rects, 'center-x')

    expect(moves.get('a')?.left).toBe(0)
    expect(moves.get('b')?.left).toBe(20)
  })

  it('顶对齐与底对齐只动纵向，横向原样不动', () => {
    expect(alignTo(rects, 'top').get('b')).toEqual({ left: 40, top: 0 })
    expect(alignTo(rects, 'bottom').get('a')).toEqual({ left: 0, top: 180 })
  })

  it('垂直居中对的是横中线', () => {
    expect(alignTo(rects, 'center-y').get('a')?.top).toBe(90)
  })

  it('只选中一张时什么都不做——一张卡片没有「对齐」可言', () => {
    for (const kind of ALIGN_KINDS) {
      expect(alignTo([rect('a', 0, 0)], kind).size).toBe(0)
    }
  })
})

describe('等距分布', () => {
  it('两头不动，中间那张按间隙匀开', () => {
    const moves = distributeAlong(
      [rect('a', 0, 0, 100), rect('b', 120, 0, 100), rect('c', 400, 0, 100)],
      'x',
    )

    expect(moves.get('a')?.left).toBe(0)
    expect(moves.get('c')?.left).toBe(400)
    expect(moves.get('b')?.left).toBe(200)
  })

  // ⚠ 匀的是间隙不是中心距：宽窄不一时按中心距匀出来看着疏密不均
  it('宽窄不一时匀的是间隙', () => {
    const moves = distributeAlong(
      [rect('a', 0, 0, 100), rect('b', 150, 0, 20), rect('c', 300, 0, 100)],
      'x',
    )

    expect(moves.get('b')?.left).toBe(190)
  })

  it('纵向分布只动纵向', () => {
    const moves = distributeAlong(
      [
        rect('a', 7, 0, 100, 50),
        rect('b', 7, 60, 100, 50),
        rect('c', 7, 300, 100, 50),
      ],
      'y',
    )

    expect(moves.get('b')).toEqual({ left: 7, top: 150 })
  })

  it('不足三张时什么都不做——两张之间没有「中间」可匀', () => {
    expect(distributeAlong([rect('a', 0, 0), rect('b', 9, 0)], 'x').size).toBe(
      0,
    )
  })
})

describe('落点', () => {
  it('连着落好几张时逐个错开，不叠在一起', () => {
    const first = cascadeFrom({ left: 80, top: 80 }, 0)
    const second = cascadeFrom({ left: 80, top: 80 }, 1)

    expect(second).not.toEqual(first)
  })

  it('错开量绕圈，不会一路跑出视野', () => {
    expect(cascadeFrom({ left: 0, top: 0 }, 6)).toEqual({ left: 0, top: 0 })
  })

  it('吸到栅格上', () => {
    expect(snapToGrid({ left: 11, top: 3 }, 8)).toEqual({ left: 8, top: 0 })
  })
})

describe('拖动吸附', () => {
  const others = [rect('b', 200, 200, 100, 60)]

  it('贴近别人的左缘时吸上去，并给一条竖参考线', () => {
    const hit = snapAgainst(rect('a', 197, 0), others, 1)

    expect(hit.delta.left).toBe(3)
    expect(hit.guides).toContainEqual({ axis: 'x', at: 200 })
  })

  it('离得远就不吸，也不画线', () => {
    const hit = snapAgainst(rect('a', 40, 40), others, 1)

    expect(hit.delta).toEqual({ left: 0, top: 0 })
    expect(hit.guides).toEqual([])
  })

  it('中线对中线也吸——两张卡片一样宽时这是最常用的一条', () => {
    const hit = snapAgainst(rect('a', 248, 500), others, 1)

    expect(hit.delta.left).toBe(2)
  })

  it('两个轴各吸各的，横竖可以同时贴上', () => {
    const hit = snapAgainst(rect('a', 197, 203), others, 1)

    expect(hit.delta).toEqual({ left: 3, top: -3 })
    expect(hit.guides).toHaveLength(2)
  })

  // ⚠ 容差是**屏幕**像素：按画布像素算的话，缩到 25% 时它只相当于 1.5 个屏幕
  // 像素，吸附等于没了；这条本仓的另一块画布已经踩过
  it('缩小时容差按画布像素放大，吸附不会失灵', () => {
    const farAway = rect('a', 180, 0)

    expect(snapAgainst(farAway, others, 1).guides).toEqual([])
    expect(snapAgainst(farAway, others, 0.25).delta.left).toBe(20)
  })

  it('放大时容差按画布像素收紧，卡片不会离老远就被吸走', () => {
    const nearby = rect('a', 196, 0)

    expect(snapAgainst(nearby, others, 1).delta.left).toBe(4)
    expect(snapAgainst(nearby, others, 2.5).guides).toEqual([])
  })
})
