/**
 * @fileoverview 锁住缝合与派生的两条契约：数组行按文档序对齐成 id 映射，
 * 以及「一个值都没有」时返回同一个冻结空引用（每帧新建空对象会让下游 watch 空转）。
 * 另锁非有限数在读值与格式化两处都被清掉，不许上屏成字面的 "NaN"。
 */
import { describe, expect, it } from 'vitest'

import {
  EMPTY_ANCHOR_VALUES,
  EMPTY_TINT_VALUES,
  formatAnchorText,
  isTintAlarm,
  stitchAnchorValues,
  stitchTintValues,
  tintColorSpec,
  tintTargetNodes,
} from '../src/twinMath'
import { normalizeTwinConfig } from '../src/types'
import type { TwinAnchor, TwinTintRule } from '../src/types'

const CONFIG = normalizeTwinConfig({
  parts: [
    { id: 'p-pump', nodes: ['pump_a', 'pump_b'] },
    { id: 'p-fan', nodes: ['fan', 'pump_b'] },
  ],
  anchors: [
    { id: 'a-in', label: '进口', unit: '℃', decimals: 1 },
    { id: 'a-out', label: '出口' },
  ],
  tints: [
    {
      id: 't-status',
      partIds: ['p-pump', 'p-missing'],
      statusColors: { run: '#0f0', ALARM: '--danger' },
      alarmStatus: ['alarm'],
    },
    {
      id: 't-grad',
      partIds: ['p-pump', 'p-fan'],
      mode: 'gradient',
      gradient: { lo: '#000000', hi: '#ffffff', min: 0, max: 100 },
    },
  ],
})

function tintAt(index: number): TwinTintRule {
  const rule = CONFIG.tints[index]
  if (rule === undefined) throw new Error(`夹具缺第 ${index} 条染色规则`)
  return rule
}

function anchorAt(index: number): TwinAnchor {
  const anchor = CONFIG.anchors[index]
  if (anchor === undefined) throw new Error(`夹具缺第 ${index} 个锚点`)
  return anchor
}

function firstTintOf(raw: unknown): TwinTintRule {
  const rule = normalizeTwinConfig(raw).tints[0]
  if (rule === undefined) throw new Error('夹具缺染色规则')
  return rule
}

describe('stitchTintValues', () => {
  it('第 i 行喂给文档序第 i 条规则', () => {
    expect(
      stitchTintValues(CONFIG.tints, [
        { value: 1, status: 'run' },
        { value: 2, status: 'stop' },
      ]),
    ).toEqual({
      't-status': { value: 1, status: 'run' },
      't-grad': { value: 2, status: 'stop' },
    })
  })

  it('行数少于规则数时后面的规则没有值', () => {
    expect(stitchTintValues(CONFIG.tints, [{ value: 1 }])).toEqual({
      't-status': { value: 1, status: undefined },
    })
  })

  it('多出来的行不产生条目', () => {
    const stitched = stitchTintValues([tintAt(0)], [{ value: 1 }, { value: 2 }])
    expect(Object.keys(stitched)).toEqual(['t-status'])
  })

  it('行不是对象时按无值处理', () => {
    expect(stitchTintValues(CONFIG.tints, ['nope', null])).toBe(
      EMPTY_TINT_VALUES,
    )
  })

  it('非有限数在读值处就被清掉', () => {
    expect(
      stitchTintValues([tintAt(0)], [{ value: Number.NaN, status: 'run' }]),
    ).toEqual({ 't-status': { value: undefined, status: 'run' } })
  })

  it('一个值都没有时返回同一个冻结空引用', () => {
    expect(stitchTintValues(CONFIG.tints, undefined)).toBe(EMPTY_TINT_VALUES)
    expect(stitchTintValues(undefined, [{ value: 1 }])).toBe(EMPTY_TINT_VALUES)
    expect(stitchTintValues(CONFIG.tints, [])).toBe(
      stitchTintValues([], undefined),
    )
  })
})

describe('stitchAnchorValues', () => {
  it('第 i 行喂给文档序第 i 个锚点', () => {
    expect(
      stitchAnchorValues(CONFIG.anchors, [{ value: 25.5 }, { value: 0 }]),
    ).toEqual({ 'a-in': { value: 25.5 }, 'a-out': { value: 0 } })
  })

  it('非有限数在读值处就被清掉，于是该锚点没有条目', () => {
    expect(
      stitchAnchorValues(CONFIG.anchors, [
        { value: Number.POSITIVE_INFINITY },
        { value: 1 },
      ]),
    ).toEqual({ 'a-out': { value: 1 } })
  })

  it('一个值都没有时返回同一个冻结空引用', () => {
    expect(stitchAnchorValues(CONFIG.anchors, undefined)).toBe(
      EMPTY_ANCHOR_VALUES,
    )
    expect(stitchAnchorValues(undefined, undefined)).toBe(EMPTY_ANCHOR_VALUES)
  })
})

