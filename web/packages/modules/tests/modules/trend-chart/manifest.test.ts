/**
 * @fileoverview 守趋势曲线清单的声明：分段名只用图表族那八个、枚举档位取自本模块
 * 那三张取值表而不是手抄、时间轴上没有的那个类目抽稀旋钮真的没摆出来、右轴名只在
 * 双轴开着时出现、两个子槽逐字对上且一个都不给 isRequired、历史序列那一槽自报时序、
 * 行钉在配置里的系列上，以及三个状态与交互开关的取值。
 *
 * ⚠ 这几类错法 typecheck 与 lint 双双放行，表现只是「这一项永远没反应」：
 * `when` 指错键那个字段永远不出现，`isRequired` 会让整块被浮层盖住、逐条四档白画，
 * 漏了 `isTimeSeries` 那一槽压根不会有人去取历史序列。
 */
import type { BindingSpec, ConfigField } from '@dt/contracts'
import { describe, expect, it } from 'vitest'

import manifest from '../../../src/modules/trend-chart/manifest'
import {
  TREND_AXES,
  TREND_LINE_TYPES,
  TREND_STYLES,
} from '../../../src/modules/trend-chart/options'
import { TREND_CHART_PRESETS } from '../../../src/modules/trend-chart/presets'
import {
  historyFieldKey,
  latestFieldKey,
  SERIES_HISTORY_FIELD,
  SERIES_ITEMS_KEY,
  SERIES_LATEST_FIELD,
  SERIES_SLOT_KEY,
  TREND_EMPTY_TEXT,
} from '../../../src/modules/trend-chart/series'
import { GROUP } from '../../../src/shared/chart/chart-config'

const SCHEMA = manifest.configSchema
const TOP_KEYS = SCHEMA.map((item) => item.key)

function field(key: string): ConfigField | undefined {
  return SCHEMA.find((item) => item.key === key)
}

function itemFields(): readonly ConfigField[] {
  return field(SERIES_ITEMS_KEY)?.itemSchema ?? []
}

function itemField(key: string): ConfigField | undefined {
  return itemFields().find((item) => item.key === key)
}

function optionValues(target: ConfigField | undefined): unknown[] {
  return (target?.options ?? []).map((option) => option.value)
}

function slot(): BindingSpec | undefined {
  return manifest.bindings.find((spec) => spec.key === SERIES_SLOT_KEY)
}

describe('身份与出厂形状', () => {
  it('类型与目录名逐字相等，图标是仓里已有的那一个', () => {
    expect(manifest.type).toBe('trend-chart')
    expect(manifest.icon).toBe('chart-line')
    expect(manifest.category).toBe('图表')
  })

  it('初始尺寸用本仓那四个键，不是参考仓的 w/h', () => {
    expect(manifest.defaultSize).toEqual({
      width: 520,
      height: 300,
      minWidth: 220,
      minHeight: 160,
    })
  })

  it('描述交代了窗口不在配置里与末值接不接得上这两条坑', () => {
    const text = manifest.description ?? ''

    expect(text.length).toBeGreaterThanOrEqual(60)
    expect(text).toContain('取数窗口不在这份配置里')
    expect(text).toContain('严格晚于')
  })

  it('内容键就是标题、系列、空态与右轴名那四个', () => {
    expect(manifest.contentKeys).toEqual([
      'title',
      SERIES_ITEMS_KEY,
      'emptyText',
      'rightAxisName',
    ])
  })

  it('预设整套挂在清单上，画布演示只提清单里有的键', () => {
    expect(manifest.configPresets).toBe(TREND_CHART_PRESETS)
    expect(Object.keys(manifest.preview?.config ?? {})).toEqual([
      SERIES_ITEMS_KEY,
    ])
    expect(Object.keys(manifest.preview?.values ?? {})).toEqual([
      SERIES_SLOT_KEY,
    ])
  })

  it('演示值里两个键都给：设计态只给序列的话整条会被判成还没绑', () => {
    const rows = manifest.preview?.values?.[SERIES_SLOT_KEY]
    const first: unknown = Array.isArray(rows) ? rows[0] : undefined
    const keys = Object.keys(
      typeof first === 'object' && first !== null ? first : {},
    )

    expect(keys).toEqual([SERIES_HISTORY_FIELD, 'seriesPoints'])
  })
})

