/**
 * @fileoverview 守两门小语言的口径：派生槽算式最多三层且超深整条返回 null（不许截断成
 * 半截式子）、`join` 的分隔符不许 trim、变体条件认不出的算子与空取值集合一律丢弃
 * （不许悄悄回落到某一档，那会让同一条 between 在两处结论相反）。
 */
import { describe, expect, it } from 'vitest'

import { normalizeCondition, normalizeExpr } from '../src/normalizeExprs'

describe('normalizeExpr 的取档', () => {
  it('非对象与认不出的算子一律丢弃', () => {
    expect(normalizeExpr(null)).toBeNull()
    expect(normalizeExpr({ kind: 'pow', of: [] })).toBeNull()
  })

  it('slot 引用空 key 时丢弃', () => {
    expect(normalizeExpr({ kind: 'slot', slot: ' ' })).toBeNull()
    expect(normalizeExpr({ kind: 'slot', slot: ' cop ' })).toEqual({
      kind: 'slot',
      slot: 'cop',
    })
  })

  it('lit 只收有限数与字符串，非有限数与其它类型丢弃', () => {
    expect(normalizeExpr({ kind: 'lit', value: 0 })).toEqual({
      kind: 'lit',
      value: 0,
    })
    expect(normalizeExpr({ kind: 'lit', value: '—' })).toEqual({
      kind: 'lit',
      value: '—',
    })
    expect(normalizeExpr({ kind: 'lit', value: Number.NaN })).toBeNull()
    expect(normalizeExpr({ kind: 'lit', value: true })).toBeNull()
  })
})

describe('normalizeExpr 的列表算子', () => {
  it('一个操作数都不剩时整条丢弃', () => {
    expect(normalizeExpr({ kind: 'first', of: [] })).toBeNull()
    expect(normalizeExpr({ kind: 'sum', of: ['x'] })).toBeNull()
  })

  it('first 与 sum 逐项收，坏的一项丢弃、其余照旧', () => {
    expect(
      normalizeExpr({
        kind: 'first',
        of: [{ kind: 'slot', slot: 'a' }, 'x', { kind: 'lit', value: 1 }],
      }),
    ).toEqual({
      kind: 'first',
      of: [
        { kind: 'slot', slot: 'a' },
        { kind: 'lit', value: 1 },
      ],
    })
    expect(
      normalizeExpr({ kind: 'sum', of: [{ kind: 'lit', value: 2 }] }),
    ).toEqual({ kind: 'sum', of: [{ kind: 'lit', value: 2 }] })
  })

  it('join 的分隔符原样保留两侧空格，非字符串回空串', () => {
    expect(
      normalizeExpr({
        kind: 'join',
        sep: ' · ',
        of: [{ kind: 'slot', slot: 'a' }],
      }),
    ).toEqual({ kind: 'join', sep: ' · ', of: [{ kind: 'slot', slot: 'a' }] })
    expect(
      normalizeExpr({
        kind: 'join',
        sep: 3,
        of: [{ kind: 'slot', slot: 'a' }],
      }),
    ).toEqual({ kind: 'join', sep: '', of: [{ kind: 'slot', slot: 'a' }] })
  })
})

describe('normalizeExpr 的算术算子', () => {
  it('scale 缺操作数时丢弃，倍率取不到数回 1', () => {
    expect(normalizeExpr({ kind: 'scale', by: 100 })).toBeNull()
    expect(
      normalizeExpr({ kind: 'scale', of: { kind: 'slot', slot: 'cop' } }),
    ).toEqual({ kind: 'scale', of: { kind: 'slot', slot: 'cop' }, by: 1 })
  })

  it('ratio 缺分子或分母时整条丢弃', () => {
    expect(
      normalizeExpr({ kind: 'ratio', num: { kind: 'slot', slot: 'a' } }),
    ).toBeNull()
    expect(
      normalizeExpr({ kind: 'ratio', den: { kind: 'slot', slot: 'b' } }),
    ).toBeNull()
  })

  it('ratio 不给放大倍数时回 1', () => {
    expect(
      normalizeExpr({
        kind: 'ratio',
        num: { kind: 'slot', slot: 'a' },
        den: { kind: 'slot', slot: 'b' },
      }),
    ).toEqual({
      kind: 'ratio',
      num: { kind: 'slot', slot: 'a' },
      den: { kind: 'slot', slot: 'b' },
      scale: 1,
    })
  })

  it('ratio 的放大倍数收数字串', () => {
    expect(
      normalizeExpr({
        kind: 'ratio',
        num: { kind: 'slot', slot: 'a' },
        den: { kind: 'slot', slot: 'b' },
        scale: '100',
      }),
    ).toEqual({
      kind: 'ratio',
      num: { kind: 'slot', slot: 'a' },
      den: { kind: 'slot', slot: 'b' },
      scale: 100,
    })
  })
})

describe('normalizeExpr 的深度上限', () => {
  it('三层的兜底链完整留着', () => {
    const chain = {
      kind: 'first',
      of: [
        { kind: 'slot', slot: 'efficiency_pct' },
        { kind: 'scale', of: { kind: 'slot', slot: 'cop' }, by: 100 },
      ],
    }
    expect(normalizeExpr(chain)).toEqual(chain)
  })

  it('第四层被丢掉，父级因此少一个操作数而不是算出半截结果', () => {
    const tooDeep = {
      kind: 'first',
      of: [
        {
          kind: 'sum',
          of: [{ kind: 'scale', of: { kind: 'slot', slot: 'a' }, by: 2 }],
        },
      ],
    }
    expect(normalizeExpr(tooDeep)).toBeNull()
  })

  it('从非零深度进入时余量随之缩短', () => {
    expect(normalizeExpr({ kind: 'slot', slot: 'a' }, 2)).toEqual({
      kind: 'slot',
      slot: 'a',
    })
    expect(normalizeExpr({ kind: 'slot', slot: 'a' }, 3)).toBeNull()
  })
})

