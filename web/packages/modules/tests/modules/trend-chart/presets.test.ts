/**
 * @fileoverview 守四套外观预设的数据面：id 集合、只写清单里有的顶层键、枚举取值都在
 * 该字段的选项里、每套都把观感键写全（数值口径、轴名与参考线这几个键除外），
 * 内容键一个都不写，以及逐套那几个「照抄别套就会错」的取值。
 *
 * ⚠ 这几类错法点了按钮什么都不会发生，而 typecheck、lint、build 全绿：
 * 键写错就是「配了不生效」；少写一个键，上一套留在配置里的那个值原样残留，
 * 而点亮判定做的是子集比较、照样把按钮点亮。
 */
import type { ConfigField } from '@dt/contracts'
import { describe, expect, it } from 'vitest'

import manifest from '../../../src/modules/trend-chart/manifest'
import { TREND_CHART_PRESETS } from '../../../src/modules/trend-chart/presets'

const SCHEMA = manifest.configSchema
const TOP_KEYS = new Set(SCHEMA.map((item) => item.key))
const CONTENT_KEYS = manifest.contentKeys ?? []

/**
 * 摆在「样式 / 坐标轴 / 参考线」几段里、语义却跟着数据走的那几个键。
 * ⚠ 一套观感把它们写成空串或空表，用户配好的 ℃、轴名与阈值线会在换个样子时消失：
 * 单位与小数位是这块屏的数值口径，轴名多半也带着单位，参考线是数据判据。
 */
const DATA_SIDE_KEYS = [
  'unit',
  'precision',
  'xAxisName',
  'yAxisName',
  'refLines',
]

/** 每一套都该写全的观感键：顶层键去掉内容键，再去掉那几个跟着数据走的键。 */
const STYLE_KEYS = SCHEMA.map((item) => item.key).filter(
  (key) => !CONTENT_KEYS.includes(key) && !DATA_SIDE_KEYS.includes(key),
)

function optionValues(target: ConfigField | undefined): unknown[] {
  return (target?.options ?? []).map((option) => option.value)
}

function configOf(id: string): Record<string, unknown> {
  return TREND_CHART_PRESETS.find((preset) => preset.id === id)?.config ?? {}
}

describe('趋势曲线的四套预设', () => {
  it('id 集合恰是写死的这四个，顺序即面板上的排布', () => {
    expect(TREND_CHART_PRESETS.map((preset) => preset.id)).toEqual([
      'process-line',
      'filled-area',
      'dual-axis',
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

  it('跟着数据走的那几个键也一个都不写', () => {
    const leaked = TREND_CHART_PRESETS.flatMap((preset) =>
      DATA_SIDE_KEYS.filter((key) => key in preset.config).map(
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

  it('四套里只有渐变面积开着填充，且末端色留空跟着主色走', () => {
    const filled = TREND_CHART_PRESETS.filter(
      (preset) => preset.config.areaGradient === true,
    )

    expect(filled.map((preset) => preset.id)).toEqual(['filled-area'])
    expect(configOf('filled-area').chartStyle).toBe('area')
    expect(configOf('filled-area').areaGradientTo).toBe('')
  })

  it('只有双轴对比那一套开着双轴，且说明里点了参考线跟着左轴走', () => {
    const dual = TREND_CHART_PRESETS.filter(
      (preset) => preset.config.dualAxis === true,
    )

    expect(dual.map((preset) => preset.id)).toEqual(['dual-axis'])
    expect(dual[0]?.hint ?? '').toContain('参考线')
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

  it('四套一律不画数据点与数值标签：几百个点逐点标会糊成一片', () => {
    const noisy = TREND_CHART_PRESETS.filter(
      (preset) =>
        preset.config.showSymbol === true ||
        preset.config.showValueLabel === true,
    ).map((preset) => preset.id)

    expect(noisy).toEqual([])
  })
})
