/**
 * @fileoverview 守 info-list 自带规则表的三条契约：八档算子与 `shared/thresholds.ts` 逐字相同、
 * 求值只借那一份求值器（声明序取首个、区间闭区间、缺上界判不中），以及 `color` 空串回落语义色。
 * ⚠ 这几条错了都不报错：墙上只是少一个颜色，或者两档都超时显成预警。
 */
import { describe, expect, it } from 'vitest'

import {
  evaluateValueRules,
  normalizeValueRules,
  valueRulesField,
} from '../../../src/modules/info-list/rules'
import {
  levelColor,
  OP_OPTIONS,
  THRESHOLD_OPS,
} from '../../../src/shared/thresholds'

describe('八档算子', () => {
  it('规则表提供的算子与求值器认得的逐字相同', () => {
    const field = valueRulesField()
    const op = field.itemSchema?.find((item) => item.key === 'op')

    expect(OP_OPTIONS.map((option) => option.value)).toEqual([...THRESHOLD_OPS])
    expect(op?.options?.map((option) => option.value)).toEqual([
      ...THRESHOLD_OPS,
    ])
  })

  it('区间两档都是闭区间：端点算在区间内、不算在区间外', () => {
    const inside = normalizeValueRules([
      { op: 'between', value: 35, value2: 45, level: 'warning' },
    ])
    const outside = normalizeValueRules([
      { op: 'outside', value: 35, value2: 45, level: 'danger' },
    ])

    expect(evaluateValueRules(35, inside)).not.toBeNull()
    expect(evaluateValueRules(45, inside)).not.toBeNull()
    expect(evaluateValueRules(34.9, inside)).toBeNull()
    expect(evaluateValueRules(35, outside)).toBeNull()
    expect(evaluateValueRules(45, outside)).toBeNull()
    expect(evaluateValueRules(45.1, outside)).not.toBeNull()
  })

  it('区间上下界倒着填也认，内部先归一', () => {
    const rules = normalizeValueRules([
      { op: 'between', value: 45, value2: 35, level: 'info' },
    ])

    expect(evaluateValueRules(40, rules)).not.toBeNull()
  })

  it('区间缺上界一律判不中——拿单值当区间比会让「10 到 20 报警」变成「≥10 就报警」', () => {
    const rules = normalizeValueRules([{ op: 'between', value: 10 }])

    expect(rules[0]?.value2).toBeNull()
    expect(evaluateValueRules(15, rules)).toBeNull()
    expect(evaluateValueRules(10, rules)).toBeNull()
  })

  it('六个单值算子逐个认得出来', () => {
    const cases: [string, number, number, boolean][] = [
      ['lt', 10, 9, true],
      ['lte', 10, 10, true],
      ['gt', 10, 11, true],
      ['gte', 10, 10, true],
      ['eq', 10, 10, true],
      ['neq', 10, 10, false],
    ]

    for (const [op, bound, value, hits] of cases) {
      const rules = normalizeValueRules([{ op, value: bound }])
      expect(evaluateValueRules(value, rules) !== null).toBe(hits)
    }
  })
})

describe('规整这道门', () => {
  it('认不出的算子整行丢掉——求值器会把它当区间比而静默错判', () => {
    const rules = normalizeValueRules([
      { op: 'approx', value: 10, value2: 20 },
      { op: 'gt', value: 10 },
    ])

    expect(rules).toHaveLength(1)
    expect(rules[0]?.op).toBe('gt')
  })

  it('阈值非有限数整行丢掉', () => {
    expect(normalizeValueRules([{ op: 'gt', value: 'abc' }])).toEqual([])
    expect(normalizeValueRules([{ op: 'gt' }])).toEqual([])
    expect(normalizeValueRules([{ op: 'gt', value: Number.NaN }])).toEqual([])
  })

  it('带引号的数字也收——规则表是 JSON 粘贴的地方', () => {
    const rules = normalizeValueRules([
      { op: 'between', value: '35', value2: '45' },
    ])

    expect(rules[0]?.value).toBe(35)
    expect(rules[0]?.value2).toBe(45)
  })

  it('非数组与脏行都不炸，只是空表', () => {
    expect(normalizeValueRules(undefined)).toEqual([])
    expect(normalizeValueRules('nope')).toEqual([])
    expect(normalizeValueRules([null, 3])).toEqual([])
  })

  it('严重度认不出时落到警告，闪烁与文案原样收下', () => {
    const rules = normalizeValueRules([
      { op: 'gt', value: 1, level: 'unknown', label: ' 偏高 ', blink: true },
    ])

    expect(rules[0]?.level).toBe('warning')
    expect(rules[0]?.label).toBe('偏高')
    expect(rules[0]?.blink).toBe(true)
  })
})

