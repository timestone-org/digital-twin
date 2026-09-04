/**
 * @fileoverview 守对比柱图清单的声明：分段名只用图表族那八个、枚举档位取自本模块
 * 那几张取值表而不是手抄、两个子槽逐字对上且只有历史那一路声明 isTimeSeries、
 * 一个子槽都不给 isRequired、行钉在配置里的数据组上，以及状态与交互开关的取值。
 *
 * ⚠ 这几类错法 typecheck 与 lint 双双放行，表现只是「这一项永远没反应」：
 * `isRequired` 会让整块被浮层盖住、逐行四档白画；漏 `isTimeSeries` 则驱动器
 * 根本不认这一路是序列，历史档一个点都取不回来。
 */
import type { BindingSpec, ConfigField } from '@dt/contracts'
import { describe, expect, it } from 'vitest'

import {
  BAR_EMPTY_TEXT,
  BAR_ITEMS_KEY,
  BAR_SERIES_FIELD,
  BAR_SLOT_KEY,
  BAR_VALUE_FIELD,
} from '../../../src/modules/bar-chart/bars'
import manifest from '../../../src/modules/bar-chart/manifest'
import {
  BAR_AXES,
  BAR_PLOTS,
  BAR_RADIUS_MAX,
  BAR_RADIUS_MIN,
  BAR_STYLES,
  BAR_VALUE_SOURCES,
  BAR_WIDTH_MAX,
  BAR_WIDTH_MIN,
} from '../../../src/modules/bar-chart/options'
import { BAR_CHART_PRESETS } from '../../../src/modules/bar-chart/presets'
import { GROUP } from '../../../src/shared/chart/chart-config'

const SCHEMA = manifest.configSchema
const TOP_KEYS = SCHEMA.map((item) => item.key)

function field(key: string): ConfigField | undefined {
  return SCHEMA.find((item) => item.key === key)
}

function itemFields(): readonly ConfigField[] {
  return field(BAR_ITEMS_KEY)?.itemSchema ?? []
}

function itemField(key: string): ConfigField | undefined {
  return itemFields().find((item) => item.key === key)
}

function optionValues(target: ConfigField | undefined): unknown[] {
  return (target?.options ?? []).map((option) => option.value)
}

function slot(): BindingSpec | undefined {
  return manifest.bindings.find((spec) => spec.key === BAR_SLOT_KEY)
}

