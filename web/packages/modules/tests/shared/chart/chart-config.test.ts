/**
 * @fileoverview 守 configSchema 片段工厂：缺省值是全部存量大屏的渲染兜底，改一个就
 * 整批跟着变；没有条件时不许写出 `when` 键（写了 undefined 面板会当成一条永假的条件）；
 * 字段顺序由工厂定死，不随调用方 include 的书写顺序漂；紧凑控件逐个带 `span`。
 */
import type { ConfigField } from '@dt/contracts'
import { describe, expect, it } from 'vitest'

import {
  GROUP,
  animationFields,
  axisIntervalFields,
  cartesianAxisFields,
  chartFontFields,
  chartStyleField,
  dataLabelFields,
  dataZoomFields,
  gradientFields,
  legendFields,
  markLineFields,
  paletteOverrideField,
  symbolFields,
  titleField,
  tooltipFields,
  unitPrecisionFields,
} from '../../../src/shared/chart/chart-config'

const WHEN = { key: 'chartStyle', in: ['line'] }

/**
 * 形状天生占整行、缺 `span` 是对的那几档，逐字抄自清单侧那条闸门
 * （`tests/manifests.contract.spec.ts` 的 `WIDE_FIELD_TYPES`）。
 */
const WIDE_FIELD_TYPES = new Set<ConfigField['type']>([
  'array',
  'object',
  'textarea',
  'image',
  'json',
  'font',
  'style',
  'dashboard-ref',
])

/**
 * 全部工厂的产物摊平成一张表。
 * ⚠ 只摊顶层，不进 `itemSchema`：闸门就是这个口径，且 `ArrayControl` 根本不读子字段的
 * `span`，摊深了等于给未来的行内字段凭空加一条谁也不执行的约束。
 */
const ALL_TOP_FIELDS: readonly ConfigField[] = [
  ...titleField(),
  ...chartStyleField([{ value: 'line', label: '折线' }]),
  ...legendFields(),
  ...tooltipFields(),
  ...dataLabelFields(),
  ...cartesianAxisFields(),
  ...unitPrecisionFields(),
  ...dataZoomFields(),
  ...animationFields(),
  ...paletteOverrideField(),
  ...gradientFields(),
  ...markLineFields(),
  ...axisIntervalFields(),
  ...symbolFields(),
  ...chartFontFields(),
]

function keysOf(fields: readonly ConfigField[]): string[] {
  return fields.map((field) => field.key)
}

function byKey(fields: readonly ConfigField[], key: string): ConfigField {
  const found = fields.find((field) => field.key === key)
  if (!found) throw new Error(`没有产出 ${key} 字段`)
  return found
}

describe('titleField', () => {
  it('落在数据分段，缺省空串', () => {
    const [field] = titleField()

    expect(field).toMatchObject({
      key: 'title',
      type: 'string',
      default: '',
      group: GROUP.data,
      placeholder: '留空隐藏标题栏',
    })
  })

  it('占位文案可覆盖', () => {
    expect(titleField({ placeholder: '大屏名' })[0]?.placeholder).toBe('大屏名')
  })
})

describe('chartStyleField', () => {
  it('固定落在 chartStyle 键与样式分段', () => {
    const [field] = chartStyleField([{ value: 'line', label: '折线' }])

    expect(field).toMatchObject({ key: 'chartStyle', group: GROUP.style })
  })

  it('不给缺省时取第一项', () => {
    const [field] = chartStyleField([
      { value: 'line', label: '折线' },
      { value: 'bar', label: '柱状' },
    ])

    expect(field?.default).toBe('line')
  })

  it('给了缺省以它为准', () => {
    const [field] = chartStyleField([{ value: 'line', label: '折线' }], 'bar')

    expect(field?.default).toBe('bar')
  })
})

describe('开关类字段的缺省', () => {
  it('图例缺省关——存量大屏不该突然多出一块图例', () => {
    expect(legendFields()[0]?.default).toBe(false)
    expect(legendFields({ default: true })[0]?.default).toBe(true)
  })

  it('提示框缺省开', () => {
    expect(tooltipFields()[0]).toMatchObject({
      key: 'showTooltip',
      default: true,
      group: GROUP.tooltip,
    })
  })

  it('数值标签缺省开', () => {
    expect(dataLabelFields()[0]?.default).toBe(true)
    expect(dataLabelFields({ default: false })[0]?.default).toBe(false)
  })

  it('缩放条缺省关', () => {
    expect(dataZoomFields()[0]).toMatchObject({
      key: 'showDataZoom',
      default: false,
    })
  })
})

