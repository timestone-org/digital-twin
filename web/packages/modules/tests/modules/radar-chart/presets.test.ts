/**
 * @fileoverview 守四套外观预设的数据面：id 集合、只写清单里有的顶层键、枚举取值都在
 * 该字段的选项里、每套都把观感键写全（`unit` / `precision` 两个数值口径键除外）、
 * 内容键一个都不写，以及逐套那几个「照抄别套就会错」的取值。
 *
 * ⚠ 这几类错法点了按钮什么都不会发生，而 typecheck、lint、build 全绿：
 * 键写错就是「配了不生效」；少写一个键，上一套留在配置里的那个值原样残留，
 * 而点亮判定做的是子集比较、照样把按钮点亮。
 */
import type { ConfigField } from '@dt/contracts'
import { describe, expect, it } from 'vitest'

import manifest from '../../../src/modules/radar-chart/manifest'
import {
  RADAR_AREA_OPACITY_MAX,
  RADAR_SPLIT_MAX,
  RADAR_SPLIT_MIN,
} from '../../../src/modules/radar-chart/options'
import { RADAR_CHART_PRESETS } from '../../../src/modules/radar-chart/presets'

const SCHEMA = manifest.configSchema
const TOP_KEYS = new Set(SCHEMA.map((item) => item.key))
const CONTENT_KEYS = manifest.contentKeys ?? []

/**
 * 摆在「样式」分段里、语义却是这块屏的数值口径的那两个键。
 * ⚠ 一套观感把它们写成空串，用户配好的单位会在换个样子时消失。
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
  return RADAR_CHART_PRESETS.find((preset) => preset.id === id)?.config ?? {}
}

describe('多维雷达的四套预设', () => {
  it('id 集合恰是写死的这四个，顺序即面板上的排布', () => {
    expect(RADAR_CHART_PRESETS.map((preset) => preset.id)).toEqual([
      'green-factory',
      'group-compare',
      'outline-clean',
      'compact-radar',
    ])
  })

  it('每一套都有按钮文案与一句说明', () => {
    const bare = RADAR_CHART_PRESETS.filter(
      (preset) => preset.label === '' || (preset.hint ?? '') === '',
    ).map((preset) => preset.id)

    expect(bare).toEqual([])
  })

  it('只写清单里有的顶层键', () => {
    const stray = RADAR_CHART_PRESETS.flatMap((preset) =>
      Object.keys(preset.config)
        .filter((key) => !TOP_KEYS.has(key))
        .map((key) => `${preset.id}.${key}`),
    )

    expect(stray).toEqual([])
  })

  it('内容键一个都不写，否则套预设会把用户配好的指标抹掉', () => {
    const leaked = RADAR_CHART_PRESETS.flatMap((preset) =>
      CONTENT_KEYS.filter((key) => key in preset.config).map(
        (key) => `${preset.id}.${key}`,
      ),
    )

    expect(leaked).toEqual([])
  })

  it('数值口径那两个键也一个都不写', () => {
    const leaked = RADAR_CHART_PRESETS.flatMap((preset) =>
      FORMAT_KEYS.filter((key) => key in preset.config).map(
        (key) => `${preset.id}.${key}`,
      ),
    )

    expect(leaked).toEqual([])
  })

  it('每一套都把观感键写全，缺一个就会残留上一套的值', () => {
    const missing = RADAR_CHART_PRESETS.flatMap((preset) =>
      STYLE_KEYS.filter((key) => !(key in preset.config)).map(
        (key) => `${preset.id}.${key}`,
      ),
    )

    expect(missing).toEqual([])
    expect(STYLE_KEYS.length).toBeGreaterThan(0)
  })

  it('描边那两套也把填充浓度写全：不写就残留上一套的浓度', () => {
    for (const id of ['outline-clean', 'compact-radar']) {
      expect(configOf(id).chartStyle).toBe('line')
      expect(typeof configOf(id).areaOpacity).toBe('number')
    }
  })

  it('枚举取值都在该字段的选项名单里', () => {
    const stray = RADAR_CHART_PRESETS.flatMap((preset) =>
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
    const overridden = RADAR_CHART_PRESETS.filter((preset) => {
      const palette = preset.config.palette
      return !Array.isArray(palette) || palette.length > 0
    }).map((preset) => preset.id)

    expect(overridden).toEqual([])
  })

  it('每一套的浓度与环数都落在可配区间里', () => {
    const outOfRange = RADAR_CHART_PRESETS.filter((preset) => {
      const opacity = Number(preset.config.areaOpacity)
      const split = Number(preset.config.splitCount)
      return (
        opacity > RADAR_AREA_OPACITY_MAX ||
        split < RADAR_SPLIT_MIN ||
        split > RADAR_SPLIT_MAX
      )
    }).map((preset) => preset.id)

    expect(outOfRange).toEqual([])
  })

  it('双组对比那一套把面调得比单组那一套淡：叠着才分得出谁压着谁', () => {
    expect(Number(configOf('group-compare').areaOpacity)).toBeLessThan(
      Number(configOf('green-factory').areaOpacity),
    )
    expect(configOf('group-compare').chartStyle).toBe('area')
  })

  it('只有净描边那一套开着顶点标签：不铺面时才摆得下数字', () => {
    const labelled = RADAR_CHART_PRESETS.filter(
      (preset) => preset.config.showValueLabel === true,
    ).map((preset) => preset.id)

    expect(labelled).toEqual(['outline-clean'])
    expect(configOf('outline-clean').shape).toBe('circle')
  })

  it('只有紧凑轮关掉图例，且它的说明里写清了代价', () => {
    const off = RADAR_CHART_PRESETS.filter(
      (preset) => preset.config.showLegend !== true,
    )

    expect(off.map((preset) => preset.id)).toEqual(['compact-radar'])
    expect(off[0]?.hint ?? '').toContain('画不出来')
  })

  it('紧凑轮环数最少，四套里只有它开着动画', () => {
    const animated = RADAR_CHART_PRESETS.filter(
      (preset) => preset.config.animation === true,
    ).map((preset) => preset.id)

    expect(animated).toEqual(['compact-radar'])
    expect(configOf('compact-radar').splitCount).toBe(RADAR_SPLIT_MIN + 2)
  })

  it('四套都开着提示框：关掉图例的那一套只剩它能报读数', () => {
    const off = RADAR_CHART_PRESETS.filter(
      (preset) => preset.config.showTooltip !== true,
    ).map((preset) => preset.id)

    expect(off).toEqual([])
  })
})
