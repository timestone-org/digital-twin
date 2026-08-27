/**
 * @fileoverview 守两套外观预设的数据面：id 集合、只写清单里有的键、两套写的是同一组
 * 键、枚举取值都在该字段的选项里、色板每条都写全四个子键、颜色一律由主题 token 拼出来、
 * 内容键一个都不写。
 *
 * ⚠ 这几类错法点了按钮什么都不会发生，而 typecheck、lint、build 全绿：
 * 键写错就是「配了不生效」；少写一个键，上一套留在配置里的那个取值原样残留，
 * 而点亮判定做的是子集比较、照样把按钮点亮。
 */
import type { ConfigField } from '@dt/contracts'
import { describe, expect, it } from 'vitest'

import manifest from '../../../src/modules/info-feed/manifest'
import { INFO_FEED_PRESETS } from '../../../src/modules/info-feed/presets'

const SCHEMA = manifest.configSchema
const TOP_KEYS = new Set(SCHEMA.map((field) => field.key))

/** 预设换的是观感，这两个内容键写了就会抹掉用户自己写的字。 */
const CONTENT_KEYS = ['title', 'emptyText']

/** 气象五色里唯一一处没有对应 token 的颜色，由黄与红调出来。 */
const WEATHER_ORANGE =
  'color-mix(in srgb, var(--state-warning) 55%, var(--state-danger))'

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function optionValues(field: ConfigField): unknown[] {
  return (field.options ?? []).map((option) => option.value)
}

/** 一层记录里落在枚举字段上、却不在该字段选项里的取值。 */
function strayEnums(
  fields: readonly ConfigField[],
  record: Record<string, unknown>,
  at: string,
): string[] {
  const found: string[] = []
  for (const [key, value] of Object.entries(record)) {
    const field = fields.find((item) => item.key === key)
    if (field === undefined) continue
    if (field.type === 'enum' && !optionValues(field).includes(value)) {
      found.push(`${at}.${key}=${String(value)}`)
    }
    found.push(...strayNested(field, value, `${at}.${key}`))
  }
  return found
}

function strayNested(field: ConfigField, value: unknown, at: string): string[] {
  if (field.fields !== undefined) {
    return strayEnums(field.fields, asRecord(value), at)
  }
  const rows = field.itemSchema
  if (rows === undefined) return []
  return asArray(value).flatMap((row, index) =>
    strayEnums(rows, asRecord(row), `${at}[${index}]`),
  )
}

/** 深走一份配置，收集每一处颜色取值。 */
function colorsIn(value: unknown, at: string): { at: string; color: string }[] {
  if (Array.isArray(value)) {
    return value.flatMap((row, index) => colorsIn(row, `${at}[${index}]`))
  }
  const record = asRecord(value)
  return Object.entries(record).flatMap(([key, child]) =>
    typeof child === 'string' && /color$/i.test(key)
      ? [{ at: `${at}.${key}`, color: child }]
      : colorsIn(child, `${at}.${key}`),
  )
}

function allColors(): { at: string; color: string }[] {
  return INFO_FEED_PRESETS.flatMap((preset) =>
    colorsIn(preset.config, preset.id),
  )
}

function levelsOf(id: string): Record<string, unknown>[] {
  const preset = INFO_FEED_PRESETS.find((item) => item.id === id)
  return asArray(preset?.config.levels).map(asRecord)
}

describe('信息流的两套预设', () => {
  it('id 集合恰是写死的这两个，顺序即面板上的排布', () => {
    expect(INFO_FEED_PRESETS.map((preset) => preset.id)).toEqual([
      'feed-plain',
      'weather-alert',
    ])
  })

  it('清单挂的就是这一份，不是另抄的一份', () => {
    expect(manifest.configPresets).toBe(INFO_FEED_PRESETS)
  })

  it('每套都有按钮文案与一句话说明', () => {
    const thin = INFO_FEED_PRESETS.filter(
      (preset) => preset.label.trim() === '' || (preset.hint ?? '') === '',
    ).map((preset) => preset.id)

    expect(thin).toEqual([])
  })
})