describe('normalizeCondition 的匹配类三档', () => {
  it('非对象与认不出的 kind 一律丢弃', () => {
    expect(normalizeCondition('hover')).toBeNull()
    expect(normalizeCondition({ kind: 'weather' })).toBeNull()
  })

  it('state 认不出那一档时丢弃整条', () => {
    expect(normalizeCondition({ kind: 'state', state: 'pressed' })).toBeNull()
    expect(normalizeCondition({ kind: 'state', state: 'hover' })).toEqual({
      kind: 'state',
      state: 'hover',
    })
  })

  it('status 只留白名单内的档、按四档顺序排、去重', () => {
    expect(
      normalizeCondition({
        kind: 'status',
        in: ['alarm', 'online', 'alarm', 'hidden'],
      }),
    ).toEqual({ kind: 'status', in: ['online', 'alarm'] })
  })

  it('status 一档都没剩时丢弃整条', () => {
    expect(normalizeCondition({ kind: 'status', in: ['hidden'] })).toBeNull()
  })

  it('tag 的键值只 trim 与截断、不做白名单，空键或空集合丢弃', () => {
    const long = 'x'.repeat(80)
    const condition = normalizeCondition({
      kind: 'tag',
      key: ` ${long} `,
      in: [long, 'waste-heat', 'waste-heat'],
    })
    expect(condition).toEqual({
      kind: 'tag',
      key: 'x'.repeat(64),
      in: ['x'.repeat(64), 'waste-heat'],
    })
    expect(normalizeCondition({ kind: 'tag', key: ' ', in: ['a'] })).toBeNull()
    expect(normalizeCondition({ kind: 'tag', key: 'k', in: [] })).toBeNull()
  })
})

describe('normalizeCondition 的取值类两档', () => {
  it('slot 认不出算子时整条丢弃，不回落到 eq', () => {
    expect(
      normalizeCondition({ kind: 'slot', slot: 'a', op: 'contains' }),
    ).toBeNull()
    expect(normalizeCondition({ kind: 'slot', slot: ' ', op: 'lt' })).toBeNull()
  })

  it('slot 的两个界值取不到数时是 null，不是 0', () => {
    expect(
      normalizeCondition({ kind: 'slot', slot: 'p', op: 'between', value: 1 }),
    ).toEqual({
      kind: 'slot',
      slot: 'p',
      op: 'between',
      value: 1,
      value2: null,
    })
  })

  it('has 的槽位集合为空时丢弃，判定模式缺省 any', () => {
    expect(normalizeCondition({ kind: 'has', slots: [' '] })).toBeNull()
    expect(normalizeCondition({ kind: 'has', slots: ['a', 'a', 'b'] })).toEqual(
      { kind: 'has', slots: ['a', 'b'], mode: 'any' },
    )
    expect(
      normalizeCondition({ kind: 'has', slots: ['a'], mode: 'all' }),
    ).toEqual({ kind: 'has', slots: ['a'], mode: 'all' })
  })
})

describe('normalizeCondition 的 not 嵌套', () => {
  it('取反里套的条件不合法时整条丢弃', () => {
    expect(normalizeCondition({ kind: 'not', of: { kind: 'x' } })).toBeNull()
    expect(
      normalizeCondition({
        kind: 'not',
        of: { kind: 'state', state: 'alarm' },
      }),
    ).toEqual({ kind: 'not', of: { kind: 'state', state: 'alarm' } })
  })

  it('嵌套过深的取反整条丢弃', () => {
    const wrap = (depth: number): unknown =>
      depth === 0
        ? { kind: 'state', state: 'hover' }
        : { kind: 'not', of: wrap(depth - 1) }
    expect(normalizeCondition(wrap(4))).not.toBeNull()
    expect(normalizeCondition(wrap(5))).toBeNull()
  })
})

describe('normalizeCondition 的 field 一档', () => {
  it('字段名不在三档白名单里整条丢弃', () => {
    expect(
      normalizeCondition({ kind: 'field', field: 'x', in: ['a'] }),
    ).toBeNull()
    expect(
      normalizeCondition({ kind: 'field', field: 'labelPos', in: ['top'] }),
    ).toEqual({ kind: 'field', field: 'labelPos', test: 'in', in: ['top'] })
  })

  it('判据缺席按 in 走，空名单整条丢弃', () => {
    expect(
      normalizeCondition({ kind: 'field', field: 'badgeShape', in: [] }),
    ).toBeNull()
    expect(
      normalizeCondition({ kind: 'field', field: 'badgeShape', in: ['  '] }),
    ).toBeNull()
  })

  // ⚠ present 一档本就不带名单：要一份名单等于让用户把角标可能的取值全枚举一遍
  it('present 一档不看名单，空名单照样成立', () => {
    expect(
      normalizeCondition({ kind: 'field', field: 'badge', test: 'present' }),
    ).toEqual({ kind: 'field', field: 'badge', test: 'present', in: [] })
  })

  it('判据认不出时退回 in，于是空名单照旧整条丢弃', () => {
    expect(
      normalizeCondition({ kind: 'field', field: 'badge', test: 'maybe' }),
    ).toBeNull()
    expect(
      normalizeCondition({
        kind: 'field',
        field: 'badge',
        test: 'maybe',
        in: ['A', 'A', 'B'],
      }),
    ).toEqual({ kind: 'field', field: 'badge', test: 'in', in: ['A', 'B'] })
  })
})
