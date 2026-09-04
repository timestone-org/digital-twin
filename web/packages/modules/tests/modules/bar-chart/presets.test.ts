/**
 * @fileoverview 守五套外观预设的数据面：id 集合、只写清单里有的顶层键、枚举取值都在
 * 该字段的选项里、每套都把观感键写全（数值口径、轴名、参考线与取数来源这几个除外），
 * 内容键一个都不写，以及逐套那几个「照抄别套就会错」的取值。
 *
 * ⚠ 这几类错法点了按钮什么都不会发生，而 typecheck、lint、build 全绿：
 * 键写错就是「配了不生效」；少写一个键，上一套留在配置里的那个值原样残留，
 * 而点亮判定做的是子集比较、照样把按钮点亮。
 * ⚠ `valueSource` 尤其不许写：它决定这一块读哪一路绑定，一套「换个样子」把它
 * 从历史档翻回实时档，整屏曲线会当场变成一排单值柱。
 */
import type { ConfigField } from '@dt/contracts'
import { describe, expect, it } from 'vitest'

import { BAR_ITEMS_KEY } from '../../../src/modules/bar-chart/bars'
import manifest from '../../../src/modules/bar-chart/manifest'
import { BAR_CHART_PRESETS } from '../../../src/modules/bar-chart/presets'

const SCHEMA = manifest.configSchema
const TOP_KEYS = new Set(SCHEMA.map((item) => item.key))
const CONTENT_KEYS = manifest.contentKeys ?? []

/**
 * 摆在样式与坐标轴分段里、语义却不是观感的那几个键。
 * ⚠ 一套观感把它们写掉，用户配好的数值口径、轴名、阈值线与取数来源会在
 * 换个样子时一起消失。
 */
const DATA_KEYS = [
  'valueSource',
  'unit',
  'precision',
  'xAxisName',
  'yAxisName',
  'refLines',
]

/** 每一套都该写全的观感键：顶层键去掉内容键，再去掉上面那几个。 */
const STYLE_KEYS = SCHEMA.map((item) => item.key).filter(
  (key) => !CONTENT_KEYS.includes(key) && !DATA_KEYS.includes(key),
)

function optionValues(target: ConfigField | undefined): unknown[] {
  return (target?.options ?? []).map((option) => option.value)
}

function configOf(id: string): Record<string, unknown> {
  return BAR_CHART_PRESETS.find((preset) => preset.id === id)?.config ?? {}
}

describe('对比柱图的五套预设', () => {
  it('五套 id 与顺序钉住，重名的那一套点亮判定会打架', () => {
    expect(BAR_CHART_PRESETS.map((preset) => preset.id)).toEqual([
      'rank-bars',
      'rank-horizontal',
      'stacked-hours',
      'share-percent',
      'balance-diverging',
    ])
  })

  it('每套都有一句写清代价的提示，不留空标签', () => {
    for (const preset of BAR_CHART_PRESETS) {
      expect(preset.label.length).toBeGreaterThan(0)
      expect((preset.hint ?? '').length).toBeGreaterThan(0)
    }
  })

  it('只写清单里真有的顶层键：写错的那个键点了没有任何反应', () => {
    const stray = BAR_CHART_PRESETS.flatMap((preset) =>
      Object.keys(preset.config).filter((key) => !TOP_KEYS.has(key)),
    )

    expect(stray).toEqual([])
  })

  it('每套都把观感键写全，少一个上一套的值就原样残留', () => {
    const missing = BAR_CHART_PRESETS.map((preset) => ({
      id: preset.id,
      lack: STYLE_KEYS.filter((key) => !(key in preset.config)),
    })).filter((item) => item.lack.length > 0)

    expect(missing).toEqual([])
  })

  it('取数来源、数值口径、轴名与参考线一套都不写', () => {
    const stray = BAR_CHART_PRESETS.flatMap((preset) =>
      DATA_KEYS.filter((key) => key in preset.config).map(
        (key) => `${preset.id}.${key}`,
      ),
    )

    expect(stray).toEqual([])
  })

  it('三个内容键一套都不写，写了会把用户配好的数据组整片抹掉', () => {
    const stray = BAR_CHART_PRESETS.flatMap((preset) =>
      ['title', BAR_ITEMS_KEY, 'emptyText']
        .filter((key) => key in preset.config)
        .map((key) => `${preset.id}.${key}`),
    )

    expect(stray).toEqual([])
  })

  it('几何档位都在 chartStyle 的选项里，不写一个渲染时会静默回落的值', () => {
    const allowed = optionValues(
      SCHEMA.find((item) => item.key === 'chartStyle'),
    )

    for (const preset of BAR_CHART_PRESETS) {
      expect(allowed).toContain(preset.config.chartStyle)
    }
  })

  it('五套的几何档互不相同：两套长一样等于白白多一个按钮', () => {
    const styles = BAR_CHART_PRESETS.map((preset) => preset.config.chartStyle)

    expect(new Set(styles).size).toBe(styles.length)
  })
})

describe('逐套那几个照抄别套就会错的取值', () => {
  it('竖排名：并排 + 柱顶读数，不摆缩放条', () => {
    const config = configOf('rank-bars')

    expect(config.chartStyle).toBe('grouped')
    expect(config.showValueLabel).toBe(true)
    expect(config.showDataZoom).toBe(false)
  })

  it('横排名：类目转到左边，类目标签全显、图例让位给条本身', () => {
    const config = configOf('rank-horizontal')

    expect(config.chartStyle).toBe('horizontal')
    expect(config.xLabelInterval).toBe('0')
    expect(config.showLegend).toBe(false)
    expect(config.barWidth).toBe(18)
  })

  it('分时堆叠与构成占比都把圆角调回 0：堆叠时圆角会在段间切出缝', () => {
    expect(configOf('stacked-hours').barRadius).toBe(0)
    expect(configOf('share-percent').barRadius).toBe(0)
  })

  it('分时堆叠开缩放条、关逐段数值标签：段里每一段都写数会糊成一片', () => {
    const config = configOf('stacked-hours')

    expect(config.showDataZoom).toBe(true)
    expect(config.showValueLabel).toBe(false)
  })

  it('正负对比不开「不强制含 0」：对称量程已经把 0 摆在正中', () => {
    const config = configOf('balance-diverging')

    expect(config.chartStyle).toBe('diverging')
    expect(config.yScale).toBe(false)
  })

  it('五套都不带渐变、不锁色板：换肤与自定义色板照样接得上', () => {
    for (const preset of BAR_CHART_PRESETS) {
      expect(preset.config.barGradient).toBe(false)
      expect(preset.config.palette).toEqual([])
      expect(preset.config.barOpacity).toBe(1)
    }
  })
})