describe('预设写的键', () => {
  it('每个键都在清单的顶层键集合里', () => {
    const unknown = INFO_FEED_PRESETS.flatMap((preset) =>
      Object.keys(preset.config)
        .filter((key) => !TOP_KEYS.has(key))
        .map((key) => `${preset.id}.${key}`),
    )

    expect(unknown).toEqual([])
  })

  it('两套写的是同一组键——少一个键就会让上一套的那个取值原样残留', () => {
    const shapes = INFO_FEED_PRESETS.map((preset) =>
      Object.keys(preset.config).sort().join(','),
    )

    expect(new Set(shapes).size).toBe(1)
    expect(Object.keys(INFO_FEED_PRESETS[0]?.config ?? {})).toHaveLength(16)
  })

  it('观感键一个不落：顶层十八个字段里除去两个内容键，全在预设里', () => {
    const wrote = new Set(Object.keys(INFO_FEED_PRESETS[0]?.config ?? {}))
    const missing = [...TOP_KEYS].filter(
      (key) => !wrote.has(key) && !CONTENT_KEYS.includes(key),
    )

    expect(missing).toEqual([])
  })

  it('键序跟着清单走——两边不同序时，改哪个字段就得在预设里满篇找', () => {
    const wanted = SCHEMA.map((field) => field.key).filter(
      (key) => !CONTENT_KEYS.includes(key),
    )

    expect(
      INFO_FEED_PRESETS.map((preset) => Object.keys(preset.config)),
    ).toEqual(INFO_FEED_PRESETS.map(() => wanted))
  })

  it('内容键一个都不写：预设换的是观感，不是把用户写的字抹掉', () => {
    const wiped = INFO_FEED_PRESETS.flatMap((preset) =>
      CONTENT_KEYS.filter((key) => key in preset.config).map(
        (key) => `${preset.id}.${key}`,
      ),
    )

    expect(wiped).toEqual([])
    // 反过来锁住这两个键真的在清单里，免得改名之后这条断言变成空转
    expect(CONTENT_KEYS.filter((key) => TOP_KEYS.has(key))).toEqual(
      CONTENT_KEYS,
    )
  })
})

