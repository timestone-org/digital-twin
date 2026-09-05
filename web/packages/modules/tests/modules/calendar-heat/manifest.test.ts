/**
 * @fileoverview 守日历热力清单的声明：分段名只用图表族那八个、枚举档位取自本模块那
 * 三张取值表而不是手抄、色阶两个端点刻意没有缺省（「留空 = 自动」与「真的填了 0」
 * 因此分得开）、逐日归并是逐张可配的、唯一的子槽声明成时序槽且一个都不给 isRequired、
 * 行钉在配置里的指标上，以及三个状态与交互开关的取值。
 *
 * ⚠ 这几类错法 typecheck 与 lint 双双放行，表现只是「这一项永远没反应」：
 * `isRequired` 会让整块被浮层盖住、逐张状态白画；漏掉 `isTimeSeries` 则整条历史序列
 * 永远不会被取回，而屏上只是一张空日历。
 */
import type { BindingSpec, ConfigField } from '@dt/contracts'
import { describe, expect, it } from 'vitest'

import {
  CALENDAR_EMPTY_TEXT,
  DAY_SLOT_KEY,
  METRIC_ITEMS_KEY,
  metricFieldKey,
} from '../../../src/modules/calendar-heat/days'
import manifest from '../../../src/modules/calendar-heat/manifest'
import {
  CALENDAR_STYLES,
  CELL_GAP_DEFAULT,
  CELL_GAP_MAX,
  CELL_GAP_MIN,
  COLOR_SCALES,
  DAY_AGGREGATE_DEFAULT,
  DAY_AGGREGATES,
  MAX_METRICS,
} from '../../../src/modules/calendar-heat/options'
import { CALENDAR_HEAT_PRESETS } from '../../../src/modules/calendar-heat/presets'
import { GROUP } from '../../../src/shared/chart/chart-config'

const SCHEMA = manifest.configSchema
const TOP_KEYS = SCHEMA.map((item) => item.key)

function field(key: string): ConfigField | undefined {
  return SCHEMA.find((item) => item.key === key)
}

function itemFields(): readonly ConfigField[] {
  return field(METRIC_ITEMS_KEY)?.itemSchema ?? []
}

function itemField(key: string): ConfigField | undefined {
  return itemFields().find((item) => item.key === key)
}

function optionValues(target: ConfigField | undefined): unknown[] {
  return (target?.options ?? []).map((option) => option.value)
}

function slot(): BindingSpec | undefined {
  return manifest.bindings.find((spec) => spec.key === DAY_SLOT_KEY)
}

