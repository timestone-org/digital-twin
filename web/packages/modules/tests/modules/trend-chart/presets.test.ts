/**
 * @fileoverview 守趋势曲线预设：观感键完整、内容键隔离，枚举值与清单一致。
 */
import { styleKeysOf, type ConfigField } from '@dt/contracts'
import { describe, expect, it } from 'vitest'

import manifest from '../../../src/modules/trend-chart/manifest'
import { TREND_CHART_PRESETS } from '../../../src/modules/trend-chart/presets'

const SCHEMA = manifest.configSchema
const TOP_KEYS = new Set(SCHEMA.map((item) => item.key))
const CONTENT_KEYS = manifest.contentKeys ?? []
const STYLE_KEYS = styleKeysOf(manifest)

function optionValues(target: ConfigField | undefined): unknown[] {
  return (target?.options ?? []).map((option) => option.value)
}

function configOf(id: string): Record<string, unknown> {
  return TREND_CHART_PRESETS.find((preset) => preset.id === id)?.config ?? {}
}

describe('趋势曲线的三套预设', () => {
  it('id 集合恰是写死的这三个，顺序即面板上的排布', () => {
    expect(TREND_CHART_PRESETS.map((preset) => preset.id)).toEqual([
      'process-line',
      'filled-area',
      'long-window',
    ])
  })

  it('每一套都有按钮文案与一句说明', () => {
    const bare = TREND_CHART_PRESETS.filter(
      (preset) => preset.label === '' || (preset.hint ?? '') === '',
    ).map((preset) => preset.id)

    expect(bare).toEqual([])
  })

  it('只写清单里有的顶层键', () => {
    const stray = TREND_CHART_PRESETS.flatMap((preset) =>
      Object.keys(preset.config)
        .filter((key) => !TOP_KEYS.has(key))
        .map((key) => `${preset.id}.${key}`),
    )

    expect(stray).toEqual([])
  })

  it('内容键一个都不写，否则套预设会把用户配好的系列抹掉', () => {
    const leaked = TREND_CHART_PRESETS.flatMap((preset) =>
      CONTENT_KEYS.filter((key) => key in preset.config).map(
        (key) => `${preset.id}.${key}`,
      ),
    )

    expect(leaked).toEqual([])
  })

  it('每一套都把观感键写全，缺一个就会残留上一套的值', () => {
    const missing = TREND_CHART_PRESETS.flatMap((preset) =>
      STYLE_KEYS.filter((key) => !(key in preset.config)).map(
        (key) => `${preset.id}.${key}`,
      ),
    )

    expect(missing).toEqual([])
    expect(STYLE_KEYS.length).toBeGreaterThan(0)
  })

  it('枚举取值都在该字段的选项名单里', () => {
    const stray = TREND_CHART_PRESETS.flatMap((preset) =>
      Object.entries(preset.config)
        .filter(([key, value]) => {
          const target = SCHEMA.find((item) => item.key === key)
          return (
            target?.type === 'enum' && !optionValues(target).includes(value)
          )
        })
        .map(([key]) => `${preset.id}.${key}`),
    )

    expect(stray).toEqual([])
  })

  it('没有一套写死自定义色板，配色因此跟着主题走', () => {
    const overridden = TREND_CHART_PRESETS.filter((preset) => {
      const palette = preset.config.palette
      return !Array.isArray(palette) || palette.length > 0
    }).map((preset) => preset.id)

    expect(overridden).toEqual([])
  })

  it('三套里只有渐变面积开着填充，且末端色留空跟着主色走', () => {
    const filled = TREND_CHART_PRESETS.filter(
      (preset) => preset.config.areaGradient === true,
    )

    expect(filled.map((preset) => preset.id)).toEqual(['filled-area'])
    expect(configOf('filled-area').chartStyle).toBe('area')
    expect(configOf('filled-area').areaGradientTo).toBe('')
  })

  it('只有长窗回放开缩放条、也只有它关图例，且说明里写清了代价', () => {
    const zoomed = TREND_CHART_PRESETS.filter(
      (preset) => preset.config.showDataZoom === true,
    )
    const noLegend = TREND_CHART_PRESETS.filter(
      (preset) => preset.config.showLegend !== true,
    )

    expect(zoomed.map((preset) => preset.id)).toEqual(['long-window'])
    expect(noLegend.map((preset) => preset.id)).toEqual(['long-window'])
    expect(noLegend[0]?.hint ?? '').toContain('取不到')
  })

  it('三套一律不画数据点与数值标签：几百个点逐点标会糊成一片', () => {
    const noisy = TREND_CHART_PRESETS.filter(
      (preset) =>
        preset.config.showSymbol === true ||
        preset.config.showValueLabel === true,
    ).map((preset) => preset.id)

    expect(noisy).toEqual([])
  })
})
