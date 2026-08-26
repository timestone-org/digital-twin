/**
 * @fileoverview 锁住「两份阈值算子表不许漂移」：`@dt/twin2d` 的
 * `TWIN_2D_THRESHOLD_OPS` 与 `shared/thresholds` 的 `THRESHOLD_OPS` 逐字相同，
 * 且同一张输入表两边判出同一个结果。
 * ⚠ `@dt/twin2d` 不许依赖 `@dt/modules`（方向反了），所以八档算子两处各写一份；
 * 悄悄漂移的表现是同一条 `between` 在阈值卡片上成立、在 2D 图上不成立
 * （docs/MODULE_TWIN_2D_DESIGN.md §4.5）。
 * ⚠ 取数口径两侧同样收严：两边的 `isPresent` 都只认真数字，数字字符串在阈值卡片与
 * 2D 图上一律不参与比较——实时读数那条链路上的引号是脏数据不是笔误
 * （`@dt/modules` 的 `shared/config` 写明了这条分工）。
 */
import { describe, expect, it } from 'vitest'
import {
  THRESHOLD_OPS,
  evaluateThresholds,
  normalizeRules,
} from '../../../packages/modules/src/shared/thresholds'
import { TWIN_2D_THRESHOLD_OPS } from '../../../packages/twin2d/src/kinds'
import { normalizeCondition } from '../../../packages/twin2d/src/normalizeExprs'
import { evalCondition } from '../../../packages/twin2d/src/variants'
import type { Twin2dVariantCtx } from '../../../packages/twin2d/src/variants'

/**
 * ⚠ 这几条 import 走文件相对路径而不是各自的包桶：契约要钉的是这两个**文件**的取值域，
 * 走桶的话「桶转出了另一份表」这种漂移反而照样绿。何况 `@dt/modules` 的桶根本不转出
 * thresholds，而 `app` 也没有 `@dt/twin2d` 这条依赖。
 */

/** 八档算子的名字与顺序 */
const EXPECTED_OPS = [
  'lt',
  'lte',
  'gt',
  'gte',
  'between',
  'outside',
  'eq',
  'neq',
]

/** 一行输入：一条规则加一个读数，外加两边都必须判出的结果。 */
interface ParityRow {
  readonly why: string
  readonly op: string
  readonly value: number | null
  readonly value2: number | null
  readonly reading: unknown
  readonly hit: boolean
}

/** 被测读数 */
const READING = 50

