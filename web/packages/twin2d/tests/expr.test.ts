/**
 * @fileoverview 守派生槽小语言的求值口径：七档各自的正常与边界、深度上限 3 不递归到栈溢出、
 * `ratio` 分母非正整式为空、`first` 认「有没有值」而显式 0 算有值，以及参考项目那两条
 * 三级兜底链能被这门语言逐字表达出来。
 */
import { describe, expect, it } from 'vitest'

import { evalExpr, exprSlotRefs } from '../src/expr'
import type {
  Twin2dExprValue,
  Twin2dSlotFormats,
  Twin2dSlotValues,
} from '../src/expr'
import type { Twin2dSlotFormat } from '../src/format'
import type { Twin2dExpr } from '../src/typesPrim'

/** 一张空的口径表：`join` 查不到槽位时逐段直拼，其余六档本来就用不上它。 */
const NO_FORMATS: Twin2dSlotFormats = new Map()

/** 不带槽位口径的求值：本文件多数用例只关心取值，不关心显示串。 */
function evalOf(
  expr: Twin2dExpr,
  values: Twin2dSlotValues,
): Twin2dExprValue | null {
  return evalExpr(expr, values, NO_FORMATS)
}

/** 一个槽位的显示口径，只给要改的那几项。 */
function fmt(spec: Partial<Twin2dSlotFormat>): Twin2dSlotFormat {
  return {
    precision: null,
    unit: '',
    enumMap: {},
    placeholder: '—',
    format: 'auto',
    ...spec,
  }
}

function slot(key: string): Twin2dExpr {
  return { kind: 'slot', slot: key }
}

function lit(value: number | string): Twin2dExpr {
  return { kind: 'lit', value }
}

function vals(entries: readonly (readonly [string, unknown])[]) {
  return new Map<string, unknown>(entries)
}

const EMPTY = vals([])

describe('slot 档', () => {
  it('取到什么算什么：数直取，非空文本算有值的文本', () => {
    const values = vals([
      ['a', 12.5],
      ['c', '运行中'],
    ])
    expect(evalOf(slot('a'), values)).toBe(12.5)
    expect(evalOf(slot('c'), values)).toBe('运行中')
  })

  it('槽键不存在、值为空或非有限时给 null 而不抛', () => {
    const values = vals([
      ['nil', null],
      ['blank', '  '],
      ['nan', Number.NaN],
      ['inf', Number.POSITIVE_INFINITY],
      ['flag', true],
    ])
    expect(evalOf(slot('missing'), values)).toBeNull()
    expect(evalOf(slot('nil'), values)).toBeNull()
    expect(evalOf(slot('blank'), values)).toBeNull()
    expect(evalOf(slot('nan'), values)).toBeNull()
    expect(evalOf(slot('inf'), values)).toBeNull()
    expect(evalOf(slot('flag'), values)).toBeNull()
  })

  it('显式 0 算有值——0 kWh 与「取不到」不是一回事', () => {
    expect(evalOf(slot('a'), vals([['a', 0]]))).toBe(0)
  })

  it('⚠ 数字字符串保持为文本：实时读数上的引号是脏数据，不许强转成数参与运算', () => {
    const values = vals([
      ['v', '60'],
      ['w', 5],
    ])
    expect(evalOf(slot('v'), values)).toBe('60')
    expect(
      evalOf({ kind: 'sum', of: [slot('v'), slot('w')] }, values),
    ).toBeNull()
    expect(
      evalOf({ kind: 'join', of: [slot('v'), slot('w')], sep: '/' }, values),
    ).toBe('60/5')
  })
})

describe('lit 档', () => {
  it('数与串原样给出，空串也是作者写死的取值', () => {
    expect(evalOf(lit(3), EMPTY)).toBe(3)
    expect(evalOf(lit('—'), EMPTY)).toBe('—')
    expect(evalOf(lit(''), EMPTY)).toBe('')
  })

  it('非有限的字面量当无值', () => {
    expect(evalOf(lit(Number.NaN), EMPTY)).toBeNull()
  })
})

describe('first 档', () => {
  it('逐个取，第一个有值的赢', () => {
    const expr: Twin2dExpr = {
      kind: 'first',
      of: [slot('a'), slot('b'), lit(-1)],
    }
    expect(evalOf(expr, vals([['b', 5]]))).toBe(5)
  })

  it('⚠ 显式 0 赢过后面的候选，不许被当成「没取到」跳过去', () => {
    const expr: Twin2dExpr = { kind: 'first', of: [slot('a'), slot('b')] }
    const values = vals([
      ['a', 0],
      ['b', 99],
    ])
    expect(evalOf(expr, values)).toBe(0)
  })

  it('一个候选都没值时给 null；空候选表同样给 null', () => {
    expect(
      evalOf({ kind: 'first', of: [slot('a'), slot('b')] }, EMPTY),
    ).toBeNull()
    expect(evalOf({ kind: 'first', of: [] }, EMPTY)).toBeNull()
  })
})

