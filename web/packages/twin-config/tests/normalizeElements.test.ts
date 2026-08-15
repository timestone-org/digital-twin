/**
 * @fileoverview 信息牌 / 箭头 / 能量流的归一化与取值对齐。
 *
 * ⚠ 这里守的核心是**扁平化后的文档序**：信息牌的值按「把所有牌的字段摊平之后
 * 的第 i 个」对齐，按「第 i 张牌」对齐会让多字段的牌之后每一行整体错位——
 * 而错位之后每个字段都有值，只是全都接错了对象。
 */
import { describe, expect, it } from 'vitest'

import {
  flattenPanelFields,
  normalizeArrow,
  normalizeFlow,
  normalizePanel,
} from '../src/normalizeElements'
import {
  EMPTY_ARROW_VALUES,
  EMPTY_FLOW_VALUES,
  EMPTY_PANEL_VALUES,
  stitchArrowValues,
  stitchFlowValues,
  stitchPanelValues,
} from '../src/twinMath'
import { normalizeTwinConfig } from '../src/normalize'
import type { TwinArrow, TwinFlowLink, TwinPanel } from '../src/types'

function panel(raw: unknown, index = 0): TwinPanel {
  const built = normalizePanel(raw, index)
  if (built === null) throw new Error('这份输入本该归一出一张信息牌')
  return built
}

function arrow(raw: unknown, index = 0): TwinArrow {
  const built = normalizeArrow(raw, index)
  if (built === null) throw new Error('这份输入本该归一出一个箭头')
  return built
}

function flow(raw: unknown, index = 0): TwinFlowLink {
  const built = normalizeFlow(raw, index)
  if (built === null) throw new Error('这份输入本该归一出一条能量流')
  return built
}

describe('信息牌', () => {
  it('非对象条目丢掉', () => {
    expect(normalizePanel('nope', 0)).toBeNull()
  })

  it('风格缺省是卡片、居中、跟随主题强调色', () => {
    const style = panel({}).style
    expect(style.variant).toBe('card')
    expect(style.orient).toBe('center')
    expect(style.accent).toBe('--accent-primary')
  })

  it('宽度 0 表示自适应，字号缩放有上下限', () => {
    expect(panel({ style: { width: -5 } }).style.width).toBe(0)
    expect(panel({ style: { fontScale: 99 } }).style.fontScale).toBe(3)
    expect(panel({ style: { fontScale: 0 } }).style.fontScale).toBe(0.5)
  })

  it('不认识的变体与朝向都回落到缺省', () => {
    const style = panel({ style: { variant: 'neon', orient: 'diagonal' } }).style
    expect(style.variant).toBe('card')
    expect(style.orient).toBe('center')
  })

  it('字段缺 key 时按下标铸一个', () => {
    const fields = panel({ fields: [{}, { key: 'temp' }] }).fields
    expect(fields.map((item) => item.key)).toEqual(['field-0', 'temp'])
  })

  it('字段小数位四舍五入并夹进上限，取不到即不定位数', () => {
    const fields = panel({
      fields: [{ decimals: '2.6' }, { decimals: 99 }, {}],
    }).fields
    expect(fields.map((item) => item.decimals)).toEqual([3, 10, null])
  })
})

