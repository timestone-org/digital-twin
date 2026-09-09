/**
 * @fileoverview 守日历热力预设：观感键完整、内容键隔离，枚举值与清单一致。
 */
import { styleKeysOf, type ConfigField } from '@dt/contracts'
import { describe, expect, it } from 'vitest'

import manifest from '../../../src/modules/calendar-heat/manifest'
import { CALENDAR_HEAT_PRESETS } from '../../../src/modules/calendar-heat/presets'

const SCHEMA = manifest.configSchema
const TOP_KEYS = new Set(SCHEMA.map((item) => item.key))
const CONTENT_KEYS = manifest.contentKeys ?? []
const STYLE_KEYS = styleKeysOf(manifest)

function optionValues(target: ConfigField | undefined): unknown[] {
  return (target?.options ?? []).map((option) => option.value)
}

function configOf(id: string): Record<string, unknown> {
  return CALENDAR_HEAT_PRESETS.find((preset) => preset.id === id)?.config ?? {}
}

describe('日历热力的四套预设', () => {
  it('id 集合恰是写死的这四个，顺序即面板上的排布', () => {
    expect(CALENDAR_HEAT_PRESETS.map((preset) => preset.id)).toEqual([
      'year-calendar',
      'month-matrix',
      'deviation-scan',
      'dense-year',
    ])
  })

  it('每一套都有按钮文案与一句说明', () => {
    const bare = CALENDAR_HEAT_PRESETS.filter(
      (preset) => preset.label === '' || (preset.hint ?? '') === '',
    ).map((preset) => preset.id)

    expect(bare).toEqual([])
  })

  it('只写清单里有的顶层键', () => {
    const stray = CALENDAR_HEAT_PRESETS.flatMap((preset) =>
      Object.keys(preset.config)
        .filter((key) => !TOP_KEYS.has(key))
        .map((key) => `${preset.id}.${key}`),
    )

    expect(stray).toEqual([])
  })

  it('内容键一个都不写，否则套预设会把用户配好的指标与时区抹掉', () => {
    const leaked = CALENDAR_HEAT_PRESETS.flatMap((preset) =>
      CONTENT_KEYS.filter((key) => key in preset.config).map(
        (key) => `${preset.id}.${key}`,
      ),
    )

    expect(leaked).toEqual([])
  })

  it('每一套都把观感键写全，缺一个就会残留上一套的值', () => {
    const missing = CALENDAR_HEAT_PRESETS.flatMap((preset) =>
      STYLE_KEYS.filter((key) => !(key in preset.config)).map(
        (key) => `${preset.id}.${key}`,
      ),
    )

    expect(missing).toEqual([])
    expect(STYLE_KEYS.length).toBeGreaterThan(0)
  })

  it('枚举取值都在该字段的选项名单里', () => {
    const stray = CALENDAR_HEAT_PRESETS.flatMap((preset) =>
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

  it('只有一套换了铺法，其余三套都是日历', () => {
    const matrix = CALENDAR_HEAT_PRESETS.filter(
      (preset) => preset.config.chartStyle === 'matrix',
    ).map((preset) => preset.id)

    expect(matrix).toEqual(['month-matrix'])
  })

  it('只有偏差扫描用发散色阶，且说明里写清了它的适用面', () => {
    const diverging = CALENDAR_HEAT_PRESETS.filter(
      (preset) => preset.config.colorScale === 'diverging',
    )

    expect(diverging.map((preset) => preset.id)).toEqual(['deviation-scan'])
    expect(diverging[0]?.hint ?? '').toContain('双向指标')
  })

  it('紧凑年历把格缝收成 0，四套里只有它开着动画', () => {
    const animated = CALENDAR_HEAT_PRESETS.filter(
      (preset) => preset.config.animation === true,
    ).map((preset) => preset.id)

    expect(animated).toEqual(['dense-year'])
    expect(configOf('dense-year').cellGap).toBe(0)
  })

  it('每一套的格缝都在可配区间里，不会被渲染侧夹回去', () => {
    const outside = CALENDAR_HEAT_PRESETS.filter((preset) => {
      const gap = Number(preset.config.cellGap)
      return !Number.isFinite(gap) || gap < 0 || gap > 6
    }).map((preset) => preset.id)

    expect(outside).toEqual([])
  })

  it('四套都开着提示框：日历上一格就是一个像素块，日期只能靠它认', () => {
    const off = CALENDAR_HEAT_PRESETS.filter(
      (preset) => preset.config.showTooltip !== true,
    ).map((preset) => preset.id)

    expect(off).toEqual([])
  })
})