describe('sum 档', () => {
  it('逐项相加', () => {
    const expr: Twin2dExpr = { kind: 'sum', of: [slot('a'), slot('b'), lit(1)] }
    const values = vals([
      ['a', 2],
      ['b', 3],
    ])
    expect(evalOf(expr, values)).toBe(6)
  })

  it('⚠ 缺一项整式为空：少一路的合计会被当成总量读走', () => {
    const expr: Twin2dExpr = { kind: 'sum', of: [slot('a'), slot('b')] }
    expect(evalOf(expr, vals([['a', 2]]))).toBeNull()
  })

  it('文本项不参与相加，整式同样为空', () => {
    expect(evalOf({ kind: 'sum', of: [lit(1), lit('—')] }, EMPTY)).toBeNull()
  })

  it('空项表给 null，溢出成非有限数也给 null', () => {
    expect(evalOf({ kind: 'sum', of: [] }, EMPTY)).toBeNull()
    expect(
      evalOf({ kind: 'sum', of: [lit(1e308), lit(1e308)] }, EMPTY),
    ).toBeNull()
  })
})

describe('ratio 档', () => {
  it('按 scale 放大商', () => {
    const expr: Twin2dExpr = {
      kind: 'ratio',
      num: slot('out'),
      den: slot('in'),
      scale: 100,
    }
    const values = vals([
      ['out', 30],
      ['in', 120],
    ])
    expect(evalOf(expr, values)).toBe(25)
  })

  it('⚠ 分母 0 或负数一律给 null：给 0% 会让「没在跑」和「效率为零」长得一样', () => {
    const expr: Twin2dExpr = {
      kind: 'ratio',
      num: lit(30),
      den: slot('in'),
      scale: 100,
    }
    expect(evalOf(expr, vals([['in', 0]]))).toBeNull()
    expect(evalOf(expr, vals([['in', -5]]))).toBeNull()
    expect(evalOf(expr, EMPTY)).toBeNull()
  })

  it('分子取不到、或结果溢出时给 null', () => {
    expect(
      evalOf({ kind: 'ratio', num: slot('out'), den: lit(2), scale: 1 }, EMPTY),
    ).toBeNull()
    expect(
      evalOf(
        {
          kind: 'ratio',
          num: lit(1),
          den: lit(2),
          scale: Number.POSITIVE_INFINITY,
        },
        EMPTY,
      ),
    ).toBeNull()
  })
})

describe('scale 档', () => {
  it('乘一个常数', () => {
    expect(
      evalOf({ kind: 'scale', of: slot('cop'), by: 100 }, vals([['cop', 4.2]])),
    ).toBe(420)
  })

  it('操作数取不到、或乘出非有限数时给 null', () => {
    expect(
      evalOf({ kind: 'scale', of: slot('cop'), by: 100 }, EMPTY),
    ).toBeNull()
    expect(
      evalOf(
        { kind: 'scale', of: lit(2), by: Number.POSITIVE_INFINITY },
        EMPTY,
      ),
    ).toBeNull()
  })
})

describe('join 档', () => {
  it('按分隔符拼有值的项，缺的项直接跳过', () => {
    const expr: Twin2dExpr = {
      kind: 'join',
      of: [slot('temperature_c'), slot('level_pct')],
      sep: ' · ',
    }
    expect(
      evalOf(
        expr,
        vals([
          ['temperature_c', 58],
          ['level_pct', 72],
        ]),
      ),
    ).toBe('58 · 72')
    expect(evalOf(expr, vals([['temperature_c', 58]]))).toBe('58')
  })

  it('⚠ 一项都拼不出时给 null 而不是空串：空白格看起来像样式坏了', () => {
    const expr: Twin2dExpr = { kind: 'join', of: [slot('a')], sep: ' · ' }
    expect(evalOf(expr, EMPTY)).toBeNull()
  })
})

