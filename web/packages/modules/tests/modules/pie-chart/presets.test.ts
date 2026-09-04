/**
 * @fileoverview 守四套外观预设的数据面：id 集合、只写清单里有的顶层键、枚举取值都在
 * 该字段的选项里、每套都把观感键写全（`unit` / `precision` 两个数值口径键除外，
 * 一套观感把它们抹成空串等于让用户配好的单位消失）、内容键一个都不写，
 * 以及逐套那几个「照抄别套就会错」的取值。
 *
 * ⚠ 这几类错法点了按钮什么都不会发生，而 typecheck、lint、build 全绿：
 * 键写错就是「配了不生效」；少写一个键，上一套留在配置里的那个值原样残留，
 * 而点亮判定做的是子集比较、照样把按钮点亮。
 */
import type { ConfigField } from '@dt/contracts'
import { describe, expect, it } from 'vitest'

import manifest from '../../../src/modules/pie-chart/manifest'
import { PIE_CHART_PRESETS } from '../../../src/modules/pie-chart/presets'

const SCHEMA = manifest.configSchema
const TOP_KEYS = new Set(SCHEMA.map((item) => item.key))
const CONTENT_KEYS = manifest.contentKeys ?? []

/**
 * 摆在「样式」分段里、语义却是这块屏的数值口径的那两个键。
 * ⚠ 一套观感把它们写成空串，用户配好的 kWh 会在换个样子时消失。
 */
const FORMAT_KEYS = ['unit', 'precision']

/** 每一套都该写全的观感键：顶层键去掉内容键，再去掉那两个数值口径键。 */
const STYLE_KEYS = SCHEMA.map((item) => item.key).filter(
  (key) => !CONTENT_KEYS.includes(key) && !FORMAT_KEYS.includes(key),
)

function optionValues(target: ConfigField | undefined): unknown[] {
  return (target?.options ?? []).map((option) => option.value)
}

function configOf(id: string): Record<string, unknown> {
  return PIE_CHART_PRESETS.find((preset) => preset.id === id)?.config ?? {}
}

describe('构成环图的四套预设', () => {
  it('id 集合恰是写死的这四个，顺序即面板上的排布', () => {
    expect(PIE_CHART_PRESETS.map((preset) => preset.id)).toEqual([
      'energy-donut',
      'share-pie',
      'rose-rank',
      'compact-ring',
    ])
  })

  it('每一套都有按钮文案与一句说明', () => {
    const bare = PIE_CHART_PRESETS.filter(
      (preset) => preset.label === '' || (preset.hint ?? '') === '',
    ).map((preset) => preset.id)

    expect(bare).toEqual([])
  })

  it('只写清单里有的顶层键', () => {
    const stray = PIE_CHART_PRESETS.flatMap((preset) =>
      Object.keys(preset.config)
        .filter((key) => !TOP_KEYS.has(key))
        .map((key) => `${preset.id}.${key}`),
    )

    expect(stray).toEqual([])
  })

  it('内容键一个都不写，否则套预设会把用户配好的扇区抹掉', () => {
    const leaked = PIE_CHART_PRESETS.flatMap((preset) =>
      CONTENT_KEYS.filter((key) => key in preset.config).map(
        (key) => `${preset.id}.${key}`,
      ),
    )

    expect(leaked).toEqual([])
  })

  it('数值口径那两个键也一个都不写', () => {
    const leaked = PIE_CHART_PRESETS.flatMap((preset) =>
      FORMAT_KEYS.filter((key) => key in preset.config).map(
        (key) => `${preset.id}.${key}`,
      ),
    )

    expect(leaked).toEqual([])
  })

  it('每一套都把观感键写全，缺一个就会残留上一套的值', () => {
    const missing = PIE_CHART_PRESETS.flatMap((preset) =>
      STYLE_KEYS.filter((key) => !(key in preset.config)).map(
        (key) => `${preset.id}.${key}`,
      ),
    )

    expect(missing).toEqual([])
    expect(STYLE_KEYS.length).toBeGreaterThan(0)
  })

  it('枚举取值都在该字段的选项名单里', () => {
    const stray = PIE_CHART_PRESETS.flatMap((preset) =>
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
    const overridden = PIE_CHART_PRESETS.filter((preset) => {
      const palette = preset.config.palette
      return !Array.isArray(palette) || palette.length > 0
    }).map((preset) => preset.id)

    expect(overridden).toEqual([])
  })

  it('带环心读数的那两套关掉扇区标签，名字不写两遍', () => {
    for (const id of ['energy-donut', 'rose-rank']) {
      expect(configOf(id).showLegend).toBe(true)
      expect(configOf(id).showValueLabel).toBe(false)
    }
  })

  it('只有紧凑环关掉图例，且它的说明里写清了代价', () => {
    const off = PIE_CHART_PRESETS.filter(
      (preset) => preset.config.showLegend !== true,
    )

    expect(off.map((preset) => preset.id)).toEqual(['compact-ring'])
    expect(off[0]?.hint ?? '').toContain('取不到')
  })

  it('占比饼是实心的，环心那一档跟着写成不显示', () => {
    expect(configOf('share-pie').chartStyle).toBe('pie')
    expect(configOf('share-pie').centerText).toBe('none')
    expect(configOf('share-pie').showValueLabel).toBe(true)
  })

  it('紧凑环最窄，四套里只有它开着动画', () => {
    const animated = PIE_CHART_PRESETS.filter(
      (preset) => preset.config.animation === true,
    ).map((preset) => preset.id)

    expect(animated).toEqual(['compact-ring'])
    expect(configOf('compact-ring').innerRadius).toBe(64)
  })

  it('每一套的内半径都留得下环带，不会画成宽度为 0', () => {
    const flat = PIE_CHART_PRESETS.filter(
      (preset) =>
        preset.config.chartStyle !== 'pie' &&
        Number(preset.config.innerRadius) >= Number(preset.config.outerRadius),
    ).map((preset) => preset.id)

    expect(flat).toEqual([])
  })
})
