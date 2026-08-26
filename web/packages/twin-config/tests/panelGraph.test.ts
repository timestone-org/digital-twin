/**
 * @fileoverview 信息牌图形字段的取数语义：哪些画法吃量程、读数落在量程的几成、
 * 读数命中哪一档色。
 *
 * ⚠ 这一份口径被渲染层、编辑器与配置体检三处共用。三处各算各的时界面上一切正常，
 * 只是编辑器里核对过的阈值到了大屏上换了一档颜色，而没有任何一处报错。
 */
import { describe, expect, it } from 'vitest'

import {
  panelFieldRatio,
  panelFieldSpan,
  panelFieldTone,
  panelKindUsesRange,
  panelKindUsesSeries,
} from '../src/panelGraph'
import type { TwinPanelField, TwinPanelLevel } from '../src/types'

function field(overrides: Partial<TwinPanelField> = {}): TwinPanelField {
  return {
    key: 'f1',
    label: '温度',
    unit: '℃',
    prefix: '',
    decimals: null,
    staticText: '',
    kind: 'bar',
    min: 0,
    max: 100,
    levels: [],
    ...overrides,
  }
}

function level(at: number, tone: TwinPanelLevel['tone']): TwinPanelLevel {
  return { id: `l-${at}`, at, tone }
}

describe('画法要什么', () => {
  it('进度条、仪表、趋势线与柱群吃量程，其余不吃', () => {
    expect(panelKindUsesRange('bar')).toBe(true)
    expect(panelKindUsesRange('gauge')).toBe(true)
    expect(panelKindUsesRange('sparkline')).toBe(true)
    expect(panelKindUsesRange('bars')).toBe(true)
    expect(panelKindUsesRange('text')).toBe(false)
    expect(panelKindUsesRange('hero')).toBe(false)
    expect(panelKindUsesRange('dot')).toBe(false)
    expect(panelKindUsesRange('delta')).toBe(false)
  })

  // ⚠ 只有这两档该攒序列：别的画法也攒的话，几十张牌各挂一个白攒的数组
  it('只有趋势线与柱群攒历史序列', () => {
    expect(panelKindUsesSeries('sparkline')).toBe(true)
    expect(panelKindUsesSeries('bars')).toBe(true)
    expect(panelKindUsesSeries('bar')).toBe(false)
    expect(panelKindUsesSeries('gauge')).toBe(false)
  })
})

describe('量程', () => {
  it('跨度是上限减下限', () => {
    expect(panelFieldSpan(field({ min: 20, max: 80 }))).toBe(60)
  })

  // ⚠ 上限不大于下限时画出来的图形是骗人的，宁可让调用方退回纯文本
  it('上限不大于下限时没有跨度', () => {
    expect(panelFieldSpan(field({ min: 50, max: 50 }))).toBeNull()
    expect(panelFieldSpan(field({ min: 80, max: 20 }))).toBeNull()
  })

  it('读数按量程归一到 0–1', () => {
    expect(panelFieldRatio(field({ min: 0, max: 200 }), 50)).toBe(0.25)
    expect(panelFieldRatio(field({ min: 20, max: 40 }), 30)).toBe(0.5)
  })

  // ⚠ 越界不夹的话进度条会画到卡片外面去，那看着像版式坏了，不像「这个量超了」
  it('超量程夹到两端，不越界', () => {
    expect(panelFieldRatio(field(), 500)).toBe(1)
    expect(panelFieldRatio(field(), -500)).toBe(0)
  })

  it('量程画不出来或读数取不到时给 null', () => {
    expect(panelFieldRatio(field({ min: 9, max: 9 }), 9)).toBeNull()
    expect(panelFieldRatio(field(), Number.NaN)).toBeNull()
    expect(panelFieldRatio(field(), undefined)).toBeNull()
    expect(panelFieldRatio(field(), '不是数')).toBeNull()
  })

  // ⚠ 后端的精确小数是字符串，按字符串比较会让 "9" 排在 "80" 后面
  it('字符串数值照样算得出占比', () => {
    expect(panelFieldRatio(field(), '25')).toBe(0.25)
  })
})

describe('阈值档', () => {
  it('没配阈值时不换色', () => {
    expect(panelFieldTone(field(), 99)).toBeNull()
  })

  it('没到任何一档时不换色', () => {
    expect(
      panelFieldTone(field({ levels: [level(80, 'danger')] }), 20),
    ).toBeNull()
  })

  it('到了就换成那一档的色', () => {
    const built = field({ levels: [level(60, 'warning'), level(80, 'danger')] })
    expect(panelFieldTone(built, 70)).toBe('warning')
    expect(panelFieldTone(built, 90)).toBe('danger')
  })

  it('阈值取的是「大于等于」，正好等于也算命中', () => {
    expect(panelFieldTone(field({ levels: [level(60, 'warning')] }), 60)).toBe(
      'warning',
    )
  })

  // ⚠ 取第一个满足的会让这份配置永远显示预警色：两行数字并排摆着看不出问题
  it('危险档写在预警档前面时，超危险线的读数仍是危险色', () => {
    const built = field({ levels: [level(80, 'danger'), level(60, 'warning')] })

    expect(panelFieldTone(built, 90)).toBe('danger')
    expect(panelFieldTone(built, 70)).toBe('warning')
  })

  it('读数取不到时不换色', () => {
    const built = field({ levels: [level(0, 'danger')] })
    expect(panelFieldTone(built, Number.NaN)).toBeNull()
    expect(panelFieldTone(built, undefined)).toBeNull()
  })
})
