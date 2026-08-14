/**
 * @fileoverview 守阈值评估的分档边界与诚实态：缺值与没配规则一律不告警（不给兜底色）、
 * 按声明序取首个命中、区间档缺上界判不中——把单值当区间比会让「10 到 20 报警」
 * 悄悄变成「≥10 就报警」。
 */
import { describe, expect, it } from 'vitest'

import {
  LEVEL_VAR,
  SEVERITY_RANK,
  THRESHOLD_LEVELS,
  evaluateThresholds,
  isAlarmLevel,
  levelColor,
  normalizeRules,
  thresholdsConfigField,
  type ThresholdRule,
} from '../../src/shared/thresholds'

const DANGER: ThresholdRule = { op: 'gt', value: 80, level: 'danger' }

describe('严重度', () => {
  it('权重升序', () => {
    expect(SEVERITY_RANK.normal).toBeLessThan(SEVERITY_RANK.info)
    expect(SEVERITY_RANK.info).toBeLessThan(SEVERITY_RANK.warning)
    expect(SEVERITY_RANK.warning).toBeLessThan(SEVERITY_RANK.danger)
  })

  it('normal 不算告警，其余都算', () => {
    expect(isAlarmLevel('normal')).toBe(false)
    expect(isAlarmLevel('info')).toBe(true)
    expect(isAlarmLevel('danger')).toBe(true)
  })

  it('颜色只给 CSS 变量引用', () => {
    for (const level of THRESHOLD_LEVELS) {
      expect(levelColor(level)).toBe(LEVEL_VAR[level])
      expect(levelColor(level)).toMatch(/^var\(--/)
    }
  })
})

describe('evaluateThresholds 的诚实态', () => {
  it('缺值不告警', () => {
    expect(evaluateThresholds(null, [DANGER])).toBeNull()
    expect(evaluateThresholds(undefined, [DANGER])).toBeNull()
    expect(evaluateThresholds(Number.NaN, [DANGER])).toBeNull()
  })

  it('没配规则不告警，也不给兜底色', () => {
    expect(evaluateThresholds(999, [])).toBeNull()
  })

  it('真实 0 参与评估', () => {
    expect(
      evaluateThresholds(0, [{ op: 'lte', value: 0, level: 'info' }]),
    ).toEqual({ level: 'info', color: LEVEL_VAR.info, blink: false })
  })

  it('一条都没命中时给 null', () => {
    expect(evaluateThresholds(10, [DANGER])).toBeNull()
  })
})

describe('evaluateThresholds 的命中', () => {
  it('按声明序取首个命中', () => {
    const hit = evaluateThresholds(90, [
      DANGER,
      { op: 'gt', value: 60, level: 'warning' },
    ])

    expect(hit?.level).toBe('danger')
  })

  it('声明序反过来就命中另一条', () => {
    const hit = evaluateThresholds(90, [
      { op: 'gt', value: 60, level: 'warning' },
      DANGER,
    ])

    expect(hit?.level).toBe('warning')
  })

  it('命中带出颜色、闪烁与文案', () => {
    const hit = evaluateThresholds(90, [
      { ...DANGER, blink: true, label: '超温' },
    ])

    expect(hit).toEqual({
      level: 'danger',
      color: LEVEL_VAR.danger,
      blink: true,
      label: '超温',
    })
  })

  it('没写文案时不带 label 键', () => {
    expect(evaluateThresholds(90, [DANGER])).not.toHaveProperty('label')
  })
})

describe('各运算符的边界', () => {
  const hits = (value: number, rule: ThresholdRule) =>
    evaluateThresholds(value, [rule]) !== null

  it('小于与小于等于', () => {
    expect(hits(9, { op: 'lt', value: 10, level: 'info' })).toBe(true)
    expect(hits(10, { op: 'lt', value: 10, level: 'info' })).toBe(false)
    expect(hits(10, { op: 'lte', value: 10, level: 'info' })).toBe(true)
  })

  it('大于与大于等于', () => {
    expect(hits(11, { op: 'gt', value: 10, level: 'info' })).toBe(true)
    expect(hits(10, { op: 'gt', value: 10, level: 'info' })).toBe(false)
    expect(hits(10, { op: 'gte', value: 10, level: 'info' })).toBe(true)
  })

  it('等于与不等于', () => {
    expect(hits(10, { op: 'eq', value: 10, level: 'info' })).toBe(true)
    expect(hits(11, { op: 'eq', value: 10, level: 'info' })).toBe(false)
    expect(hits(11, { op: 'neq', value: 10, level: 'info' })).toBe(true)
    expect(hits(10, { op: 'neq', value: 10, level: 'info' })).toBe(false)
  })

  it('区间内取闭区间', () => {
    const rule: ThresholdRule = {
      op: 'between',
      value: 10,
      value2: 20,
      level: 'info',
    }

    expect(hits(10, rule)).toBe(true)
    expect(hits(20, rule)).toBe(true)
    expect(hits(9.99, rule)).toBe(false)
    expect(hits(20.01, rule)).toBe(false)
  })

  it('区间外是闭区间的补集', () => {
    const rule: ThresholdRule = {
      op: 'outside',
      value: 10,
      value2: 20,
      level: 'info',
    }

    expect(hits(9.99, rule)).toBe(true)
    expect(hits(20.01, rule)).toBe(true)
    expect(hits(10, rule)).toBe(false)
    expect(hits(15, rule)).toBe(false)
  })

  it('上下界写反了照样按 [小, 大] 算', () => {
    const rule: ThresholdRule = {
      op: 'between',
      value: 20,
      value2: 10,
      level: 'info',
    }

    expect(hits(15, rule)).toBe(true)
    expect(hits(25, rule)).toBe(false)
  })

  it('区间档缺上界一律判不中', () => {
    expect(hits(15, { op: 'between', value: 10, level: 'info' })).toBe(false)
    expect(hits(15, { op: 'outside', value: 10, level: 'info' })).toBe(false)
  })
})

describe('normalizeRules', () => {
  it('非数组的原值给空表', () => {
    expect(normalizeRules(undefined)).toEqual([])
    expect(normalizeRules('[]')).toEqual([])
    expect(normalizeRules({ op: 'gt' })).toEqual([])
  })

  it('认不出运算符的行丢掉', () => {
    expect(normalizeRules([{ op: 'nope', value: 1 }])).toEqual([])
    expect(normalizeRules([{ value: 1 }])).toEqual([])
  })

  it('阈值不是有限数的行丢掉', () => {
    expect(normalizeRules([{ op: 'gt', value: '80' }])).toEqual([])
    expect(normalizeRules([{ op: 'gt', value: Number.NaN }])).toEqual([])
    expect(normalizeRules([{ op: 'gt' }])).toEqual([])
  })

  it('不是对象的行丢掉', () => {
    expect(normalizeRules([null, 'gt', 42])).toEqual([])
  })

  it('规整出强类型规则，严重度认不出时回落 warning', () => {
    expect(normalizeRules([{ op: 'gt', value: 80, level: 'bogus' }])).toEqual([
      { op: 'gt', value: 80, level: 'warning', blink: false },
    ])
  })

  it('闪烁只认真正的布尔', () => {
    expect(
      normalizeRules([{ op: 'gt', value: 1, blink: 'yes' }])[0]?.blink,
    ).toBe(false)
    expect(
      normalizeRules([{ op: 'gt', value: 1, blink: true }])[0]?.blink,
    ).toBe(true)
  })

  it('上界是有限数才留下', () => {
    expect(normalizeRules([{ op: 'between', value: 1, value2: 9 }])[0]).toEqual(
      {
        op: 'between',
        value: 1,
        value2: 9,
        level: 'warning',
        blink: false,
      },
    )
    expect(
      normalizeRules([{ op: 'between', value: 1, value2: '' }])[0],
    ).not.toHaveProperty('value2')
  })

  it('文案去首尾空白，空白文案不落键', () => {
    expect(
      normalizeRules([{ op: 'gt', value: 1, label: '  超温 ' }])[0],
    ).toEqual({
      op: 'gt',
      value: 1,
      level: 'warning',
      blink: false,
      label: '超温',
    })
    expect(
      normalizeRules([{ op: 'gt', value: 1, label: '   ' }])[0],
    ).not.toHaveProperty('label')
  })

  it('好行留下、脏行丢掉，顺序不变', () => {
    const rules = normalizeRules([
      { op: 'gt', value: 80, level: 'danger' },
      { op: 'bogus', value: 1 },
      { op: 'lt', value: 10, level: 'info' },
    ])

    expect(rules.map((rule) => rule.level)).toEqual(['danger', 'info'])
  })

  it('规整出来的规则能直接喂给评估', () => {
    const rules = normalizeRules([{ op: 'gte', value: 80, level: 'danger' }])

    expect(evaluateThresholds(80, rules)?.level).toBe('danger')
  })
})

describe('thresholdsConfigField', () => {
  it('缺省生成 thresholds 数组字段，缺省值是空表', () => {
    const field = thresholdsConfigField()

    expect(field.key).toBe('thresholds')
    expect(field.type).toBe('array')
    expect(field.default).toEqual([])
    expect(field.itemLabelKey).toBe('level')
  })

  it('子字段齐全，上界只在区间档显示', () => {
    const item = thresholdsConfigField().itemSchema ?? []

    expect(item.map((field) => field.key)).toEqual([
      'op',
      'value',
      'value2',
      'level',
      'label',
      'blink',
    ])
    expect(item[2]?.when).toEqual({ key: 'op', in: ['between', 'outside'] })
  })

  it('键与文案可改', () => {
    const field = thresholdsConfigField('alarms', '报警线', '说明')

    expect(field.key).toBe('alarms')
    expect(field.label).toBe('报警线')
    expect(field.help).toBe('说明')
  })
})