describe('配置面', () => {
  it('分段名只用图表族定死的那几个', () => {
    const groups = new Set(SCHEMA.map((item) => item.group))
    const allowed = new Set<string | undefined>(Object.values(GROUP))

    expect([...groups].filter((name) => !allowed.has(name))).toEqual([])
  })

  it('三组枚举的档位都取自本模块的取值表，不手抄', () => {
    expect(optionValues(field('chartStyle'))).toEqual(
      TREND_STYLES.map((item) => item.value),
    )
    expect(optionValues(itemField('axis'))).toEqual(
      TREND_AXES.map((item) => item.value),
    )
    expect(optionValues(itemField('lineType'))).toEqual(
      TREND_LINE_TYPES.map((item) => item.value),
    )
  })

  it('时间轴上没有类目抽稀这回事，那一项没摆出来', () => {
    expect(TOP_KEYS).not.toContain('xLabelInterval')
    expect(TOP_KEYS).toContain('yScale')
    expect(TOP_KEYS).toContain('boundaryGap')
  })

  it('数值轴缺省不强制含 0，类目两端缺省不留白', () => {
    expect(field('yScale')?.default).toBe(true)
    expect(field('boundaryGap')?.default).toBe(false)
  })

  it('面积那四项只在带面积的两档上出现', () => {
    const area = SCHEMA.filter((item) => item.key.startsWith('area'))

    expect(area.map((item) => item.key)).toEqual([
      'areaGradient',
      'areaGradientTo',
      'areaTopAlpha',
      'areaOpacity',
    ])
    expect(area.every((item) => item.when?.key === 'chartStyle')).toBe(true)
    expect(area[0]?.when?.in).toEqual(['area', 'stackedArea'])
  })

  it('右轴名只在双轴开着时出现', () => {
    expect(field('rightAxisName')?.when).toEqual({
      key: 'dualAxis',
      in: [true],
    })
  })

  it('图例缺省开着，数据标签缺省关着，数据点缺省不画', () => {
    expect(field('showLegend')?.default).toBe(true)
    expect(field('showValueLabel')?.default).toBe(false)
    expect(field('showSymbol')?.default).toBe(false)
  })

  it('空态文案与逐条小数位的缺省：一个有兜底，一个刻意留空', () => {
    expect(field('emptyText')?.default).toBe(TREND_EMPTY_TEXT)
    expect(itemField('precision')?.default).toBeUndefined()
    expect(itemField('precision')?.max).toBe(6)
  })

  it('参考线摆在参考线那一段，缺省不画', () => {
    expect(field('refLines')?.group).toBe(GROUP.refLine)
    expect(field('refLines')?.default).toEqual([])
  })
})

describe('绑定槽', () => {
  it('唯一的数组槽有两个子槽，槽键与取值层拼的逐字相同', () => {
    expect(manifest.bindings).toHaveLength(1)
    expect(slot()?.arrayFields?.map((item) => item.key)).toEqual([
      SERIES_HISTORY_FIELD,
      SERIES_LATEST_FIELD,
    ])
    expect(historyFieldKey(0)).toBe(
      `${SERIES_SLOT_KEY}[0].${SERIES_HISTORY_FIELD}`,
    )
    expect(latestFieldKey(0)).toBe(
      `${SERIES_SLOT_KEY}[0].${SERIES_LATEST_FIELD}`,
    )
  })

  it('历史序列那一槽自报时序，实时末值那一槽不报', () => {
    const fields = slot()?.arrayFields ?? []

    expect(fields[0]?.isTimeSeries).toBe(true)
    expect(fields[1]?.isTimeSeries).toBeUndefined()
  })

  it('行钉在配置里的系列上，且一个子槽都不给 isRequired', () => {
    expect(slot()?.isArray).toBe(true)
    expect(slot()?.isEntityPinned).toBe(true)
    expect(
      (slot()?.arrayFields ?? []).filter((item) => item.isRequired === true),
    ).toEqual([])
  })

  it('行数与行标题都跟着配置里的系列走', () => {
    const config = { [SERIES_ITEMS_KEY]: [{ name: '甲' }, { name: '乙' }] }

    expect(manifest.bindingRowCounts?.(config)).toEqual({
      [SERIES_SLOT_KEY]: 2,
    })
    expect(manifest.bindingRowLabels?.(config)[historyFieldKey(1)]).toEqual({
      title: '乙',
      id: '乙',
    })
  })
})

describe('状态与交互', () => {
  it('逐条状态归模块自己画，整格浮层因此不出', () => {
    expect(manifest.ownsStatusDisplay).toBe(true)
  })

  it('只开图元上抛，不开整块可点', () => {
    expect(manifest.emitsInteractions).toBe(true)
    expect(manifest.hostClickable).toBeUndefined()
  })
})
