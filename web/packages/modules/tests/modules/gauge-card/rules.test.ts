/**
 * @fileoverview 守 gauge-card 自带的值规则表：规整这道门、声明序取首个命中、规则自己的
 * 颜色盖掉语义色，以及配置字段的形状。
 * ⚠ 求值器假定规则已规整：认不出的 `op` 在它那里查不到比较器，会掉进区间分支按
 * `outside` 算（`value2` 缺席时则一律判不中），两种误判都不报错。
 */
import { describe, expect, it } from 'vitest'

import {
  evaluateValueRules,
  normalizeValueRules,
  valueRulesField,
} from '../../../src/modules/gauge-card/rules'

/** 规整一行再求值，省掉每条用例都摊一遍数组。 */
function hitOf(
  value: unknown,
  rows: unknown[],
): ReturnType<typeof evaluateValueRules> {
  return evaluateValueRules(value, normalizeValueRules(rows))
}

describe('规整这道门', () => {
  it('认不出的运算符整行丢掉——留着它会掉进区间分支按 outside 误判', () => {
    expect(normalizeValueRules([{ op: 'nope', value: 1 }])).toEqual([])
  })

  it('阈值不是数的整行丢掉', () => {
    expect(normalizeValueRules([{ op: 'gt', value: '不是数' }])).toEqual([])
    expect(normalizeValueRules([{ op: 'gt' }])).toEqual([])
  })

  it('带引号的数字收得下——规则表是手填与 JSON 粘贴的地方', () => {
    expect(normalizeValueRules([{ op: 'gt', value: '80' }])[0]?.value).toBe(80)
  })

  it('一行的缺省：预警、无色、无文案、不闪', () => {
    expect(normalizeValueRules([{ op: 'gte', value: 0 }])[0]).toEqual({
      op: 'gte',
      value: 0,
      value2: null,
      level: 'warning',
      color: '',
      label: '',
      blink: false,
    })
  })

  it('严重度只认白名单，认不出的回落预警', () => {
    expect(
      normalizeValueRules([{ op: 'gt', value: 1, level: 'fatal' }])[0]?.level,
    ).toBe('warning')
  })

  it('颜色与文案两头空白都去掉', () => {
    const rule = normalizeValueRules([
      { op: 'gt', value: 1, color: ' var(--state-info) ', label: ' 偏高 ' },
    ])[0]

    expect(rule?.color).toBe('var(--state-info)')
    expect(rule?.label).toBe('偏高')
  })

  it('不是数组的原值给空表，不抛', () => {
    expect(normalizeValueRules(undefined)).toEqual([])
    expect(normalizeValueRules('[]')).toEqual([])
  })
})

describe('声明序取首个命中', () => {
  // 一条压力量程的四个分区：高危在前，其余按声明序往下比
  const pressure = [
    { op: 'gt', value: 90, level: 'danger', color: 'var(--state-danger)' },
    { op: 'gt', value: 75, level: 'warning', color: 'var(--state-warning)' },
    { op: 'lt', value: 20, level: 'info', color: 'var(--accent-primary)' },
    { op: 'between', value: 20, value2: 75, level: 'normal', color: '' },
  ]

  it('两档都超时命中最严重的那一条——高危必须排在预警之前', () => {
    expect(hitOf(95, pressure)?.level).toBe('danger')
  })

  it('只超一档时命中那一档', () => {
    expect(hitOf(80, pressure)?.color).toBe('var(--state-warning)')
  })

  it('区间档也算命中，正常也是一档结论', () => {
    const hit = hitOf(50, pressure)

    expect(hit?.level).toBe('normal')
    expect(hit?.color).toBe('var(--state-success)')
  })

  it('颜色留空时回落该严重度的语义色', () => {
    expect(hitOf(10, [{ op: 'lt', value: 20, level: 'info' }])?.color).toBe(
      'var(--state-info)',
    )
  })

  it('严重度只管排序，颜色由规则自己说了算', () => {
    const hit = hitOf(95, [
      { op: 'gt', value: 90, level: 'normal', color: 'var(--chart-hot)' },
    ])

    expect(hit?.level).toBe('normal')
    expect(hit?.color).toBe('var(--chart-hot)')
  })

  it('区间档缺上界一律判不中：拿单值当区间比会让「10 到 20 报警」变成「≥10 就报警」', () => {
    expect(
      hitOf(15, [{ op: 'between', value: 10, level: 'danger' }]),
    ).toBeNull()
  })

  it('区间外那一档两头都算', () => {
    const outside = [{ op: 'outside', value: 10, value2: 20, level: 'danger' }]

    expect(hitOf(5, outside)?.level).toBe('danger')
    expect(hitOf(25, outside)?.level).toBe('danger')
    expect(hitOf(15, outside)).toBeNull()
  })

  it('等于那一档给档位量这类离散读数用', () => {
    const gears = [
      {
        op: 'eq',
        value: 0,
        level: 'normal',
        color: 'var(--state-warning)',
        label: '停机',
      },
      {
        op: 'eq',
        value: 1,
        level: 'normal',
        color: 'var(--state-info)',
        label: '低速',
      },
    ]

    expect(hitOf(1, gears)?.label).toBe('低速')
    expect(hitOf(2, gears)).toBeNull()
  })

  it('缺值与非数一律不命中：凭空一个绿色等于宣布「一切正常」', () => {
    const rules = [{ op: 'lt', value: 100, level: 'normal' }]

    expect(hitOf(undefined, rules)).toBeNull()
    expect(hitOf('80', rules)).toBeNull()
    expect(hitOf(Number.NaN, rules)).toBeNull()
  })

  it('一条规则都没有时给 null，不给兜底色', () => {
    expect(evaluateValueRules(80, [])).toBeNull()
  })

  it('闪烁与文案跟着命中的那一条走', () => {
    const hit = hitOf(99, [{ op: 'gt', value: 90, label: '超限', blink: true }])

    expect(hit).toEqual({
      level: 'warning',
      color: 'var(--state-warning)',
      label: '超限',
      blink: true,
    })
  })
})

describe('配置字段', () => {
  const field = valueRulesField()

  it('缺省的键、标签与说明', () => {
    expect(field.key).toBe('rules')
    expect(field.label).toBe('值规则')
    expect(field.type).toBe('array')
    expect(field.help).toContain('高危规则放前面')
  })

  it('键与标签可以改，同一块上摆两张表时用得着', () => {
    const other = valueRulesField('targetRules', '完成率规则', '判完成率')

    expect(other.key).toBe('targetRules')
    expect(other.label).toBe('完成率规则')
    expect(other.help).toBe('判完成率')
  })

  it('行里有颜色——这正是不复用 shared/thresholds 那张表的理由', () => {
    const color = field.itemSchema?.find((item) => item.key === 'color')

    expect(color?.type).toBe('color')
    expect(color?.default).toBe('')
  })

  it('七个子字段一个不多一个不少', () => {
    expect(field.itemSchema?.map((item) => item.key)).toEqual([
      'op',
      'value',
      'value2',
      'level',
      'color',
      'label',
      'blink',
    ])
  })

  it('上界只在区间两档露面，其余档摆出来就是个不生效的输入框', () => {
    const upper = field.itemSchema?.find((item) => item.key === 'value2')

    expect(upper?.when).toEqual({ key: 'op', in: ['between', 'outside'] })
  })

  it('行名取文案，缺省是空表', () => {
    expect(field.itemLabelKey).toBe('label')
    expect(field.default).toEqual([])
  })
})
