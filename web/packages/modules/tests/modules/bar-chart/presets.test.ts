/**
 * @fileoverview 守对比柱图预设：观感键完整、内容键隔离，枚举值与清单一致。
 */
import { styleKeysOf, type ConfigField } from '@dt/contracts'
import { describe, expect, it } from 'vitest'

import manifest from '../../../src/modules/bar-chart/manifest'
import { BAR_CHART_PRESETS } from '../../../src/modules/bar-chart/presets'

const SCHEMA = manifest.configSchema
const TOP_KEYS = new Set(SCHEMA.map((item) => item.key))
const CONTENT_KEYS = manifest.contentKeys ?? []
const STYLE_KEYS = styleKeysOf(manifest)

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

  it('内容键一套都不写，写了会覆盖用户配置的数据与数值口径', () => {
    const stray = BAR_CHART_PRESETS.flatMap((preset) =>
      CONTENT_KEYS.filter((key) => key in preset.config).map(
        (key) => `${preset.id}.${key}`,
      ),
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
