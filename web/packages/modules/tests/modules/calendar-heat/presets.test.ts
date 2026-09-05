/**
 * @fileoverview 守四套外观预设的数据面：id 集合、只写清单里有的顶层键、枚举取值都在
 * 该字段的选项里、每套都把观感键写全（色阶两个端点除外——它们刻意没有 default，
 * 写进去就再也回不到「留空 = 自动」）、内容键一个都不写，以及逐套那几个
 * 「照抄别套就会错」的取值。
 *
 * ⚠ 这几类错法点了按钮什么都不会发生，而 typecheck、lint、build 全绿：
 * 键写错就是「配了不生效」；少写一个键，上一套留在配置里的那个值原样残留，
 * 而点亮判定做的是子集比较、照样把按钮点亮。
 */
import type { ConfigField } from '@dt/contracts'
import { describe, expect, it } from 'vitest'

import manifest from '../../../src/modules/calendar-heat/manifest'
import { CALENDAR_HEAT_PRESETS } from '../../../src/modules/calendar-heat/presets'

const SCHEMA = manifest.configSchema
const TOP_KEYS = new Set(SCHEMA.map((item) => item.key))
const CONTENT_KEYS = manifest.contentKeys ?? []

/**
 * 摆在「样式」分段里、语义却是这块屏的数值口径的那两个键。
 * ⚠ 一套观感把它们写死，等于替用户定量程；而它们刻意没有 `default`，
 * 写进去之后就再也回不到「留空 = 按数据自动定色阶」。
 */
const SCALE_KEYS = ['minValue', 'maxValue']

/** 每一套都该写全的观感键：顶层键去掉内容键，再去掉那两个色阶端点。 */
const STYLE_KEYS = SCHEMA.map((item) => item.key).filter(
  (key) => !CONTENT_KEYS.includes(key) && !SCALE_KEYS.includes(key),
)

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

  it('色阶那两个端点也一个都不写，留空那一档因此还回得去', () => {
    const leaked = CALENDAR_HEAT_PRESETS.flatMap((preset) =>
      SCALE_KEYS.filter((key) => key in preset.config).map(
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
    expect(diverging[0]?.hint ?? '').toContain('正负')
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
