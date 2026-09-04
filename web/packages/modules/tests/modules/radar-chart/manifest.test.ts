/**
 * @fileoverview 守多维雷达清单的声明：分段名只用图表族那八个、枚举档位取自本模块
 * 那两张取值表而不是手抄、填充浓度只在铺了面的那一档出现、雷达不摆直角坐标轴那两个
 * 轴名、两个子槽逐字对上且一个都不给 isRequired、行钉在配置里的指标上，以及三个
 * 状态与交互开关的取值。
 *
 * ⚠ 这几类错法 typecheck 与 lint 双双放行，表现只是「这一项永远没反应」：
 * `when` 指错键那个字段永远不出现，`isRequired` 会让整块被浮层盖住、逐轴四档白画。
 */
import type { BindingSpec, ConfigField } from '@dt/contracts'
import { describe, expect, it } from 'vitest'

import {
  AXIS_ITEMS_KEY,
  AXIS_SLOT_KEY,
  axisFieldKey,
  COMPARE_NAME_DEFAULT,
  RADAR_EMPTY_TEXT,
  SERIES_NAME_DEFAULT,
} from '../../../src/modules/radar-chart/axes'
import manifest from '../../../src/modules/radar-chart/manifest'
import {
  RADAR_AREA_OPACITY_DEFAULT,
  RADAR_AREA_OPACITY_MAX,
  RADAR_AXIS_MAX_DEFAULT,
  RADAR_AXIS_MIN_DEFAULT,
  RADAR_MIN_AXES,
  RADAR_SHAPES,
  RADAR_SPLIT_DEFAULT,
  RADAR_SPLIT_MAX,
  RADAR_SPLIT_MIN,
  RADAR_STYLES,
} from '../../../src/modules/radar-chart/options'
import { RADAR_CHART_PRESETS } from '../../../src/modules/radar-chart/presets'
import { GROUP } from '../../../src/shared/chart/chart-config'

const SCHEMA = manifest.configSchema
const TOP_KEYS = SCHEMA.map((item) => item.key)

function field(key: string): ConfigField | undefined {
  return SCHEMA.find((item) => item.key === key)
}

function itemFields(): readonly ConfigField[] {
  return field(AXIS_ITEMS_KEY)?.itemSchema ?? []
}

function itemField(key: string): ConfigField | undefined {
  return itemFields().find((item) => item.key === key)
}

function optionValues(target: ConfigField | undefined): unknown[] {
  return (target?.options ?? []).map((option) => option.value)
}

function slot(): BindingSpec | undefined {
  return manifest.bindings.find((spec) => spec.key === AXIS_SLOT_KEY)
}

describe('身份与出厂形状', () => {
  it('类型与目录名逐字相等，图标是仓里已有的那一个', () => {
    expect(manifest.type).toBe('radar-chart')
    expect(manifest.category).toBe('图表')
  })

  it('图标借的是 chart-mixed：本仓没有雷达图标，加一个要改 @dt/ui', () => {
    expect(manifest.icon).toBe('chart-mixed')
  })

  it('初始尺寸用本仓那四个键，不是参考仓的 w/h', () => {
    expect(manifest.defaultSize).toEqual({
      width: 360,
      height: 300,
      minWidth: 200,
      minHeight: 180,
    })
  })

  it('描述交代了逐轴量程与「画不出来的轴整根不进轮子」这两条坑', () => {
    const text = manifest.description ?? ''

    expect(text.length).toBeGreaterThanOrEqual(60)
    expect(text).toContain('量程')
    expect(text).toContain('凹陷')
  })

  it('内容键就是标题、指标、空态与两组称呼那五个', () => {
    expect(manifest.contentKeys).toEqual([
      'title',
      AXIS_ITEMS_KEY,
      'emptyText',
      'seriesName',
      'compareName',
    ])
  })

  it('预设整套挂在清单上，画布演示只提清单里有的键', () => {
    expect(manifest.configPresets).toBe(RADAR_CHART_PRESETS)
    expect(Object.keys(manifest.preview?.config ?? {})).toEqual([
      AXIS_ITEMS_KEY,
    ])
    expect(Object.keys(manifest.preview?.values ?? {})).toEqual([AXIS_SLOT_KEY])
  })

  it('画布演示至少给得出三根轴，否则模块库里那张缩略图是一片空态', () => {
    const indicators = manifest.preview?.config?.[AXIS_ITEMS_KEY]

    expect(Array.isArray(indicators)).toBe(true)
    expect(
      (Array.isArray(indicators) ? indicators : []).length,
    ).toBeGreaterThanOrEqual(RADAR_MIN_AXES)
  })
})