describe('身份与出厂形状', () => {
  it('类型与目录名逐字相等，图标是仓里已有的那一个', () => {
    expect(manifest.type).toBe('calendar-heat')
    expect(manifest.icon).toBe('calendar')
    expect(manifest.category).toBe('图表')
  })

  it('初始尺寸用本仓那四个键，不是参考仓的 w/h', () => {
    expect(manifest.defaultSize).toEqual({
      width: 480,
      height: 300,
      minWidth: 240,
      minHeight: 160,
    })
  })

  it('描述交代了时区、归并与触顶这三条坑', () => {
    const text = manifest.description ?? ''

    expect(text.length).toBeGreaterThanOrEqual(60)
    expect(text).toContain('时区')
    expect(text).toContain('归')
    expect(text).toContain('触顶')
  })

  it('内容键就是标题、指标、空态与时区那四个', () => {
    expect(manifest.contentKeys).toEqual([
      'title',
      METRIC_ITEMS_KEY,
      'emptyText',
      'timezone',
    ])
  })

  it('预设整套挂在清单上，画布演示只提清单里有的键', () => {
    expect(manifest.configPresets).toBe(CALENDAR_HEAT_PRESETS)
    expect(Object.keys(manifest.preview?.config ?? {})).toEqual([
      METRIC_ITEMS_KEY,
    ])
    expect(Object.keys(manifest.preview?.values ?? {})).toEqual([DAY_SLOT_KEY])
  })

  it('演示值带着序列伴生键，缩略图才画得出格子', () => {
    const rows = manifest.preview?.values?.[DAY_SLOT_KEY]
    const first = Array.isArray(rows) ? rows[0] : undefined
    const points =
      typeof first === 'object' && first !== null
        ? (first as Record<string, unknown>).seriesPoints
        : undefined

    expect(Array.isArray(points)).toBe(true)
    expect((Array.isArray(points) ? points : []).length).toBeGreaterThan(1)
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

  it('没有「时间范围」这一项：窗口住在每条绑定上，模块改不了它', () => {
    expect(TOP_KEYS).not.toContain('rangeMonths')
    expect(TOP_KEYS).not.toContain('lastWindow')
  })

  it('两个整块枚举的档位取自本模块那两张取值表', () => {
    expect(optionValues(field('chartStyle'))).toEqual(
      CALENDAR_STYLES.map((option) => option.value),
    )
    expect(optionValues(field('colorScale'))).toEqual(
      COLOR_SCALES.map((option) => option.value),
    )
  })

  it('色阶两个端点刻意没有缺省：留空 = 按数据自动定', () => {
    expect(field('minValue')?.default).toBeUndefined()
    expect(field('maxValue')?.default).toBeUndefined()
  })

  it('色阶端点是数字框不是滑杆：滑杆表达不出「留空」', () => {
    expect(field('minValue')?.type).toBe('number')
    expect(field('maxValue')?.type).toBe('number')
  })

  it('格缝的区间与缺省与渲染侧共用一份常量', () => {
    expect(field('cellGap')?.min).toBe(CELL_GAP_MIN)
    expect(field('cellGap')?.max).toBe(CELL_GAP_MAX)
    expect(field('cellGap')?.default).toBe(CELL_GAP_DEFAULT)
  })

  it('时区出厂留空 = 跟浏览器本地走，不预设某个城市', () => {
    expect(field('timezone')?.default).toBe('')
    expect(field('timezone')?.type).toBe('string')
  })

  it('空态文案的出厂值就是取值层那句兜底', () => {
    expect(field('emptyText')?.default).toBe(CALENDAR_EMPTY_TEXT)
  })

  it('指标列表出厂给一项、封顶四项，行标题按名称走', () => {
    const items = field(METRIC_ITEMS_KEY)

    expect(items?.type).toBe('array')
    expect(items?.minItems).toBe(1)
    expect(items?.maxItems).toBe(MAX_METRICS)
    expect(items?.itemLabelKey).toBe('name')
    expect(Array.isArray(items?.default)).toBe(true)
  })

  it('行内四个子字段就是名称、单位、小数位与逐日归并', () => {
    expect(itemFields().map((item) => item.key)).toEqual([
      'name',
      'unit',
      'precision',
      'dayAggregate',
    ])
  })

  it('逐日归并是逐张可配的，档位取自那张取值表', () => {
    expect(optionValues(itemField('dayAggregate'))).toEqual(
      DAY_AGGREGATES.map((option) => option.value),
    )
    expect(itemField('dayAggregate')?.default).toBe(DAY_AGGREGATE_DEFAULT)
  })

  it('行内小数位刻意没有缺省：留空 = 跟随缺省那一档', () => {
    expect(itemField('precision')?.default).toBeUndefined()
    expect(itemField('precision')?.min).toBe(0)
    expect(itemField('precision')?.max).toBe(6)
  })
})

describe('绑定与状态', () => {
  it('唯一的数组槽行钉在配置里的指标上', () => {
    expect(slot()?.isArray).toBe(true)
    expect(slot()?.isEntityPinned).toBe(true)
    expect(slot()?.arrayFields?.map((item) => item.key)).toEqual(['series'])
  })

  it('那个子槽声明成时序槽，否则历史序列永远不会被取回', () => {
    expect(slot()?.arrayFields?.[0]?.isTimeSeries).toBe(true)
  })

  it('一个子槽都不给 isRequired，否则整块被浮层盖住、逐张状态白画', () => {
    const required = [slot(), ...(slot()?.arrayFields ?? [])].filter(
      (spec) => spec?.isRequired === true,
    )

    expect(required).toEqual([])
  })

  it('行数与行标题都跟着配置里的指标走', () => {
    const config = { [METRIC_ITEMS_KEY]: [{ name: '能耗' }, {}] }

    expect(manifest.bindingRowCounts?.(config)).toEqual({ [DAY_SLOT_KEY]: 2 })
    expect(manifest.bindingRowLabels?.(config)[metricFieldKey(0)]?.title).toBe(
      '能耗',
    )
  })

  it('一张都没配时行数也给 0，不许把键漏掉', () => {
    expect(manifest.bindingRowCounts?.({})).toEqual({ [DAY_SLOT_KEY]: 0 })
  })

  it('逐张状态由模块自己写在标题上，整块可点与图元上抛同时开', () => {
    expect(manifest.ownsStatusDisplay).toBe(true)
    expect(manifest.emitsInteractions).toBe(true)
    expect(manifest.hostClickable).toBe(true)
  })
})
