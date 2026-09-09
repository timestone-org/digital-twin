/**
 * @fileoverview 守构成环图预设：观感键完整、内容键隔离，枚举值与清单一致。
 */
import { styleKeysOf, type ConfigField } from '@dt/contracts'
import { describe, expect, it } from 'vitest'

import manifest from '../../../src/modules/pie-chart/manifest'
import { PIE_CHART_PRESETS } from '../../../src/modules/pie-chart/presets'

const SCHEMA = manifest.configSchema
const TOP_KEYS = new Set(SCHEMA.map((item) => item.key))
const CONTENT_KEYS = manifest.contentKeys ?? []
const STYLE_KEYS = styleKeysOf(manifest)

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

  it('只允许有意覆盖中心读数，其余内容键保持不变', () => {
    const leaked = PIE_CHART_PRESETS.flatMap((preset) =>
      CONTENT_KEYS.filter(
        (key) => key !== 'centerText' && key in preset.config,
      ).map((key) => `${preset.id}.${key}`),
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
    expect(off[0]?.hint ?? '').toContain('不再显示原因')
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
