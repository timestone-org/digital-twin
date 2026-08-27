/**
 * @fileoverview 距离基准点：牌的落点怎么解析、能量流的中点落在哪。
 *
 * ⚠ 这一份是运行态判显隐与编辑器「量当前距离」共用的那一处口径。
 * 两处对不上的表现只是「量出来的数填进去不生效」，不报错也没有别的痕迹。
 */
import { normalizeTwinConfig } from '@dt/twin-config'
import type { TwinConfig, TwinFlowLink, TwinPanel } from '@dt/twin-config'
import { describe, expect, it } from 'vitest'

import { flowMidpointOf, panelPositionOf } from '../src/distanceBasis'

/** 归一化一遍再取，省得在测试里手拼一份与生产不同形的配置。 */
function configOf(raw: Record<string, unknown>): TwinConfig {
  return normalizeTwinConfig(raw)
}

function panelOf(config: TwinConfig, id: string): TwinPanel {
  const found = config.panels.find((item) => item.id === id)
  if (found === undefined) throw new Error(`没有 ${id} 这张牌`)
  return found
}

function flowOf(config: TwinConfig, id: string): TwinFlowLink {
  const found = config.flows.find((item) => item.id === id)
  if (found === undefined) throw new Error(`没有 ${id} 这条流`)
  return found
}

const ANCHORS = [
  { id: 'a1', position: [0, 0, 0] },
  { id: 'a2', position: [10, 0, 0] },
  { id: 'a3', position: [10, 10, 0] },
]

describe('信息牌的落点', () => {
  it('挂了锚点就跟着锚点走，再叠自己的偏移', () => {
    const config = configOf({
      anchors: ANCHORS,
      panels: [{ id: 'p1', anchorId: 'a2', offset: [0, 2, 0] }],
    })

    expect(panelPositionOf(panelOf(config, 'p1'), config.anchors)).toEqual([
      10, 2, 0,
    ])
  })

  // 锚点被删了那张牌不该整个消失，用户只会觉得「我的牌哪去了」
  it('锚点悬空时退回自带坐标，不是给不出落点', () => {
    const config = configOf({
      anchors: ANCHORS,
      panels: [{ id: 'p1', anchorId: '没这个锚点', position: [1, 2, 3] }],
    })

    expect(panelPositionOf(panelOf(config, 'p1'), config.anchors)).toEqual([
      1, 2, 3,
    ])
  })
})

describe('能量流的落点', () => {
  it('两点一条直线时落在中点上', () => {
    const config = configOf({
      anchors: ANCHORS,
      flows: [{ id: 'f1', pathAnchors: ['a1', 'a2'] }],
    })

    const midpoint = flowMidpointOf(flowOf(config, 'f1'), config.anchors)

    expect(midpoint?.x).toBeCloseTo(5)
    expect(midpoint?.y).toBeCloseTo(0)
  })

  // ⚠ 走的是铺管线那条曲线而不是端点均值：拐弯的管子上两者不是一个点，
  // 而 `self` 参考系量的必须是管子本身
  it('多点拐弯时落在曲线上，不是端点的平均', () => {
    const config = configOf({
      anchors: ANCHORS,
      flows: [{ id: 'f1', pathAnchors: ['a1', 'a2', 'a3'] }],
    })

    const midpoint = flowMidpointOf(flowOf(config, 'f1'), config.anchors)
    const average = { x: (0 + 10 + 10) / 3, y: (0 + 0 + 10) / 3 }

    expect(midpoint).not.toBeNull()
    expect(
      Math.hypot(
        (midpoint?.x ?? 0) - average.x,
        (midpoint?.y ?? 0) - average.y,
      ),
    ).toBeGreaterThan(0.5)
  })

  it('悬空的途经点只跳过那一个，剩下的照样铺得出来', () => {
    const config = configOf({
      anchors: ANCHORS,
      flows: [{ id: 'f1', pathAnchors: ['a1', '没这个锚点', 'a2'] }],
    })

    expect(flowMidpointOf(flowOf(config, 'f1'), config.anchors)).not.toBeNull()
  })

  it('解析下来不足两点时给 null——那条流本来就画不出线', () => {
    const config = configOf({
      anchors: ANCHORS,
      flows: [{ id: 'f1', pathAnchors: ['a1', '没这个锚点'] }],
    })

    expect(flowMidpointOf(flowOf(config, 'f1'), config.anchors)).toBeNull()
  })

  // 重合点上 CatmullRom 的切线是零向量，管线会整根变 NaN 顶点后消失
  it('连着的重合点并成一个，不当成两点', () => {
    const config = configOf({
      anchors: [...ANCHORS, { id: 'dup', position: [0, 0, 0] }],
      flows: [{ id: 'f1', pathAnchors: ['a1', 'dup'] }],
    })

    expect(flowMidpointOf(flowOf(config, 'f1'), config.anchors)).toBeNull()
  })
})