describe('身份与出厂形状', () => {
  it('类型与目录名逐字相等，图标是仓里已有的那一个', () => {
    expect(manifest.type).toBe('bar-chart')
    expect(manifest.icon).toBe('chart-column')
    expect(manifest.category).toBe('图表')
  })

  it('初始尺寸用本仓那四个键，不是参考仓的 w/h', () => {
    expect(manifest.defaultSize).toEqual({
      width: 420,
      height: 300,
      minWidth: 200,
      minHeight: 160,
    })
  })

  it('描述交代了两档类目轴、百分比分母与负值这三条坑', () => {
    const text = manifest.description ?? ''

    expect(text.length).toBeGreaterThanOrEqual(60)
    expect(text).toContain('类目轴')
    expect(text).toContain('分母')
    expect(text).toContain('负值')
  })

  it('内容键就是标题、数据组与空态那三个', () => {
    expect(manifest.contentKeys).toEqual(['title', BAR_ITEMS_KEY, 'emptyText'])
  })

  it('预设整套挂在清单上，画布演示只提清单里有的键', () => {
    expect(manifest.configPresets).toBe(BAR_CHART_PRESETS)
    expect(Object.keys(manifest.preview?.config ?? {})).toEqual([BAR_ITEMS_KEY])
    expect(Object.keys(manifest.preview?.values ?? {})).toEqual([BAR_SLOT_KEY])
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

  it('四个枚举的档位取自本模块那几张取值表，不手抄一遍', () => {
    expect(optionValues(field('chartStyle'))).toEqual(
      BAR_STYLES.map((option) => option.value),
    )
    expect(optionValues(field('valueSource'))).toEqual(
      BAR_VALUE_SOURCES.map((option) => option.value),
    )
    expect(optionValues(itemField('plot'))).toEqual(
      BAR_PLOTS.map((option) => option.value),
    )
    expect(optionValues(itemField('axis'))).toEqual(
      BAR_AXES.map((option) => option.value),
    )
  })

  it('柱宽与圆角的区间与取值表逐字相等，面板拖得到的渲染就不会夹回去', () => {
    expect(field('barWidth')?.min).toBe(BAR_WIDTH_MIN)
    expect(field('barWidth')?.max).toBe(BAR_WIDTH_MAX)
    expect(field('barRadius')?.min).toBe(BAR_RADIUS_MIN)
    expect(field('barRadius')?.max).toBe(BAR_RADIUS_MAX)
  })

  it('柱宽刻意没有缺省：给了 0 就再也分不出「没填」与「真的填了 0」', () => {
    expect(Object.keys(field('barWidth') ?? {})).not.toContain('default')
    expect(Object.keys(itemField('precision') ?? {})).not.toContain('default')
  })

  it('空态文案的缺省与取值层那一句是同一份，不各写一遍', () => {
    expect(field('emptyText')?.default).toBe(BAR_EMPTY_TEXT)
  })

  it('紧凑控件逐个写了 span，缺席等于铺满整行', () => {
    const wide = new Set([BAR_ITEMS_KEY, 'title', 'palette', 'refLines'])
    const missing = SCHEMA.filter(
      (item) => !wide.has(item.key) && item.span === undefined,
    ).map((item) => item.key)

    expect(missing).toEqual([])
  })

  it('数据组是行钉在配置上的数组，出厂给一项、至少留一项', () => {
    const items = field(BAR_ITEMS_KEY)

    expect(items?.type).toBe('array')
    expect(items?.minItems).toBe(1)
    expect(items?.itemLabelKey).toBe('name')
    expect(Array.isArray(items?.default)).toBe(true)
  })

  it('行内七个子字段逐字对上，顺序也钉住', () => {
    expect(itemFields().map((item) => item.key)).toEqual([
      'name',
      'unit',
      'precision',
      'color',
      'stack',
      'plot',
      'axis',
    ])
  })

  it('堆叠分组的说明写明只在历史档生效——行内 when 判的是本行，管不到顶层那一档', () => {
    expect(itemField('stack')?.help).toContain('历史档')
    expect(Object.keys(itemField('stack') ?? {})).not.toContain('when')
  })

  it('画数值的两个口径键摆在样式分段里，不与内容键混在一起', () => {
    expect(TOP_KEYS).toContain('unit')
    expect(TOP_KEYS).toContain('precision')
    expect(manifest.contentKeys).not.toContain('unit')
  })

  it('顶层键不重复：重了的那一个在属性面板上会摆出两遍', () => {
    expect(new Set(TOP_KEYS).size).toBe(TOP_KEYS.length)
  })
})

describe('绑定槽', () => {
  it('唯一一个数组槽，行钉在配置上、行数由配置声明', () => {
    expect(manifest.bindings).toHaveLength(1)
    expect(slot()?.isArray).toBe(true)
    expect(slot()?.isEntityPinned).toBe(true)
    expect(typeof manifest.bindingRowCounts).toBe('function')
    expect(typeof manifest.bindingRowLabels).toBe('function')
  })

  it('两个子槽逐字对上，只有历史那一路声明 isTimeSeries', () => {
    const fields = slot()?.arrayFields ?? []

    expect(fields.map((item) => item.key)).toEqual([
      BAR_VALUE_FIELD,
      BAR_SERIES_FIELD,
    ])
    expect(fields[0]?.isTimeSeries).toBeUndefined()
    expect(fields[1]?.isTimeSeries).toBe(true)
  })

  it('一个子槽都不给 isRequired：给了会让整块被浮层盖住、逐行四档白画', () => {
    const specs = [slot(), ...(slot()?.arrayFields ?? [])]

    expect(specs.map((spec) => spec?.isRequired)).toEqual([
      undefined,
      undefined,
      undefined,
    ])
  })

  it('数组槽在 arrayFields 里声明，绑点面板才认得出它是几行', () => {
    expect(manifest.bindingRowCounts?.({ [BAR_ITEMS_KEY]: [{}, {}] })).toEqual({
      [BAR_SLOT_KEY]: 2,
    })
  })
})

describe('状态与交互', () => {
  it('自己画逐行状态，整格浮层因此不出', () => {
    expect(manifest.ownsStatusDisplay).toBe(true)
  })

  it('只开图元上抛，不开整块可点：这一族摆得出缩放条', () => {
    expect(manifest.emitsInteractions).toBe(true)
    expect(manifest.hostClickable).toBeUndefined()
    expect(TOP_KEYS).toContain('showDataZoom')
  })
})
