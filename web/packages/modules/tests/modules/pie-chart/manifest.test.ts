/**
 * @fileoverview 守构成环图清单的声明：分段名只用图表族那八个、枚举档位取自本模块
 * 那两张取值表而不是手抄、环心两项与内半径都只在有心可写的两档上出现、饼图不摆
 * 直角坐标轴那两个轴名、唯一的子槽逐字对上且一个都不给 isRequired、行钉在配置里
 * 的扇区上，以及三个状态与交互开关的取值。
 *
 * ⚠ 这几类错法 typecheck 与 lint 双双放行，表现只是「这一项永远没反应」：
 * `when` 指错键那个字段永远不出现，`isRequired` 会让整块被浮层盖住、逐片四档白画。
 */
import type { BindingSpec, ConfigField } from '@dt/contracts'
import { describe, expect, it } from 'vitest'

import manifest from '../../../src/modules/pie-chart/manifest'
import {
  PIE_CENTER_TEXTS,
  PIE_INNER_RADIUS_DEFAULT,
  PIE_OUTER_RADIUS_DEFAULT,
  PIE_RADIUS_MAX,
  PIE_RADIUS_MIN,
  PIE_STYLES,
} from '../../../src/modules/pie-chart/options'
import { PIE_CHART_PRESETS } from '../../../src/modules/pie-chart/presets'
import {
  PIE_EMPTY_TEXT,
  SLICE_ITEMS_KEY,
  SLICE_SLOT_KEY,
  sliceFieldKey,
} from '../../../src/modules/pie-chart/slices'
import { GROUP } from '../../../src/shared/chart/chart-config'

const SCHEMA = manifest.configSchema
const TOP_KEYS = SCHEMA.map((item) => item.key)

function field(key: string): ConfigField | undefined {
  return SCHEMA.find((item) => item.key === key)
}

function itemFields(): readonly ConfigField[] {
  return field(SLICE_ITEMS_KEY)?.itemSchema ?? []
}

function optionValues(target: ConfigField | undefined): unknown[] {
  return (target?.options ?? []).map((option) => option.value)
}

function slot(): BindingSpec | undefined {
  return manifest.bindings.find((spec) => spec.key === SLICE_SLOT_KEY)
}

