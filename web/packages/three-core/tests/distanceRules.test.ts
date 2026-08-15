/**
 * @fileoverview 按相机距离求显隐、淡出与点击门禁。
 *
 * ⚠ 这一层守着两个**方向相反**的兜底：显隐算不出距离时不隐藏，点击算不出距离
 * 时照样放行。统一成一个的话，总有一边会在「算不出来」时做出不可解释的行为——
 * 被错误隐藏的元素既看不见也无从追查，被错误挡掉的点击则表现为「点了没反应」。
 */
import type {
  TwinClickDistanceRule,
  TwinDistanceRef,
  TwinVisibilityRule,
} from '@dt/twin-config'
import { describe, expect, it } from 'vitest'

import {
  resolveClickGate,
  resolveVisibility,
} from '../src/distanceRules'

/** 三种参考系各给一个不同的距离，好验出用错参考系。 */
function distances(
  over: Partial<Record<TwinDistanceRef, number | null>> = {},
) {
  const table: Record<TwinDistanceRef, number | null> = {
    orbit: 10,
    self: 20,
    'part-center': 30,
    ...over,
  }
  return (ref: TwinDistanceRef): number | null => table[ref]
}

function rule(over: Partial<TwinVisibilityRule> = {}): TwinVisibilityRule {
  return {
    visible: true,
    hideBelow: null,
    hideAbove: null,
    fade: null,
    ...over,
  }
}

function clickRule(
  over: Partial<TwinClickDistanceRule> = {},
): TwinClickDistanceRule {
  return { min: null, max: null, farThreshold: null, ...over }
}

describe('显隐', () => {
  it('作者直接关掉的，距离再合适也不显示', () => {
    expect(resolveVisibility(rule({ visible: false }), distances()).visible).toBe(
      false,
    )
  })

  it('一条规则都没配时完全显示', () => {
    expect(resolveVisibility(rule(), distances())).toEqual({
      visible: true,
      opacity: 1,
    })
  })

  it('近于阈值时隐藏', () => {
    const near = rule({ hideBelow: { ref: 'orbit', value: 15 } })

    expect(resolveVisibility(near, distances()).visible).toBe(false)
  })

  it('远于阈值时隐藏', () => {
    const far = rule({ hideAbove: { ref: 'orbit', value: 5 } })

    expect(resolveVisibility(far, distances()).visible).toBe(false)
  })

  it('刚好等于阈值时不隐藏，两边都是严格比较', () => {
    const below = rule({ hideBelow: { ref: 'orbit', value: 10 } })
    const above = rule({ hideAbove: { ref: 'orbit', value: 10 } })

    expect(resolveVisibility(below, distances()).visible).toBe(true)
    expect(resolveVisibility(above, distances()).visible).toBe(true)
  })

  // 同一个「20」在三种参考系下是三个位置，用错参考系不会报错、只是判错
  it('按规则自带的参考系取距离，不是随便挑一个', () => {
    const bySelf = rule({ hideAbove: { ref: 'self', value: 15 } })
    const byOrbit = rule({ hideAbove: { ref: 'orbit', value: 15 } })

    expect(resolveVisibility(bySelf, distances()).visible).toBe(false)
    expect(resolveVisibility(byOrbit, distances()).visible).toBe(true)
  })

  it('两条阈值可以各用各的参考系', () => {
    const mixed = rule({
      hideBelow: { ref: 'orbit', value: 5 },
      hideAbove: { ref: 'part-center', value: 25 },
    })

    expect(resolveVisibility(mixed, distances()).visible).toBe(false)
  })

  // ⚠ 反过来做的话，模型还没加载完的那几帧里所有元素会先闪一下不见
  it('距离取不到时不隐藏', () => {
    const near = rule({ hideBelow: { ref: 'orbit', value: 999 } })

    expect(
      resolveVisibility(near, distances({ orbit: null })).visible,
    ).toBe(true)
  })

  it('距离是 NaN 时同样不隐藏', () => {
    const near = rule({ hideBelow: { ref: 'orbit', value: 999 } })

    expect(
      resolveVisibility(near, distances({ orbit: Number.NaN })).visible,
    ).toBe(true)
  })

  // 「没配」是 null；配成 0 就按字面走，这正是契约里说的「后者永不成立」
  it('hideBelow 配成 0 永不成立，而不是当成没配', () => {
    const zero = rule({ hideBelow: { ref: 'orbit', value: 0 } })

    expect(resolveVisibility(zero, distances()).visible).toBe(true)
  })
})

