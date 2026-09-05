/**
 * @fileoverview 守四套外观预设的数据面：id 集合、只写清单里有的顶层键、枚举取值都在
 * 该字段的选项里、每套都把观感键写全（`precision` / `grouping` 两个数值口径键除外，
 * 一套观感把它们抹掉等于让用户配好的精度消失）、内容键一个都不写，
 * 以及逐套那几个「照抄别套就会错」的取值。
 *
 * ⚠ 这几类错法点了按钮什么都不会发生，而 typecheck、lint、build 全绿：
 * 键写错就是「配了不生效」；少写一个键，上一套留在配置里的那个值原样残留，
 * 而点亮判定做的是子集比较、照样把按钮点亮。
 */
import type { ConfigField } from '@dt/contracts'
import { describe, expect, it } from 'vitest'

import manifest from '../../../src/modules/data-table/manifest'
import { DATA_TABLE_PRESETS } from '../../../src/modules/data-table/presets'

const SCHEMA = manifest.configSchema
const TOP_KEYS = new Set(SCHEMA.map((item) => item.key))
const CONTENT_KEYS = manifest.contentKeys ?? []

/**
 * 摆在「数据」分段里、语义是这块屏数值口径的那两个键。
 * ⚠ 一套观感把它们抹掉，用户配好的三位小数会在换个样子时消失。
 */
const FORMAT_KEYS = ['precision', 'grouping']

/** 每一套都该写全的观感键：顶层键去掉内容键，再去掉那两个数值口径键。 */
const STYLE_KEYS = SCHEMA.map((item) => item.key).filter(
  (key) => !CONTENT_KEYS.includes(key) && !FORMAT_KEYS.includes(key),
)

function optionValues(target: ConfigField | undefined): unknown[] {
  return (target?.options ?? []).map((option) => option.value)
}

function configOf(id: string): Record<string, unknown> {
  return DATA_TABLE_PRESETS.find((preset) => preset.id === id)?.config ?? {}
}

describe('数据表格的四套预设', () => {
  it('id 集合恰是写死的这四个，顺序即面板上的排布', () => {
    expect(DATA_TABLE_PRESETS.map((preset) => preset.id)).toEqual([
      'dense-matrix',
      'ledger',
      'wall-board',
      'top-ten',
    ])
  })

  it('每一套都有按钮文案与一句说明', () => {
    const bare = DATA_TABLE_PRESETS.filter(
      (preset) => preset.label === '' || (preset.hint ?? '') === '',
    ).map((preset) => preset.id)

    expect(bare).toEqual([])
  })

  it('只写清单里有的顶层键', () => {
    const stray = DATA_TABLE_PRESETS.flatMap((preset) =>
      Object.keys(preset.config)
        .filter((key) => !TOP_KEYS.has(key))
        .map((key) => `${preset.id}.${key}`),
    )

    expect(stray).toEqual([])
  })

  it('内容键一个都不写，否则套预设会把用户配好的列与行抹掉', () => {
    const leaked = DATA_TABLE_PRESETS.flatMap((preset) =>
      CONTENT_KEYS.filter((key) => key in preset.config).map(
        (key) => `${preset.id}.${key}`,
      ),
    )

    expect(leaked).toEqual([])
  })

  it('数值口径那两个键也一个都不写', () => {
    const leaked = DATA_TABLE_PRESETS.flatMap((preset) =>
      FORMAT_KEYS.filter((key) => key in preset.config).map(
        (key) => `${preset.id}.${key}`,
      ),
    )

    expect(leaked).toEqual([])
  })

  it('每一套都把观感键写全，缺一个就会残留上一套的值', () => {
    const missing = DATA_TABLE_PRESETS.flatMap((preset) =>
      STYLE_KEYS.filter((key) => !(key in preset.config)).map(
        (key) => `${preset.id}.${key}`,
      ),
    )

    expect(missing).toEqual([])
    expect(STYLE_KEYS.length).toBeGreaterThan(0)
  })

  it('枚举取值都在该字段的选项名单里', () => {
    const stray = DATA_TABLE_PRESETS.flatMap((preset) =>
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

  it('没有一套写死读数颜色，配色因此跟着主题走', () => {
    const painted = DATA_TABLE_PRESETS.filter(
      (preset) => preset.config.valueColor !== '',
    ).map((preset) => preset.id)

    expect(painted).toEqual([])
  })

  it('四套里只有前十行截行，且它的说明里写清了代价', () => {
    const capped = DATA_TABLE_PRESETS.filter(
      (preset) => preset.config.maxRows !== 0,
    )

    expect(capped.map((preset) => preset.id)).toEqual(['top-ten'])
    expect(capped[0]?.hint).toContain('看不见')
  })

  it('大屏看板是四套里字号最大的一套', () => {
    const sizes = DATA_TABLE_PRESETS.map((preset) =>
      Number(preset.config.valueSize),
    )

    expect(Math.max(...sizes)).toBe(Number(configOf('wall-board').valueSize))
  })

  it('台账清单靠线分格，因此关掉斑马纹', () => {
    expect(configOf('ledger').gridLines).toBe('both')
    expect(configOf('ledger').striped).toBe(false)
  })

  it('行少的那一套不钉表头，其余三套都钉', () => {
    const loose = DATA_TABLE_PRESETS.filter(
      (preset) => preset.config.headerSticky === false,
    ).map((preset) => preset.id)

    expect(loose).toEqual(['wall-board'])
  })

  it('四套都留着表头：关掉之后没有一处写着这几列各是什么', () => {
    const hidden = DATA_TABLE_PRESETS.filter(
      (preset) => preset.config.showHeader !== true,
    ).map((preset) => preset.id)

    expect(hidden).toEqual([])
  })
})