describe('join 档逐段过槽位口径', () => {
  const reading: Twin2dExpr = {
    kind: 'join',
    of: [slot('temperature_c'), slot('level_pct')],
    sep: ' · ',
  }
  const formats: Twin2dSlotFormats = new Map([
    ['temperature_c', fmt({ precision: 1, unit: '℃' })],
    ['level_pct', fmt({ precision: 0, unit: '%' })],
  ])

  it('单位与精度取自各自的槽位，单位紧贴数值', () => {
    expect(
      evalExpr(
        reading,
        vals([
          ['temperature_c', 100],
          ['level_pct', 0],
        ]),
        formats,
      ),
    ).toBe('100.0℃ · 0%')
  })

  it('缺的那一段照旧整段跳过，留下的那一段仍带自己的单位', () => {
    expect(evalExpr(reading, vals([['level_pct', 82.6]]), formats)).toBe('83%')
  })

  it('映射表也是口径的一部分：命中时出词条且不拼单位', () => {
    const expr: Twin2dExpr = { kind: 'join', of: [slot('s')], sep: '' }
    const table: Twin2dSlotFormats = new Map([
      ['s', fmt({ unit: 'kW', enumMap: { '1': '运行' } })],
    ])
    expect(evalExpr(expr, vals([['s', 1]]), table)).toBe('运行')
  })

  // ⚠ 中间值没有槽位身份：要带单位就把它自己立成一个带单位的派生槽
  it('只有直接写在 join 里的 slot 一档过口径，算出来的中间值直拼', () => {
    const expr: Twin2dExpr = {
      kind: 'join',
      of: [{ kind: 'scale', of: slot('temperature_c'), by: 2 }],
      sep: ' · ',
    }
    expect(evalExpr(expr, vals([['temperature_c', 100]]), formats)).toBe('200')
  })

  it('口径表里查不到这个键时直拼，不编一份缺省口径', () => {
    const expr: Twin2dExpr = { kind: 'join', of: [slot('stored_kwh')], sep: '' }
    expect(evalExpr(expr, vals([['stored_kwh', 12.5]]), formats)).toBe('12.5')
  })

  it('口径只作用在拼接上：同一个槽进四则运算仍是数', () => {
    expect(
      evalExpr(
        { kind: 'sum', of: [slot('temperature_c'), slot('level_pct')] },
        vals([
          ['temperature_c', 100],
          ['level_pct', 0],
        ]),
        formats,
      ),
    ).toBe(100)
  })
})

describe('深度上限', () => {
  const deep: Twin2dExpr = {
    kind: 'scale',
    of: {
      kind: 'scale',
      of: { kind: 'scale', of: slot('a'), by: 1 },
      by: 1,
    },
    by: 1,
  }

  it('三层之内照常求值', () => {
    const three: Twin2dExpr = {
      kind: 'scale',
      of: { kind: 'scale', of: slot('a'), by: 2 },
      by: 3,
    }
    expect(evalOf(three, vals([['a', 5]]))).toBe(30)
  })

  it('第四层整枝给 null，不递归下去', () => {
    expect(evalOf(deep, vals([['a', 5]]))).toBeNull()
  })

  it('超深的枝也不进槽引用表——报成「被引用」会多出一行永远喂不到的槽', () => {
    expect(exprSlotRefs(deep)).toEqual([])
  })
})

describe('exprSlotRefs', () => {
  it('七档都走到，按首次出现去重', () => {
    const expr: Twin2dExpr = {
      kind: 'first',
      of: [
        slot('a'),
        lit(1),
        { kind: 'scale', of: slot('b'), by: 100 },
        { kind: 'ratio', num: slot('a'), den: slot('c'), scale: 100 },
        { kind: 'sum', of: [slot('d')] },
        { kind: 'join', of: [slot('e')], sep: '·' },
      ],
    }
    expect(exprSlotRefs(expr)).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('不含槽引用的算式给空表', () => {
    expect(exprSlotRefs(lit(1))).toEqual([])
  })
})

describe('参考项目的两条三级兜底链', () => {
  const output: Twin2dExpr = {
    kind: 'first',
    of: [slot('output_kwh'), slot('outputKwh'), slot('today_kwh')],
  }
  const efficiency: Twin2dExpr = {
    kind: 'first',
    of: [
      slot('efficiency_pct'),
      { kind: 'scale', of: slot('cop'), by: 100 },
      {
        kind: 'ratio',
        num: slot('output_kwh'),
        den: slot('input_kwh'),
        scale: 100,
      },
    ],
  }

  it('output 三级：三个键各命中一次', () => {
    expect(evalOf(output, vals([['output_kwh', 120]]))).toBe(120)
    expect(evalOf(output, vals([['outputKwh', 121]]))).toBe(121)
    expect(evalOf(output, vals([['today_kwh', 122]]))).toBe(122)
    expect(evalOf(output, EMPTY)).toBeNull()
  })

  it('efficiency 三级：直读 → cop×100 → 出/入×100', () => {
    expect(evalOf(efficiency, vals([['efficiency_pct', 88]]))).toBe(88)
    expect(evalOf(efficiency, vals([['cop', 4.2]]))).toBeCloseTo(420, 10)
    expect(
      evalOf(
        efficiency,
        vals([
          ['output_kwh', 30],
          ['input_kwh', 120],
        ]),
      ),
    ).toBe(25)
  })

  it('⚠ 投入量为 0 时整条链落空，而不是显示 0%', () => {
    const values = vals([
      ['output_kwh', 30],
      ['input_kwh', 0],
    ])
    expect(evalOf(efficiency, values)).toBeNull()
  })

  it('两条链引用到的槽键正是绑点面板要留的那几个', () => {
    expect(exprSlotRefs(output)).toEqual([
      'output_kwh',
      'outputKwh',
      'today_kwh',
    ])
    expect(exprSlotRefs(efficiency)).toEqual([
      'efficiency_pct',
      'cop',
      'output_kwh',
      'input_kwh',
    ])
  })
})
