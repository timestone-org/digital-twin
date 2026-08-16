/**
 * @fileoverview 守「哪些实体该有坐标轴手柄」：三类有位置的给、其余不给，
 * 信息牌锚定生效时不给（拖了没反应），锚点被删之后反而要给。
 */
import { describe, expect, it } from 'vitest'

import { gizmoTargetOf } from '../src/gizmoTarget'
import { normalizeTwinConfig } from '../src/normalize'
import type { TwinConfig } from '../src/types'

function config(overrides: Record<string, unknown> = {}): TwinConfig {
  return normalizeTwinConfig({
    anchors: [{ id: 'a1', name: '出口', position: [1, 2, 3] }],
    arrows: [{ id: 'r1', position: [4, 5, 6], direction: [0, 0, 1] }],
    panels: [{ id: 'n1', position: [7, 8, 9] }],
    parts: [{ id: 'p1', name: '泵', nodes: ['pump'] }],
    cameras: [{ id: 'c1', position: [1, 1, 1], target: [0, 0, 0] }],
    flows: [{ id: 'f1' }],
    hierNodes: [{ id: 'h1', name: '车间' }],
    ...overrides,
  })
}

describe('给手柄的三类', () => {
  it('锚点：给出位置，没有朝向', () => {
    const target = gizmoTargetOf(config(), { kind: 'anchors', id: 'a1' })

    expect(target).toEqual({
      kind: 'anchors',
      id: 'a1',
      position: [1, 2, 3],
      direction: null,
    })
  })

  it('箭头：位置与朝向都给，朝向要能转', () => {
    const target = gizmoTargetOf(config(), { kind: 'arrows', id: 'r1' })

    expect(target?.position).toEqual([4, 5, 6])
    expect(target?.direction).toEqual([0, 0, 1])
  })

  it('没锚定的信息牌：给位置', () => {
    const target = gizmoTargetOf(config(), { kind: 'panels', id: 'n1' })

    expect(target?.position).toEqual([7, 8, 9])
    expect(target?.direction).toBeNull()
  })
})

describe('不给手柄的情况', () => {
  // ⚠ 锚定生效时位置由锚点定，给手柄就是给一个拖了没反应的东西
  it('信息牌锚定到一个存在的锚点时不给', () => {
    const settings = config({
      panels: [{ id: 'n1', position: [7, 8, 9], anchorId: 'a1' }],
    })

    expect(gizmoTargetOf(settings, { kind: 'panels', id: 'n1' })).toBeNull()
  })

  // 锚点被删之后 position 反而是生效的那一份
  it('信息牌锚定的锚点已被删时照给', () => {
    const settings = config({
      panels: [{ id: 'n1', position: [7, 8, 9], anchorId: 'ghost' }],
    })

    expect(
      gizmoTargetOf(settings, { kind: 'panels', id: 'n1' })?.position,
    ).toEqual([7, 8, 9])
  })

  it('部件靠模型节点定位，没有自己的位置', () => {
    expect(gizmoTargetOf(config(), { kind: 'parts', id: 'p1' })).toBeNull()
  })

  it('视点的位置由「取当前机位」写，不给拖', () => {
    expect(gizmoTargetOf(config(), { kind: 'cameras', id: 'c1' })).toBeNull()
  })

  it('能流走途经锚点，没有自己的位置', () => {
    expect(gizmoTargetOf(config(), { kind: 'flows', id: 'f1' })).toBeNull()
  })

  it('钻取节点没有位置', () => {
    expect(gizmoTargetOf(config(), { kind: 'hierNodes', id: 'h1' })).toBeNull()
  })

  it('三个单例段没有 id，一律不给', () => {
    expect(gizmoTargetOf(config(), { kind: 'model' })).toBeNull()
    expect(gizmoTargetOf(config(), { kind: 'viewpoints' })).toBeNull()
    expect(gizmoTargetOf(config(), { kind: 'roam' })).toBeNull()
  })

  it('没有选中时不给', () => {
    expect(gizmoTargetOf(config(), null)).toBeNull()
  })

  it('id 指向一个已删实体时不给，不摆一个悬空的手柄', () => {
    expect(gizmoTargetOf(config(), { kind: 'anchors', id: 'ghost' })).toBeNull()
    expect(gizmoTargetOf(config(), { kind: 'arrows', id: 'ghost' })).toBeNull()
    expect(gizmoTargetOf(config(), { kind: 'panels', id: 'ghost' })).toBeNull()
  })
})