describe('扁平化后的文档序', () => {
  const panels = [
    panel({ id: 'p1', fields: [{ key: 'a' }, { key: 'b' }] }, 0),
    panel({ id: 'p2', fields: [{ key: 'c' }] }, 1),
  ]

  it('按牌、再按牌内字段的顺序摊平', () => {
    expect(flattenPanelFields(panels).map((item) => item.valueKey)).toEqual([
      'p1::a',
      'p1::b',
      'p2::c',
    ])
  })

  // ⚠ 两张牌上都有一个叫 temp 的字段是常事，只用字段 key 会互相覆盖
  it('取值键带上牌 id，重名字段不互相覆盖', () => {
    const same = [
      panel({ id: 'p1', fields: [{ key: 'temp' }] }, 0),
      panel({ id: 'p2', fields: [{ key: 'temp' }] }, 1),
    ]
    const stitched = stitchPanelValues(flattenPanelFields(same), [
      { value: 1 },
      { value: 2 },
    ])
    expect(stitched).toEqual({
      'p1::temp': { value: 1 },
      'p2::temp': { value: 2 },
    })
  })

  it('第 i 行喂给摊平后的第 i 个字段，不是第 i 张牌', () => {
    const stitched = stitchPanelValues(flattenPanelFields(panels), [
      { value: 10 },
      { value: 20 },
      { value: 30 },
    ])
    expect(stitched['p2::c']).toEqual({ value: 30 })
  })

  it('一个值都没有时返回同一个冻结空引用', () => {
    expect(stitchPanelValues(flattenPanelFields(panels), undefined)).toBe(
      EMPTY_PANEL_VALUES,
    )
  })
})

describe('立体箭头', () => {
  // ⚠ 零向量 normalize 出 NaN，整个箭头会从画面上消失
  it('朝向缺省是 +Y，不留一个零向量', () => {
    expect(arrow({}).direction).toEqual([0, 1, 0])
  })

  it('长宽夹进区间，0 与负数画不出东西', () => {
    expect(arrow({ length: 0 }).length).toBe(0.01)
    expect(arrow({ width: -2 }).width).toBe(0.01)
    expect(arrow({ length: 1e6 }).length).toBe(100)
  })

  it('第 i 行喂给文档序第 i 个箭头', () => {
    const arrows = [arrow({ id: 'a1' }, 0), arrow({ id: 'a2' }, 1)]
    expect(stitchArrowValues(arrows, [{ value: 1 }, { value: 2 }])).toEqual({
      a1: { value: 1 },
      a2: { value: 2 },
    })
  })

  it('没有值时返回同一个冻结空引用', () => {
    expect(stitchArrowValues([arrow({ id: 'a1' })], [])).toBe(
      EMPTY_ARROW_VALUES,
    )
  })
})

describe('能量流', () => {
  it('路径锚点去重去空白', () => {
    expect(flow({ pathAnchors: [' a ', 'a', '', 'b'] }).pathAnchors).toEqual([
      'a',
      'b',
    ])
  })

  // 只绑了强度没绑激活是常见配法，要求两个都有会让那条流永远静止
  it('两个子槽有一个有值就产出条目', () => {
    const flows = [flow({ id: 'f1' })]
    expect(stitchFlowValues(flows, [{ intensity: 5 }])).toEqual({
      f1: { intensity: 5, active: undefined },
    })
  })

  it('两个子槽都没有时不产出条目', () => {
    expect(stitchFlowValues([flow({ id: 'f1' })], [{}])).toBe(EMPTY_FLOW_VALUES)
  })

  it('第 i 行喂给文档序第 i 条流', () => {
    const flows = [flow({ id: 'f1' }, 0), flow({ id: 'f2' }, 1)]
    const stitched = stitchFlowValues(flows, [
      { intensity: 1, active: true },
      { intensity: 2, active: false },
    ])
    expect(stitched['f2']).toEqual({ intensity: 2, active: false })
  })
})

describe('三类元素接进整份配置', () => {
  it('非对象条目一并丢掉，幸存者的铸造 id 带原始下标', () => {
    const config = normalizeTwinConfig({
      panels: ['x', {}],
      arrows: [null, {}],
      flows: [3, {}],
    })
    expect(config.panels[0]?.id).toBe('panel-1')
    expect(config.arrows[0]?.id).toBe('arrow-1')
    expect(config.flows[0]?.id).toBe('flow-1')
  })

  it('归一化跑两遍与跑一遍结果相同', () => {
    const once = normalizeTwinConfig({
      panels: [{ fields: [{ key: 'a' }] }],
      arrows: [{ direction: [0, 0, 0] }],
      flows: [{ pathAnchors: ['a', 'b'] }],
    })
    expect(normalizeTwinConfig(once)).toEqual(once)
  })
})