describe('身份与出厂形状', () => {
  it('类型与目录名逐字相等，图标是仓里已有的那一个', () => {
    expect(manifest.type).toBe('pie-chart')
    expect(manifest.icon).toBe('chart-pie')
    expect(manifest.category).toBe('图表')
  })

  it('初始尺寸用本仓那四个键，不是参考仓的 w/h', () => {
    expect(manifest.defaultSize).toEqual({
      width: 360,
      height: 280,
      minWidth: 160,
      minHeight: 140,
    })
  })

  it('描述交代了归一口径与负值这两条坑', () => {
    const text = manifest.description ?? ''

    expect(text.length).toBeGreaterThanOrEqual(60)
    expect(text).toContain('归一')
    expect(text).toContain('负值')
  })

  it('内容键就是标题、扇区、空态与环心单位那四个', () => {
    expect(manifest.contentKeys).toEqual([
      'title',
      SLICE_ITEMS_KEY,
      'emptyText',
      'centerUnit',
    ])
  })

  it('预设整套挂在清单上，画布演示只提清单里有的键', () => {
    expect(manifest.configPresets).toBe(PIE_CHART_PRESETS)
    expect(Object.keys(manifest.preview?.config ?? {})).toEqual([
      SLICE_ITEMS_KEY,
    ])
    expect(Object.keys(manifest.preview?.values ?? {})).toEqual([
      SLICE_SLOT_KEY,
    ])
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

  it('饼图没有坐标轴，不摆那两个轴名', () => {
    expect(TOP_KEYS).not.toContain('xAxisName')
    expect(TOP_KEYS).not.toContain('yAxisName')
  })

  it('两个枚举的档位取自本模块那两张取值表', () => {
    expect(optionValues(field('chartStyle'))).toEqual(
      PIE_STYLES.map((option) => option.value),
    )
    expect(optionValues(field('centerText'))).toEqual(
      PIE_CENTER_TEXTS.map((option) => option.value),
    )
  })

  it('环心两项与内半径都只在有心可写的两档上出现', () => {
    const gated = ['centerText', 'centerUnit', 'innerRadius']

    expect(gated.map((key) => field(key)?.when?.key)).toEqual([
      'chartStyle',
      'chartStyle',
      'chartStyle',
    ])
    expect(gated.map((key) => field(key)?.when?.in)).toEqual([
      ['donut', 'rose'],
      ['donut', 'rose'],
      ['donut', 'rose'],
    ])
  })

  it('外半径不带条件：实心饼也要能调大小', () => {
    expect(field('outerRadius')?.when).toBeUndefined()
  })

  it('两个半径的区间与缺省与取值层共用一份常量', () => {
    expect(field('innerRadius')?.min).toBe(PIE_RADIUS_MIN)
    expect(field('innerRadius')?.max).toBe(PIE_RADIUS_MAX)
    expect(field('innerRadius')?.default).toBe(PIE_INNER_RADIUS_DEFAULT)
    expect(field('outerRadius')?.default).toBe(PIE_OUTER_RADIUS_DEFAULT)
  })

  it('空态文案的出厂值就是取值层那句兜底', () => {
    expect(field('emptyText')?.default).toBe(PIE_EMPTY_TEXT)
  })

  it('扇区列表出厂给一项，行标题按名称走', () => {
    const items = field(SLICE_ITEMS_KEY)

    expect(items?.type).toBe('array')
    expect(items?.minItems).toBe(1)
    expect(items?.itemLabelKey).toBe('name')
    expect(Array.isArray(items?.default)).toBe(true)
  })

  it('行内小数位刻意没有缺省：留空 = 跟随整块', () => {
    const precision = itemFields().find((item) => item.key === 'precision')

    expect(precision?.default).toBeUndefined()
    expect(precision?.min).toBe(0)
    expect(precision?.max).toBe(6)
  })

  it('行内小数位是数字框不是滑杆：滑杆表达不出「留空」', () => {
    const precision = itemFields().find((item) => item.key === 'precision')

    expect(precision?.type).toBe('number')
  })

  it('图例缺省开着：它是逐片四档唯一的承载面', () => {
    expect(field('showLegend')?.default).toBe(true)
  })

  it('行内四个子字段就是名称、颜色、单位与小数位', () => {
    expect(itemFields().map((item) => item.key)).toEqual([
      'name',
      'color',
      'unit',
      'precision',
    ])
  })
})

describe('绑定与状态', () => {
  it('唯一的数组槽行钉在配置里的扇区上', () => {
    expect(slot()?.isArray).toBe(true)
    expect(slot()?.isEntityPinned).toBe(true)
    expect(slot()?.arrayFields?.map((item) => item.key)).toEqual(['value'])
  })

  it('一个子槽都不给 isRequired，否则整块被浮层盖住、逐片四档白画', () => {
    const required = [slot(), ...(slot()?.arrayFields ?? [])].filter(
      (spec) => spec?.isRequired === true,
    )

    expect(required).toEqual([])
  })

  it('饼图没有历史序列，不声明时序槽', () => {
    expect(slot()?.isTimeSeries).toBeUndefined()
  })

  it('行数与行标题都跟着配置里的扇区走', () => {
    const config = { [SLICE_ITEMS_KEY]: [{ name: '光伏' }, {}] }

    expect(manifest.bindingRowCounts?.(config)).toEqual({ [SLICE_SLOT_KEY]: 2 })
    expect(manifest.bindingRowLabels?.(config)[sliceFieldKey(0)]?.title).toBe(
      '光伏',
    )
  })

  it('一片都没配时行数也给 0，不许把键漏掉', () => {
    expect(manifest.bindingRowCounts?.({})).toEqual({ [SLICE_SLOT_KEY]: 0 })
  })

  it('四档由模块自己在图例上交代，整块可点与图元上抛同时开', () => {
    expect(manifest.ownsStatusDisplay).toBe(true)
    expect(manifest.emitsInteractions).toBe(true)
    expect(manifest.hostClickable).toBe(true)
  })
})