describe('配置字段', () => {
  it('分段名只用图表族那八个，不另造近义分段', () => {
    const allowed = new Set<string>(Object.values(GROUP))
    const stray = SCHEMA.filter(
      (item) => item.group !== undefined && !allowed.has(item.group),
    ).map((item) => item.key)

    expect(stray).toEqual([])
  })

  it('雷达没有直角坐标轴，不摆那两个轴名', () => {
    expect(TOP_KEYS).not.toContain('xAxisName')
    expect(TOP_KEYS).not.toContain('yAxisName')
  })

  it('两个枚举的档位取自本模块那两张取值表', () => {
    expect(optionValues(field('chartStyle'))).toEqual(
      RADAR_STYLES.map((option) => option.value),
    )
    expect(optionValues(field('shape'))).toEqual(
      RADAR_SHAPES.map((option) => option.value),
    )
  })

  it('填充浓度只在铺了面的那一档出现，且区间与渲染侧共用一份常量', () => {
    expect(field('areaOpacity')?.when?.key).toBe('chartStyle')
    expect(field('areaOpacity')?.when?.in).toEqual(['area'])
    expect(field('areaOpacity')?.max).toBe(RADAR_AREA_OPACITY_MAX)
    expect(field('areaOpacity')?.default).toBe(RADAR_AREA_OPACITY_DEFAULT)
  })

  it('网格形状与环数不带条件：两档画法都调得动', () => {
    expect(field('shape')?.when).toBeUndefined()
    expect(field('splitCount')?.when).toBeUndefined()
    expect(field('splitCount')?.min).toBe(RADAR_SPLIT_MIN)
    expect(field('splitCount')?.max).toBe(RADAR_SPLIT_MAX)
    expect(field('splitCount')?.default).toBe(RADAR_SPLIT_DEFAULT)
  })

  it('缺省画法是填充：单组评价一眼看得出形状的胖瘦', () => {
    expect(field('chartStyle')?.default).toBe('area')
  })

  it('空态文案的出厂值就是取值层那句兜底', () => {
    expect(field('emptyText')?.default).toBe(RADAR_EMPTY_TEXT)
  })

  it('两组称呼的出厂值与取值层的回落值是同一份', () => {
    expect(field('seriesName')?.default).toBe(SERIES_NAME_DEFAULT)
    expect(field('compareName')?.default).toBe(COMPARE_NAME_DEFAULT)
  })

  it('指标列表出厂给满三根：少于三根雷达退化成线段，新拖出来的一块会是空态', () => {
    const items = field(AXIS_ITEMS_KEY)
    const fallback = items?.default

    expect(items?.type).toBe('array')
    expect(items?.minItems).toBe(1)
    expect(items?.itemLabelKey).toBe('name')
    expect(Array.isArray(fallback)).toBe(true)
    expect((Array.isArray(fallback) ? fallback : []).length).toBe(
      RADAR_MIN_AXES,
    )
  })

  it('出厂的每一根轴都自带一段可归一的量程', () => {
    const rows = field(AXIS_ITEMS_KEY)?.default
    const list = Array.isArray(rows) ? rows : []

    for (const row of list) {
      const item = typeof row === 'object' && row !== null ? row : {}
      expect(Reflect.get(item, 'min')).toBe(RADAR_AXIS_MIN_DEFAULT)
      expect(Reflect.get(item, 'max')).toBe(RADAR_AXIS_MAX_DEFAULT)
    }
    expect(list.length).toBeGreaterThan(0)
  })

  it('行内五个子字段就是名称、上下限、单位与小数位', () => {
    expect(itemFields().map((item) => item.key)).toEqual([
      'name',
      'min',
      'max',
      'unit',
      'precision',
    ])
  })

  it('量程是数字框不是滑杆：量纲不同的指标量程差着几个数量级', () => {
    expect(itemField('min')?.type).toBe('number')
    expect(itemField('max')?.type).toBe('number')
  })

  it('行内小数位刻意没有缺省：留空 = 跟随整块', () => {
    expect(itemField('precision')?.default).toBeUndefined()
    expect(itemField('precision')?.min).toBe(0)
    expect(itemField('precision')?.max).toBe(6)
  })

  it('行内小数位是数字框不是滑杆：滑杆表达不出「留空」', () => {
    expect(itemField('precision')?.type).toBe('number')
  })

  it('图例缺省开着：它是逐轴原因唯一的承载面', () => {
    expect(field('showLegend')?.default).toBe(true)
  })

  it('顶点标签缺省关着：两组 × 六根轴就是十二个数糊在轮子上', () => {
    expect(field('showValueLabel')?.default).toBe(false)
  })
})

describe('绑定与状态', () => {
  it('唯一的数组槽行钉在配置里的指标上，行内是本组与对比组两个子槽', () => {
    expect(slot()?.isArray).toBe(true)
    expect(slot()?.isEntityPinned).toBe(true)
    expect(slot()?.arrayFields?.map((item) => item.key)).toEqual([
      'value',
      'compare',
    ])
  })

  it('一个子槽都不给 isRequired，否则整块被浮层盖住、逐轴四档白画', () => {
    const required = [slot(), ...(slot()?.arrayFields ?? [])].filter(
      (spec) => spec?.isRequired === true,
    )

    expect(required).toEqual([])
  })

  it('雷达没有历史序列，不声明时序槽', () => {
    expect(slot()?.isTimeSeries).toBeUndefined()
    expect(
      slot()?.arrayFields?.filter((spec) => spec.isTimeSeries === true),
    ).toEqual([])
  })

  it('行数与行标题都跟着配置里的指标走', () => {
    const config = { [AXIS_ITEMS_KEY]: [{ name: '能效' }, {}] }

    expect(manifest.bindingRowCounts?.(config)).toEqual({
      [AXIS_SLOT_KEY]: 2,
    })
    expect(
      manifest.bindingRowLabels?.(config)[axisFieldKey(0, 'value')]?.title,
    ).toBe('能效')
  })

  it('一根轴都没配时行数也给 0，不许把键漏掉', () => {
    expect(manifest.bindingRowCounts?.({})).toEqual({ [AXIS_SLOT_KEY]: 0 })
  })

  it('四档由模块自己在图例上交代，整块可点与图元上抛同时开', () => {
    expect(manifest.ownsStatusDisplay).toBe(true)
    expect(manifest.emitsInteractions).toBe(true)
    expect(manifest.hostClickable).toBe(true)
  })
})