describe('tintColorSpec', () => {
  it('状态模式按状态取色', () => {
    expect(tintColorSpec(tintAt(0), { value: null, status: 'run' })).toBe(
      '#00ff00',
    )
  })

  it('状态大小写不同时按小写再找一次', () => {
    expect(tintColorSpec(tintAt(0), { value: null, status: 'ALARM' })).toBe(
      '--danger',
    )
  })

  it('状态表里没有的状态不染色', () => {
    expect(tintColorSpec(tintAt(0), { value: null, status: 'idle' })).toBeNull()
  })

  it('数字与布尔状态按字面找色，表里没有即不染色', () => {
    expect(tintColorSpec(tintAt(0), { value: null, status: 1 })).toBeNull()
    expect(tintColorSpec(tintAt(0), { value: null, status: true })).toBeNull()
  })

  it('缺状态时不染色', () => {
    expect(tintColorSpec(tintAt(0), undefined)).toBeNull()
    expect(tintColorSpec(tintAt(0), { value: 1, status: {} })).toBeNull()
  })

  it('渐变模式按数值在区间内插值', () => {
    expect(tintColorSpec(tintAt(1), { value: 50, status: null })).toBe(
      '#808080',
    )
  })

  it('渐变模式的数值超出区间时夹到两端', () => {
    expect(tintColorSpec(tintAt(1), { value: -10, status: null })).toBe(
      '#000000',
    )
    expect(tintColorSpec(tintAt(1), { value: 999, status: null })).toBe(
      '#ffffff',
    )
  })

  it('渐变模式的数值字符串照样能插值', () => {
    expect(tintColorSpec(tintAt(1), { value: '50', status: null })).toBe(
      '#808080',
    )
  })

  it('渐变模式缺数值时不染色', () => {
    expect(tintColorSpec(tintAt(1), { value: 'x', status: null })).toBeNull()
  })

  it('零宽区间取低端色而不是除零', () => {
    const rule = firstTintOf({
      tints: [
        {
          id: 't',
          mode: 'gradient',
          gradient: { lo: '#000000', hi: '#ffffff', min: 5, max: 5 },
        },
      ],
    })
    expect(tintColorSpec(rule, { value: 5, status: null })).toBe('#000000')
  })

  it('渐变模式缺区间时不染色', () => {
    const rule = firstTintOf({ tints: [{ id: 't', mode: 'gradient' }] })
    expect(tintColorSpec(rule, { value: 5, status: null })).toBeNull()
  })
})

describe('isTintAlarm', () => {
  it('命中告警状态时为真且大小写不敏感', () => {
    expect(isTintAlarm(tintAt(0), { value: null, status: 'ALARM' })).toBe(true)
  })

  it('未命中或没有状态时为假', () => {
    expect(isTintAlarm(tintAt(0), { value: null, status: 'run' })).toBe(false)
    expect(isTintAlarm(tintAt(0), undefined)).toBe(false)
  })

  it('没配告警状态的规则永远不告警', () => {
    expect(isTintAlarm(tintAt(1), { value: null, status: 'alarm' })).toBe(false)
  })
})

describe('tintTargetNodes', () => {
  it('按部件展开并去重', () => {
    expect(tintTargetNodes(CONFIG.parts, tintAt(1))).toEqual([
      'pump_a',
      'pump_b',
      'fan',
    ])
  })

  it('引用不到的部件不产出节点', () => {
    expect(tintTargetNodes(CONFIG.parts, tintAt(0))).toEqual([
      'pump_a',
      'pump_b',
    ])
  })

  it('没有部件时为空', () => {
    expect(tintTargetNodes(undefined, tintAt(0))).toEqual([])
  })
})

describe('formatAnchorText', () => {
  it('前缀、数值、单位三段拼接', () => {
    expect(formatAnchorText(anchorAt(0), 25.46)).toBe('进口 25.5 ℃')
  })

  it('非有限数不上屏，只剩前缀与单位', () => {
    expect(formatAnchorText(anchorAt(0), Number.NaN)).toBe('进口 ℃')
    expect(formatAnchorText(anchorAt(0), Number.NEGATIVE_INFINITY)).toBe(
      '进口 ℃',
    )
  })

  it('缺值时只剩前缀与单位', () => {
    expect(formatAnchorText(anchorAt(0), null)).toBe('进口 ℃')
    expect(formatAnchorText(anchorAt(0), undefined)).toBe('进口 ℃')
  })

  it('不定位数时原样上屏后端的精确小数字符串', () => {
    expect(formatAnchorText(anchorAt(1), ' 12.500 ')).toBe('出口 12.500')
  })

  it('不定位数的数字按原值上屏', () => {
    expect(formatAnchorText(anchorAt(1), 12.5)).toBe('出口 12.5')
  })

  it('非数值文本原样上屏', () => {
    expect(formatAnchorText(anchorAt(1), '停机')).toBe('出口 停机')
  })

  it('布尔读数按字面上屏', () => {
    expect(formatAnchorText(anchorAt(1), true)).toBe('出口 true')
  })

  it('对象读数不上屏', () => {
    expect(formatAnchorText(anchorAt(1), { a: 1 })).toBe('出口')
  })
})