describe('淡出', () => {
  it('近处淡出：近于阈值时用配的不透明度', () => {
    const faded = rule({
      fade: { at: { ref: 'orbit', value: 15 }, direction: 'below', opacity: 0.2 },
    })

    expect(resolveVisibility(faded, distances())).toEqual({
      visible: true,
      opacity: 0.2,
    })
  })

  it('远处淡出：远于阈值时用配的不透明度', () => {
    const faded = rule({
      fade: { at: { ref: 'orbit', value: 5 }, direction: 'above', opacity: 0.3 },
    })

    expect(resolveVisibility(faded, distances()).opacity).toBe(0.3)
  })

  it('不在淡出那一侧时完全不透明', () => {
    const faded = rule({
      fade: { at: { ref: 'orbit', value: 5 }, direction: 'below', opacity: 0.2 },
    })

    expect(resolveVisibility(faded, distances()).opacity).toBe(1)
  })

  it('已经被隐藏的元素不再谈淡出', () => {
    const both = rule({
      hideAbove: { ref: 'orbit', value: 5 },
      fade: { at: { ref: 'orbit', value: 5 }, direction: 'above', opacity: 0.3 },
    })

    expect(resolveVisibility(both, distances()).visible).toBe(false)
  })

  it('淡出阈值的距离取不到时按不淡出', () => {
    const faded = rule({
      fade: { at: { ref: 'self', value: 999 }, direction: 'below', opacity: 0 },
    })

    expect(
      resolveVisibility(faded, distances({ self: null })).opacity,
    ).toBe(1)
  })

  // ⚠ NaN 进了 opacity 会让整块画面消失，且没有任何报错
  it('不透明度是 NaN 时退回不透明', () => {
    const faded = rule({
      fade: {
        at: { ref: 'orbit', value: 15 },
        direction: 'below',
        opacity: Number.NaN,
      },
    })

    expect(resolveVisibility(faded, distances()).opacity).toBe(1)
  })

  it('不透明度超出 0..1 时夹回来', () => {
    const over = rule({
      fade: { at: { ref: 'orbit', value: 15 }, direction: 'below', opacity: 5 },
    })
    const under = rule({
      fade: { at: { ref: 'orbit', value: 15 }, direction: 'below', opacity: -2 },
    })

    expect(resolveVisibility(over, distances()).opacity).toBe(1)
    expect(resolveVisibility(under, distances()).opacity).toBe(0)
  })
})

describe('点击门禁', () => {
  it('什么都没配时放行', () => {
    expect(resolveClickGate(clickRule(), distances())).toBe('allow')
  })

  it('近于 min 时挡掉', () => {
    const gate = clickRule({ min: { ref: 'orbit', value: 15 } })

    expect(resolveClickGate(gate, distances())).toBe('block')
  })

  it('远于 max 时挡掉', () => {
    const gate = clickRule({ max: { ref: 'orbit', value: 5 } })

    expect(resolveClickGate(gate, distances())).toBe('block')
  })

  it('远于分界时先拉近，不算真点击', () => {
    const gate = clickRule({ farThreshold: { ref: 'orbit', value: 5 } })

    expect(resolveClickGate(gate, distances())).toBe('approach')
  })

  it('近于分界时是真点击', () => {
    const gate = clickRule({ farThreshold: { ref: 'orbit', value: 50 } })

    expect(resolveClickGate(gate, distances())).toBe('allow')
  })

  // 挡掉优先于拉近：连点都不该响应的距离，拉近了也还是不该响应
  it('既超出 max 又超出分界时是挡掉，不是拉近', () => {
    const gate = clickRule({
      max: { ref: 'orbit', value: 5 },
      farThreshold: { ref: 'orbit', value: 5 },
    })

    expect(resolveClickGate(gate, distances())).toBe('block')
  })

  // ⚠ 误挡一次点击的表现是「点了没反应」，用户找不到原因也没法自行恢复
  it('阈值 ≤ 0 一律不限制', () => {
    const zero = clickRule({
      min: { ref: 'orbit', value: 0 },
      max: { ref: 'orbit', value: -1 },
    })

    expect(resolveClickGate(zero, distances())).toBe('allow')
  })

  it('距离取不到时一律放行', () => {
    const gate = clickRule({ max: { ref: 'part-center', value: 1 } })

    expect(
      resolveClickGate(gate, distances({ 'part-center': null })),
    ).toBe('allow')
  })

  it('距离是 NaN 时同样放行', () => {
    const gate = clickRule({ max: { ref: 'part-center', value: 1 } })

    expect(
      resolveClickGate(gate, distances({ 'part-center': Number.NaN })),
    ).toBe('allow')
  })
})