describe('when 的写法', () => {
  it('没有条件时不写这个键', () => {
    expect('when' in (legendFields()[0] ?? {})).toBe(false)
    expect('when' in (tooltipFields()[0] ?? {})).toBe(false)
    expect('when' in (paletteOverrideField()[0] ?? {})).toBe(false)
  })

  it('给了条件就逐个字段挂上', () => {
    const fields = cartesianAxisFields({ when: WHEN })

    expect(fields.every((field) => field.when === WHEN)).toBe(true)
  })
})

describe('unitPrecisionFields', () => {
  it('小数位钳在面板契约的 [0,6] 上', () => {
    const precision = byKey(unitPrecisionFields(), 'precision')

    expect(precision).toMatchObject({ min: 0, max: 6, step: 1 })
  })

  it('单位缺省空串', () => {
    expect(byKey(unitPrecisionFields(), 'unit').default).toBe('')
  })
})

describe('animationFields', () => {
  it('缺省关，并附一个只在开了动画时可见的时长字段', () => {
    const fields = animationFields()

    expect(keysOf(fields)).toEqual(['animation', 'animationDuration'])
    expect(byKey(fields, 'animation').default).toBe(false)
    expect(byKey(fields, 'animationDuration')).toMatchObject({
      default: 600,
      when: { key: 'animation', in: [true] },
    })
  })

  it('宿主自己定时长时只出开关，免得面板上摆个配了没反应的旋钮', () => {
    expect(keysOf(animationFields({ duration: false }))).toEqual(['animation'])
  })
})

describe('paletteOverrideField', () => {
  it('缺省空数组，每行只有一个颜色子字段', () => {
    const [field] = paletteOverrideField()

    expect(field).toMatchObject({ key: 'palette', type: 'array', default: [] })
    expect(field?.itemSchema).toEqual([
      { key: 'color', label: '颜色', type: 'color' },
    ])
  })
})

describe('gradientFields', () => {
  it('缺省按 area 前缀产出四项，顺序固定', () => {
    expect(keysOf(gradientFields())).toEqual([
      'areaGradient',
      'areaGradientTo',
      'areaTopAlpha',
      'areaOpacity',
    ])
  })

  it('前缀与标签可换，空前缀产出裸 key', () => {
    const bar = gradientFields({ prefix: 'bar', label: '柱体' })

    expect(keysOf(bar)).toContain('barGradient')
    expect(byKey(bar, 'barGradient').label).toBe('柱体渐变')
    expect(keysOf(gradientFields({ prefix: '' }))).toContain('gradient')
  })

  it('include 只裁剪、不改顺序', () => {
    const fields = gradientFields({ include: ['opacity', 'gradient'] })

    expect(keysOf(fields)).toEqual(['areaGradient', 'areaOpacity'])
  })

  it('缺省渐变关、末端色留空、透明度两档各有定值', () => {
    const fields = gradientFields()

    expect(byKey(fields, 'areaGradient').default).toBe(false)
    expect(byKey(fields, 'areaGradientTo').default).toBe('')
    expect(byKey(fields, 'areaTopAlpha').default).toBe(0.3)
    expect(byKey(fields, 'areaOpacity').default).toBe(0.18)
  })

  it('两档透明度的缺省可逐族覆盖', () => {
    const fields = gradientFields({ topAlpha: 0.25, opacity: 0.35 })

    expect(byKey(fields, 'areaTopAlpha').default).toBe(0.25)
    expect(byKey(fields, 'areaOpacity').default).toBe(0.35)
  })

  it('覆盖某一族的缺省不会串到下一次调用', () => {
    gradientFields({ topAlpha: 0.9 })

    expect(byKey(gradientFields(), 'areaTopAlpha').default).toBe(0.3)
  })
})

describe('markLineFields', () => {
  it('缺省不画任何参考线，行标题取文字列', () => {
    const [field] = markLineFields()

    expect(field).toMatchObject({
      key: 'refLines',
      type: 'array',
      default: [],
      group: GROUP.refLine,
      itemLabelKey: 'label',
    })
  })

  it('行内字段与 markLineRef 的入参一一对应', () => {
    const [field] = markLineFields()

    expect(keysOf(field?.itemSchema ?? [])).toEqual([
      'value',
      'label',
      'color',
      'lineType',
      'fontSize',
    ])
  })

  it('线型缺省虚线，与数据线区分得开', () => {
    const [field] = markLineFields()
    const lineType = byKey(field?.itemSchema ?? [], 'lineType')

    expect(lineType.default).toBe('dashed')
  })
})

