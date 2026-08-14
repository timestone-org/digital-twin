/**
 * @fileoverview 契约：外观字段表与键清单一一对应，且每个枚举的首项恒为「（默认）」空串。
 * ⚠ 少一条字段 = 那个键在面板上根本配不出来；首项不是空串 = 用户没有「回到平台默认」的退路。
 */
import { CHROME_KEYS, isChromeKey } from '@dt/contracts'
import { describe, expect, it } from 'vitest'

import {
  CARD_COMMON_FIELDS,
  CARD_FIELD_GROUPS,
  TITLE_PAD_DEFAULT,
  TITLE_PAD_LABELS,
  type CardField,
} from '@/pages/DashboardEditor/components/cardStyleFields'

const ALL_FIELDS: CardField[] = [
  ...CARD_COMMON_FIELDS,
  ...CARD_FIELD_GROUPS.flatMap((group) => group.fields),
]

describe('字段表与键清单', () => {
  it('每个字段的键都登记在清单里', () => {
    const stray = ALL_FIELDS.map((field) => field.key).filter(
      (key) => !isChromeKey(key),
    )

    expect(stray, `字段表写了清单外的键：${stray.join(', ')}`).toEqual([])
  })

  it('清单里的每个键都有且只有一条字段', () => {
    const keys = ALL_FIELDS.map((field) => field.key)
    const missing = CHROME_KEYS.map((spec) => spec.key).filter(
      (key) => !keys.includes(key),
    )

    expect(missing, `清单登记了但面板配不出来：${missing.join(', ')}`).toEqual(
      [],
    )
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('分组 id 与文案都不重复', () => {
    const ids = CARD_FIELD_GROUPS.map((group) => group.id)
    const labels = CARD_FIELD_GROUPS.map((group) => group.label)

    expect(new Set(ids).size).toBe(ids.length)
    expect(new Set(labels).size).toBe(labels.length)
  })
})

describe('控件描述', () => {
  it('每个枚举字段都有选项，且首项是删键用的空串', () => {
    const enums = ALL_FIELDS.filter((field) => field.kind === 'enum')

    expect(enums.length).toBeGreaterThan(0)
    for (const field of enums) {
      expect(field.options?.length, field.label).toBeGreaterThan(1)
      expect(field.options?.[0]?.value, field.label).toBe('')
    }
  })

  it('非枚举字段不带选项表', () => {
    for (const field of ALL_FIELDS) {
      if (field.kind !== 'enum')
        expect(field.options, field.label).toBeUndefined()
    }
  })

  it('边框样式的选项从渲染侧目录推导，不是面板另抄一份', () => {
    const field = ALL_FIELDS.find((item) => item.key === 'borderStyle')

    expect(field?.options?.map((option) => option.value)).toEqual([
      '',
      'solid',
      'glow',
      'double',
      'dashed',
      'bracket',
      'cut',
      'breathe',
      'none',
    ])
  })

  it('数值字段的取值域上下限不倒挂', () => {
    for (const field of ALL_FIELDS) {
      const { min, max } = field.range ?? {}
      if (min !== undefined && max !== undefined) {
        expect(min, field.label).toBeLessThan(max)
      }
    }
  })

  it('默认开的开关只有四角辉光与显示标题', () => {
    const on = ALL_FIELDS.filter((field) => field.defaultOn === true)

    expect(on.map((field) => field.key)).toEqual(['corners', 'showTitle'])
  })

  it('标题内边距的三格与平台现值一一对应', () => {
    expect(TITLE_PAD_DEFAULT).toEqual([8, 12, 6])
    expect(TITLE_PAD_LABELS.length).toBe(TITLE_PAD_DEFAULT.length)
  })
})