const TABLE: readonly ParityRow[] = [
  {
    why: 'lt 严格小于',
    op: 'lt',
    value: 60,
    value2: null,
    reading: READING,
    hit: true,
  },
  {
    why: 'lt 不含端点',
    op: 'lt',
    value: 50,
    value2: null,
    reading: READING,
    hit: false,
  },
  {
    why: 'lte 含端点',
    op: 'lte',
    value: 50,
    value2: null,
    reading: READING,
    hit: true,
  },
  {
    why: 'lte 越界',
    op: 'lte',
    value: 49,
    value2: null,
    reading: READING,
    hit: false,
  },
  {
    why: 'gt 严格大于',
    op: 'gt',
    value: 40,
    value2: null,
    reading: READING,
    hit: true,
  },
  {
    why: 'gt 不含端点',
    op: 'gt',
    value: 50,
    value2: null,
    reading: READING,
    hit: false,
  },
  {
    why: 'gte 含端点',
    op: 'gte',
    value: 50,
    value2: null,
    reading: READING,
    hit: true,
  },
  {
    why: 'gte 越界',
    op: 'gte',
    value: 51,
    value2: null,
    reading: READING,
    hit: false,
  },
  {
    why: 'eq 相等',
    op: 'eq',
    value: 50,
    value2: null,
    reading: READING,
    hit: true,
  },
  {
    why: 'eq 不等',
    op: 'eq',
    value: 49,
    value2: null,
    reading: READING,
    hit: false,
  },
  {
    why: 'neq 不等',
    op: 'neq',
    value: 49,
    value2: null,
    reading: READING,
    hit: true,
  },
  {
    why: 'neq 相等',
    op: 'neq',
    value: 50,
    value2: null,
    reading: READING,
    hit: false,
  },
  {
    why: 'between 含下端点',
    op: 'between',
    value: 50,
    value2: 60,
    reading: READING,
    hit: true,
  },
  {
    why: 'between 含上端点',
    op: 'between',
    value: 40,
    value2: 50,
    reading: READING,
    hit: true,
  },
  {
    why: 'between 区间外',
    op: 'between',
    value: 51,
    value2: 60,
    reading: READING,
    hit: false,
  },
  {
    why: 'between 上下界写反照旧成立',
    op: 'between',
    value: 60,
    value2: 40,
    reading: READING,
    hit: true,
  },
  {
    why: 'between 缺上界判不中',
    op: 'between',
    value: 40,
    value2: null,
    reading: READING,
    hit: false,
  },
  {
    why: 'outside 在区间之外',
    op: 'outside',
    value: 51,
    value2: 60,
    reading: READING,
    hit: true,
  },
  {
    why: 'outside 在区间之内',
    op: 'outside',
    value: 40,
    value2: 60,
    reading: READING,
    hit: false,
  },
  {
    why: 'outside 端点上算区间内',
    op: 'outside',
    value: 50,
    value2: 60,
    reading: READING,
    hit: false,
  },
  {
    why: 'outside 上下界写反照旧不成立',
    op: 'outside',
    value: 60,
    value2: 40,
    reading: READING,
    hit: false,
  },
  {
    why: 'outside 缺上界判不中',
    op: 'outside',
    value: 40,
    value2: null,
    reading: READING,
    hit: false,
  },
  {
    why: '阈值缺省判不中',
    op: 'gt',
    value: null,
    value2: null,
    reading: READING,
    hit: false,
  },
  {
    why: '读数缺省判不中',
    op: 'gt',
    value: 40,
    value2: null,
    reading: null,
    hit: false,
  },
  {
    why: '读数非有限数判不中',
    op: 'gt',
    value: 40,
    value2: null,
    reading: Number.NaN,
    hit: false,
  },
  {
    why: '读数是非数文本判不中',
    op: 'gt',
    value: 40,
    value2: null,
    reading: 'n/a',
    hit: false,
  },
  {
    why: '⚠ 读数是数字字符串时两边一样判不中',
    op: 'gt',
    value: 40,
    value2: null,
    reading: '60',
    hit: false,
  },
  {
    why: '⚠ 带空白的数字字符串同样两边都判不中',
    op: 'gt',
    value: 40,
    value2: null,
    reading: ' 60 ',
    hit: false,
  },
]

/** 2D 图这一侧：条件走归一化，读数从槽位来。 */
function twin2dHit(row: ParityRow): boolean {
  const cond = normalizeCondition({
    kind: 'slot',
    slot: 'v',
    op: row.op,
    value: row.value,
    value2: row.value2,
  })
  if (cond === null) return false
  const ctx: Twin2dVariantCtx = {
    states: new Set(),
    status: null,
    tags: new Map(),
    slots: new Map([['v', row.reading]]),
  }
  return evalCondition(cond, ctx)
}

/** 阈值卡片这一侧：规则走归一化，命中即有一条 hit。 */
function thresholdHit(row: ParityRow): boolean {
  const rules = normalizeRules([
    {
      op: row.op,
      value: row.value,
      value2: row.value2,
      level: 'warning',
    },
  ])
  return evaluateThresholds(row.reading, rules) !== null
}

describe('两份算子表逐字相同', () => {
  it('名字与顺序一模一样——名字对不上时编辑器下拉里的档位落不进另一侧', () => {
    expect([...TWIN_2D_THRESHOLD_OPS]).toEqual([...THRESHOLD_OPS])
  })

  it('八档一个不多一个不少', () => {
    expect([...TWIN_2D_THRESHOLD_OPS]).toEqual(EXPECTED_OPS)
  })
})

describe('同一张输入表两边判定一致', () => {
  it('这张表把八档算子都过了一遍，漏一档等于那一档没被比过', () => {
    const covered = new Set(TABLE.map((row) => row.op))
    expect([...covered].sort()).toEqual([...THRESHOLD_OPS].sort())
  })

  for (const row of TABLE) {
    it(`${row.why}：2D 图与阈值卡片都判 ${row.hit}`, () => {
      expect([twin2dHit(row), thresholdHit(row)]).toEqual([row.hit, row.hit])
    })
  }
})
