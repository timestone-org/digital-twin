/**
 * @fileoverview 契约：外观字段表与键清单一一对应，且每个枚举的首项恒为「（默认）」空串。
 * ⚠ 少一条字段 = 那个键在面板上根本配不出来；首项不是空串 = 用户没有「回到平台默认」的退路。
 */
import type { CardChrome } from '@dt/contracts'
import { CHROME_KEYS, isChromeKey } from '@dt/contracts'
import { describe, expect, it } from 'vitest'

import {
  CARD_COMMON_FIELDS,
  CARD_FIELD_GROUPS,
  TITLE_PAD_DEFAULT,
  TITLE_PAD_LABELS,
  cardGroupDisabledReason,
  chromeEntries,
  visibleCardFields,
  type CardField,
  type CardFieldContext,
} from '@/pages/DashboardEditor/scripts/cardStyleFields'

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

describe('遍历 chrome 袋子', () => {
  // ⚠ 刻意的语义：袋子落库是自由 JSON，没登记进 CHROME_KEYS 的野键在这里被滤掉，
  //   经面板任一次编辑写回后即不再存在
  it('没登记进清单的野键被过滤', () => {
    const bag = { radius: 8, hack: 'boom', __proto: 1 } as CardChrome

    expect(chromeEntries(bag)).toEqual([['radius', 8]])
  })

  it('值为 undefined 的显式键保留——「平台默认」的删键语义靠它', () => {
    expect(chromeEntries({ bg: undefined })).toEqual([['bg', undefined]])
  })

  it('false 与 0 都是合法取值，原样过', () => {
    expect(chromeEntries({ corners: false, cornerOffset: 0 })).toEqual([
      ['corners', false],
      ['cornerOffset', 0],
    ])
  })

  it('空袋子给空表', () => {
    expect(chromeEntries({})).toEqual([])
  })
})

/** 造一份模块级适配输入。 */
function contextOf(over: Partial<CardFieldContext> = {}): CardFieldContext {
  return {
    chrome: 'card',
    unsupportedKeys: new Set<string>(),
    effective: {},
    ...over,
  }
}

const CORNER_GROUP_FIELDS =
  CARD_FIELD_GROUPS.find((group) => group.id === 'corner')?.fields ?? []

describe('模块级字段过滤', () => {
  it('大屏级面板（不传 context）一个字段都不滤', () => {
    expect(visibleCardFields(CARD_COMMON_FIELDS, undefined)).toBe(
      CARD_COMMON_FIELDS,
    )
  })

  it('清单声明不消费的键被隐藏，其余照常', () => {
    const keys = visibleCardFields(
      CARD_COMMON_FIELDS,
      contextOf({ unsupportedKeys: new Set(['showTitle', 'titleColor']) }),
    ).map((field) => field.key)

    expect(keys).not.toContain('showTitle')
    expect(keys).not.toContain('titleColor')
    expect(keys).toContain('radius')
  })

  it('裸渲染壳隐藏只挂卡片框的四个键', () => {
    const all = [
      ...CARD_COMMON_FIELDS,
      ...CARD_FIELD_GROUPS.flatMap((group) => group.fields),
    ]
    const keys = visibleCardFields(all, contextOf({ chrome: 'bare' })).map(
      (field) => field.key,
    )

    for (const hidden of ['bg', 'backdropBlur', 'hoverLift', 'hoverGlow']) {
      expect(keys, hidden).not.toContain(hidden)
    }
    expect(keys).toContain('borderStyle')
  })

  it('套框壳不隐藏框类键', () => {
    const keys = visibleCardFields(CARD_COMMON_FIELDS, contextOf()).map(
      (field) => field.key,
    )

    expect(keys).toContain('bg')
  })
})

describe('组级禁用判定', () => {
  it('裸渲染没配边框样式时四角组给「先选边框」的原因', () => {
    expect(
      cardGroupDisabledReason('corner', contextOf({ chrome: 'bare' })),
    ).toContain('需先选择边框样式')
  })

  // 「无边框」是显式选择但照样画不出四角：bareBorderClasses 对它给空表
  it('裸渲染显式选了「无边框」同样按没配边框处理', () => {
    expect(
      cardGroupDisabledReason(
        'corner',
        contextOf({ chrome: 'bare', effective: { borderStyle: 'none' } }),
      ),
    ).toContain('需先选择边框样式')
  })

  it('裸渲染配了边框样式后四角组放行', () => {
    expect(
      cardGroupDisabledReason(
        'corner',
        contextOf({ chrome: 'bare', effective: { borderStyle: 'glow' } }),
      ),
    ).toBeNull()
  })

  it('有效 corners=false 时四角组被开关关掉', () => {
    expect(
      cardGroupDisabledReason(
        'corner',
        contextOf({ effective: { corners: false } }),
      ),
    ).toContain('四角辉光')
  })

  // ⚠ 角括号 / 切角两档的角标改喂边框画法，四角组不该随 corners 开关死
  it.each(['bracket', 'cut'])(
    '边框样式是 %s 档时 corners=false 不禁四角组',
    (style) => {
      expect(
        cardGroupDisabledReason(
          'corner',
          contextOf({ effective: { corners: false, borderStyle: style } }),
        ),
      ).toBeNull()
    },
  )

  it('corners 开关自己被壳声明不消费时不做联动禁用', () => {
    expect(
      cardGroupDisabledReason(
        'corner',
        contextOf({
          unsupportedKeys: new Set(['corners']),
          effective: { corners: false },
        }),
      ),
    ).toBeNull()
  })

  it('有效 showTitle=false 时标题条组被开关关掉', () => {
    expect(
      cardGroupDisabledReason(
        'title',
        contextOf({ effective: { showTitle: false } }),
      ),
    ).toContain('显示标题')
  })

  // 容器的标题条走它自己的配置，页头页脚壳里干脆没有条——chrome 的 showTitle
  // 对这几个都落不到任何地方
  it('showTitle 自己在不消费清单里时标题条组不受它锁', () => {
    expect(
      cardGroupDisabledReason(
        'title',
        contextOf({
          unsupportedKeys: new Set(['showTitle']),
          effective: { showTitle: false },
        }),
      ),
    ).toBeNull()
  })

  it('开关都开着时两组都放行，其余组永远放行', () => {
    const open = contextOf({ effective: { corners: true, showTitle: true } })

    expect(cardGroupDisabledReason('corner', open)).toBeNull()
    expect(cardGroupDisabledReason('title', open)).toBeNull()
    for (const id of ['border', 'text', 'fx']) {
      expect(cardGroupDisabledReason(id, open), id).toBeNull()
    }
  })

  it('四角组的判定覆盖了组里每一个键，防止组划分漂移', () => {
    // 组成员变了这条会先红，提醒同步检查禁用判定是否仍然成立
    expect(CORNER_GROUP_FIELDS.map((field) => field.key)).toEqual([
      'cornerStyle',
      'cornerSize',
      'cornerGlow',
      'cornerOpacity',
      'cornerOffset',
    ])
  })
})