describe('预设写的取值', () => {
  it('每个枚举取值都在该字段的选项里', () => {
    const stray = INFO_FEED_PRESETS.flatMap((preset) =>
      strayEnums(SCHEMA, preset.config, preset.id),
    )

    expect(stray).toEqual([])
  })

  it('扫描器认得出真写错了档位的那一处', () => {
    expect(strayEnums(SCHEMA, { rowBorderStyle: '点线' }, 'demo')).toEqual([
      'demo.rowBorderStyle=点线',
    ])
    expect(strayEnums(SCHEMA, { timePlace: '靠右' }, 'demo')).toEqual([
      'demo.timePlace=靠右',
    ])
  })

  it('扫描器也走得进数组行里的枚举', () => {
    const fake: ConfigField[] = [
      {
        key: 'levels',
        label: '级别色板',
        type: 'array',
        itemSchema: [
          {
            key: 'key',
            label: '级别值',
            type: 'enum',
            options: [{ value: 'red', label: '红' }],
          },
        ],
      },
    ]

    expect(strayEnums(fake, { levels: [{ key: 'orange' }] }, 'demo')).toEqual([
      'demo.levels[0].key=orange',
    ])
  })

  it('色板每一条都写全四个子键，顺序与清单里的子字段逐字相同', () => {
    const wanted = ['key', 'label', 'color', 'rank'].join()
    const drift = INFO_FEED_PRESETS.flatMap((preset) =>
      asArray(preset.config.levels)
        .map((row, index) => ({
          at: `${preset.id}.levels[${index}]`,
          wrote: Object.keys(asRecord(row)).join(),
        }))
        .filter((row) => row.wrote !== wanted),
    )

    expect(drift).toEqual([])
    // 反过来锁住这条断言不是空转：真有配了色板的预设
    expect(levelsOf('weather-alert')).toHaveLength(5)
  })

  it('颜色里没有一处死色值：每一处都由主题 token 拼出来', () => {
    const literal = allColors().filter(
      (entry) =>
        entry.color !== '' &&
        (!entry.color.includes('var(--') ||
          /#[0-9a-f]{3}|\brgba?\s*\(|\bhsla?\s*\(/i.test(entry.color)),
    )

    expect(literal).toEqual([])
  })

  it('扫描器真的走到了色板那一层颜色', () => {
    expect(allColors().map((entry) => entry.at)).toEqual([
      'weather-alert.levels[0].color',
      'weather-alert.levels[1].color',
      'weather-alert.levels[2].color',
      'weather-alert.levels[3].color',
      'weather-alert.levels[4].color',
    ])
  })
})

describe('两套预设各自的身份取值', () => {
  it('缺省那一套留空色板走内置档，只有气象那一套自带色板并开重排', () => {
    const shapes = INFO_FEED_PRESETS.map((preset) => [
      preset.id,
      asArray(preset.config.levels).length,
      preset.config.sortByRank,
    ])

    expect(shapes).toEqual([
      ['feed-plain', 0, false],
      ['weather-alert', 5, true],
    ])
  })

  it('两套的行观感逐字相同：气象那一套只换色板与排序', () => {
    const look = INFO_FEED_PRESETS.map((preset) => [
      preset.config.dotSize,
      preset.config.dotGlow,
      preset.config.levelSize,
      preset.config.textSize,
      preset.config.timeSize,
      preset.config.timePlace,
      preset.config.rowBorderStyle,
      preset.config.rowPadX,
      preset.config.rowPadY,
      preset.config.scrollSpeed,
    ])

    expect(look[0]).toEqual([8, 6, 12, 13, 12, 'right', 'dotted', 4, 7, 3])
    expect(look[1]).toEqual(look[0])
  })

  it('三个开关两套都开着，滚动也都开着', () => {
    const switches = INFO_FEED_PRESETS.map((preset) => [
      preset.config.showDot,
      preset.config.showLevel,
      preset.config.showTime,
      preset.config.autoScroll,
    ])

    expect(switches).toEqual([
      [true, true, true, true],
      [true, true, true, true],
    ])
  })
})

describe('气象那一套的五档级别', () => {
  it('五个级别值互不重复，权重严格降序，橙插在红与黄之间', () => {
    const rows = levelsOf('weather-alert')

    expect(rows.map((row) => row.key)).toEqual([
      'red',
      'orange',
      'yellow',
      'blue',
      'green',
    ])
    // ⚠ 权重重排成 5..1 而不是沿用内置档的 4..1：四档内置权重里没有橙的位置
    expect(rows.map((row) => row.rank)).toEqual([5, 4, 3, 2, 1])
  })

  it('级别文字写的是官方说法，不是把颜色名复述一遍', () => {
    expect(levelsOf('weather-alert').map((row) => row.label)).toEqual([
      '红色预警',
      '橙色预警',
      '黄色预警',
      '蓝色预警',
      '预警解除',
    ])
  })

  it('橙是唯一一处不是直引 token 的颜色，由黄与红两个 token 调出来', () => {
    const mixed = allColors().filter(
      (entry) => !entry.color.startsWith('var(--'),
    )

    // ⚠ 本仓没有橙这一档语义色：顺手映到 warning 会让橙与黄在屏上同色，
    //   五档预警当场塌成四档
    expect(mixed.map((entry) => entry.at)).toEqual([
      'weather-alert.levels[1].color',
    ])
    expect(mixed[0]?.color).toBe(WEATHER_ORANGE)
  })

  it('另外四档直引主题状态色，换肤时跟着走', () => {
    const direct = levelsOf('weather-alert')
      .filter((row) => row.key !== 'orange')
      .map((row) => row.color)

    expect(direct).toEqual([
      'var(--state-danger)',
      'var(--state-warning)',
      'var(--state-info)',
      'var(--state-success)',
    ])
  })
})