describe('axisIntervalFields', () => {
  it('类目标签间隔是 string——数字控件分不出「留空」与「0」', () => {
    const interval = byKey(axisIntervalFields(), 'xLabelInterval')

    expect(interval).toMatchObject({ type: 'string', default: '' })
  })

  it('缺省值轴从 0 起、类目轴两端留白，两者都可覆盖', () => {
    expect(byKey(axisIntervalFields(), 'yScale').default).toBe(false)
    expect(byKey(axisIntervalFields(), 'boundaryGap').default).toBe(true)

    const folded = axisIntervalFields({ boundaryGap: false, yScale: true })

    expect(byKey(folded, 'boundaryGap').default).toBe(false)
    expect(byKey(folded, 'yScale').default).toBe(true)
  })
})

describe('symbolFields', () => {
  it('缺省显示数据点、大小 6', () => {
    expect(byKey(symbolFields(), 'showSymbol').default).toBe(true)
    expect(byKey(symbolFields(), 'symbolSize').default).toBe(6)
  })

  it('点大小缺省绑在「显示数据点」上', () => {
    expect(byKey(symbolFields(), 'symbolSize').when).toEqual({
      key: 'showSymbol',
      in: [true],
    })
  })

  it('调用方给了条件就以它为准——when 只支持单条件', () => {
    expect(byKey(symbolFields({ when: WHEN }), 'symbolSize').when).toBe(WHEN)
  })
})

describe('chartFontFields', () => {
  it('缺省产出全部七项，顺序固定', () => {
    expect(keysOf(chartFontFields())).toEqual([
      'axisLabelFontSize',
      'axisNameFontSize',
      'legendFontSize',
      'tooltipFontSize',
      'labelFontSize',
      'labelFontFamily',
      'labelColor',
    ])
  })

  it('include 只裁剪、不改顺序', () => {
    const fields = chartFontFields({
      include: ['labelColor', 'legendFontSize'],
    })

    expect(keysOf(fields)).toEqual(['legendFontSize', 'labelColor'])
  })

  it('字号缺省逐项对齐 chartKit 里的取值', () => {
    const fields = chartFontFields()

    expect(byKey(fields, 'axisLabelFontSize').default).toBe(11)
    expect(byKey(fields, 'axisNameFontSize').default).toBe(11)
    expect(byKey(fields, 'legendFontSize').default).toBe(11)
    expect(byKey(fields, 'tooltipFontSize').default).toBe(12)
    expect(byKey(fields, 'labelFontSize').default).toBe(11)
  })

  it('字体档位与仓里真有的字体 token 对齐', () => {
    const family = byKey(chartFontFields(), 'labelFontFamily')

    expect(family.default).toBe('sans')
    expect(family.options?.map((option) => option.value)).toEqual([
      'sans',
      'display',
      'mono',
    ])
  })

  it('挂条件时不改动模板本身', () => {
    chartFontFields({ when: WHEN })

    expect('when' in byKey(chartFontFields(), 'labelColor')).toBe(false)
  })
})

describe('两列栅格的 span', () => {
  it('紧凑控件逐个显式声明了 span，与清单侧那条闸门同口径', () => {
    const offenders = ALL_TOP_FIELDS.filter(
      (field) => !WIDE_FIELD_TYPES.has(field.type) && field.span === undefined,
    ).map((field) => `${field.key}(${field.type})`)

    expect(offenders).toEqual([])
  })

  it('标题独占一行，成对出现的旋钮并排半行', () => {
    expect(byKey(titleField(), 'title').span).toBe('full')
    expect(byKey(unitPrecisionFields(), 'unit').span).toBe('half')
    expect(byKey(unitPrecisionFields(), 'precision').span).toBe('half')
    expect(byKey(cartesianAxisFields(), 'xAxisName').span).toBe('half')
    expect(byKey(cartesianAxisFields(), 'yAxisName').span).toBe('half')
    expect(byKey(animationFields(), 'animation').span).toBe('half')
    expect(byKey(animationFields(), 'animationDuration').span).toBe('half')
    expect(byKey(symbolFields(), 'showSymbol').span).toBe('half')
    expect(byKey(symbolFields(), 'symbolSize').span).toBe('half')
  })

  it('模板产出的那两批也带着 span，裁剪与挂条件都不冲掉它', () => {
    const gradient = gradientFields({ prefix: 'bar', include: ['gradient'] })
    const fonts = chartFontFields({ when: WHEN, include: ['labelColor'] })

    expect(gradient.every((field) => field.span === 'half')).toBe(true)
    expect(fonts.every((field) => field.span === 'half')).toBe(true)
  })
})
