/**
 * @fileoverview 守 info-feed 取值表的三条契约：两张档位表自身自洽（档值唯一、白名单与表同序）、
 * 内置级别档表逐字对回参考源码（11 个级别词 → 四支主题状态色 + 权重），以及「气象橙刻意没有
 * 内置映射」这条收敛被钉死。
 * ⚠ 这几条错了一条都不报错：面板照样能选，渲染静默回落，墙上只是少一档颜色或多一档同色。
 */
import { describe, expect, it } from 'vitest'

import {
  FEED_BORDER_STYLE_VALUES,
  FEED_BORDER_STYLES,
  FEED_BUILTIN_LEVELS,
  FEED_LEVEL_ALIASES,
  FEED_LEVEL_LABELS,
  FEED_TIME_PLACE_VALUES,
  FEED_TIME_PLACES,
  FEED_UNKNOWN_LEVEL,
} from '../../../src/modules/info-feed/options'
import {
  levelColor,
  SEVERITY_RANK,
  THRESHOLD_LEVELS,
} from '../../../src/shared/thresholds'

/** 一张待检的取值表：名字只为让失败信息说得出是哪一张。 */
interface OptionTable {
  name: string
  options: readonly { readonly value: string; readonly label: string }[]
  values: readonly string[]
}

const TABLES: readonly OptionTable[] = [
  {
    name: '行分隔线',
    options: FEED_BORDER_STYLES,
    values: FEED_BORDER_STYLE_VALUES,
  },
  {
    name: '时刻落点',
    options: FEED_TIME_PLACES,
    values: FEED_TIME_PLACE_VALUES,
  },
]

describe('取值表自身自洽', () => {
  it('两张表都登记了，表名也不重复', () => {
    expect(TABLES).toHaveLength(2)
    expect(new Set(TABLES.map((table) => table.name)).size).toBe(TABLES.length)
  })

  it('每张表的档值互不重复，也没有空档', () => {
    for (const table of TABLES) {
      const unique = new Set(table.options.map((option) => option.value))

      expect([table.name, unique.size]).toEqual([
        table.name,
        table.options.length,
      ])
      expect([table.name, table.options.every((o) => o.value !== '')]).toEqual([
        table.name,
        true,
      ])
    }
  })

  it('每一档都配了中文标签，不是把档值抄一遍', () => {
    for (const table of TABLES) {
      const named = table.options.every(
        (option) => option.label !== '' && option.label !== option.value,
      )

      expect([table.name, named]).toEqual([table.name, true])
    }
  })

  it('白名单与选项表逐项同序——两边手抄迟早漂，档位就静默回落了', () => {
    for (const table of TABLES) {
      expect([table.name, [...table.values]]).toEqual([
        table.name,
        table.options.map((option) => option.value),
      ])
    }
  })

  it('分隔线四档、时刻两档，档序对回参考源码', () => {
    expect([...FEED_BORDER_STYLE_VALUES]).toEqual([
      'dotted',
      'dashed',
      'solid',
      'none',
    ])
    expect([...FEED_TIME_PLACE_VALUES]).toEqual(['right', 'left'])
  })
})

describe('内置级别档表', () => {
  it('11 个级别词一个不多一个不少', () => {
    expect(Object.keys(FEED_BUILTIN_LEVELS).sort()).toEqual([
      'blue',
      'danger',
      'error',
      'green',
      'info',
      'normal',
      'red',
      'success',
      'warn',
      'warning',
      'yellow',
    ])
  })

  it('四支颜色全部引用主题状态色，本模块里零颜色字面量', () => {
    const colors = Object.values(FEED_BUILTIN_LEVELS).map(
      (style) => style.color,
    )

    expect(colors.every((color) => color.startsWith('var(--state-'))).toBe(true)
    expect(new Set(colors).size).toBe(4)
  })

  it('每一档的颜色就是共用严重度色表那一支，同屏的告警列表与信息流同色', () => {
    for (const level of THRESHOLD_LEVELS) {
      for (const alias of FEED_LEVEL_ALIASES[level]) {
        expect([alias, FEED_BUILTIN_LEVELS[alias]?.color]).toEqual([
          alias,
          levelColor(level),
        ])
      }
    }
  })

  it('权重按严重度降序，且整体比共用那份高一档——0 号留给未识别级别', () => {
    const ranks = {
      danger: FEED_BUILTIN_LEVELS.danger?.rank,
      warning: FEED_BUILTIN_LEVELS.warning?.rank,
      info: FEED_BUILTIN_LEVELS.info?.rank,
      success: FEED_BUILTIN_LEVELS.success?.rank,
    }

    expect(ranks).toEqual({ danger: 4, warning: 3, info: 2, success: 1 })
    expect(FEED_BUILTIN_LEVELS.danger?.rank).toBe(SEVERITY_RANK.danger + 1)
    expect(FEED_UNKNOWN_LEVEL.rank).toBe(0)
  })

  it('别名与本名共用同一档，颜色权重文字三样都一致', () => {
    expect(FEED_BUILTIN_LEVELS.red).toEqual(FEED_BUILTIN_LEVELS.danger)
    expect(FEED_BUILTIN_LEVELS.error).toEqual(FEED_BUILTIN_LEVELS.danger)
    expect(FEED_BUILTIN_LEVELS.yellow).toEqual(FEED_BUILTIN_LEVELS.warning)
    expect(FEED_BUILTIN_LEVELS.warn).toEqual(FEED_BUILTIN_LEVELS.warning)
    expect(FEED_BUILTIN_LEVELS.blue).toEqual(FEED_BUILTIN_LEVELS.info)
    expect(FEED_BUILTIN_LEVELS.green).toEqual(FEED_BUILTIN_LEVELS.success)
    expect(FEED_BUILTIN_LEVELS.normal).toEqual(FEED_BUILTIN_LEVELS.success)
  })

  it('气象橙没有内置映射——映到警告那一档会让橙与黄在屏上同色', () => {
    expect(FEED_BUILTIN_LEVELS.orange).toBeUndefined()
    expect(FEED_BUILTIN_LEVELS.amber).toBeUndefined()
    expect(
      Object.values(FEED_BUILTIN_LEVELS).filter(
        (style) => style.color === levelColor('warning'),
      ),
    ).toHaveLength(3)
  })

  it('未识别级别不注入颜色也不编造文字', () => {
    expect(FEED_UNKNOWN_LEVEL).toEqual({ color: '', label: '', rank: 0 })
  })

  it('级别文字是本模块自己那一套，危险不叫危急', () => {
    expect(FEED_LEVEL_LABELS).toEqual({
      normal: '正常',
      info: '提示',
      warning: '警告',
      danger: '危险',
    })
    expect(FEED_BUILTIN_LEVELS.red?.label).toBe('危险')
  })

  it('别名表四档齐全，11 个词分完不重叠', () => {
    const all = THRESHOLD_LEVELS.flatMap((level) => FEED_LEVEL_ALIASES[level])

    expect(Object.keys(FEED_LEVEL_ALIASES).sort()).toEqual(
      [...THRESHOLD_LEVELS].sort(),
    )
    expect(all).toHaveLength(11)
    expect(new Set(all).size).toBe(11)
  })

  it('级别词一律小写——查表前两侧都归一，表里留个大写词就永远命不中', () => {
    const keys = Object.keys(FEED_BUILTIN_LEVELS)

    expect(keys.filter((key) => key !== key.toLowerCase())).toEqual([])
    expect(keys.filter((key) => key.trim() !== key)).toEqual([])
  })
})