describe('颜色与严重度是两件事', () => {
  it('color 空串回落该 level 的语义色', () => {
    const rules = normalizeValueRules([
      { op: 'gt', value: 1, level: 'danger', color: '' },
    ])

    expect(evaluateValueRules(2, rules)?.color).toBe(levelColor('danger'))
  })

  it('填了 color 就用它，level 只管排序与算不算告警', () => {
    const rules = normalizeValueRules([
      {
        op: 'lt',
        value: 30,
        level: 'normal',
        color: 'var(--accent-primary)',
        label: '低温',
      },
    ])
    const hit = evaluateValueRules(25, rules)

    expect(hit?.color).toBe('var(--accent-primary)')
    expect(hit?.level).toBe('normal')
    expect(hit?.label).toBe('低温')
  })

  it('取声明序里的首个命中，所以高危必须排在预警之前', () => {
    const rules = normalizeValueRules([
      { op: 'gte', value: 90, level: 'danger', label: '超标' },
      { op: 'gte', value: 80, level: 'warning', label: '预警' },
    ])
    const flipped = normalizeValueRules([
      { op: 'gte', value: 80, level: 'warning', label: '预警' },
      { op: 'gte', value: 90, level: 'danger', label: '超标' },
    ])

    expect(evaluateValueRules(95, rules)?.level).toBe('danger')
    expect(evaluateValueRules(95, flipped)?.level).toBe('warning')
  })

  it('缺值与非数一律不命中，不给兜底色', () => {
    const rules = normalizeValueRules([{ op: 'gte', value: 0 }])

    expect(evaluateValueRules(null, rules)).toBeNull()
    expect(evaluateValueRules(undefined, rules)).toBeNull()
    expect(evaluateValueRules('80', rules)).toBeNull()
    expect(evaluateValueRules(Number.NaN, rules)).toBeNull()
  })

  it('一条规则都没配时不命中', () => {
    expect(evaluateValueRules(80, [])).toBeNull()
  })

  it('真实 0 参与判定', () => {
    const rules = normalizeValueRules([{ op: 'eq', value: 0, label: '停机' }])

    expect(evaluateValueRules(0, rules)?.label).toBe('停机')
  })
})

describe('规则表字段', () => {
  it('行内七个子字段齐全，上界只在区间两档出现', () => {
    const field = valueRulesField()
    const keys = field.itemSchema?.map((item) => item.key)
    const upper = field.itemSchema?.find((item) => item.key === 'value2')

    expect(keys).toEqual([
      'op',
      'value',
      'value2',
      'level',
      'color',
      'label',
      'blink',
    ])
    expect(upper?.when).toEqual({ key: 'op', in: ['between', 'outside'] })
  })

  it('整块缺省是空表，行标题跟着文案走', () => {
    const field = valueRulesField('alarmRules', '告警规则')

    expect(field.key).toBe('alarmRules')
    expect(field.label).toBe('告警规则')
    expect(field.type).toBe('array')
    expect(field.default).toEqual([])
    expect(field.itemLabelKey).toBe('label')
  })

  it('颜色那一格给的是取色控件且缺省留空', () => {
    const color = valueRulesField().itemSchema?.find(
      (item) => item.key === 'color',
    )

    expect(color?.type).toBe('color')
    expect(color?.default).toBe('')
  })
})
