/**
 * @fileoverview 三种账的算料：漏斗按单位分组、逐列归因、那一行文字结论，以及
 * 退化分支（空 payload / 空数组 / 全零 / 全 null / 触到上限 / 只有一项）。
 *
 * ⚠ 夹具照抄后端真实产出（`operators/source.py`、`cleaning_report.py`、
 * `fitreport.py`、`featureblocks.py`、`windowblocks.py` 跑出来的 payload），
 * 手编一份形状的话用例会全绿而界面全错。
 */
import { describe, expect, it } from 'vitest'

import {
  blameOf,
  cellsSummary,
  columnsSummary,
  degradedReasonOf,
  dtypesOf,
  groupStages,
  keyedNames,
  noticesOf,
  rangeText,
  ratioPairOf,
  rowsSummary,
  sampleText,
  stagesOf,
} from '@/pages/Modeling/Canvas/scripts/ledgerBlocks'
import type {
  CellChange,
  ColumnChange,
  RowCounts,
} from '@/pages/Modeling/Canvas/scripts/reportBlocks'
import {
  cellsOf,
  columnsOf,
  rowsOf,
} from '@/pages/Modeling/Canvas/scripts/reportBlocks'

// `ledger_source` 真实产出：六级里前三级数的是列、后三级数的是行
const SOURCE_ROWS = {
  before: 5,
  after: 5,
  dropped: 0,
  dropped_blank: 0,
  ratio_configured: null,
  ratio_actual: null,
  funnel: [
    {
      name: '台账列数',
      value: null,
      unit: '列',
      note: '只取了其中几列，台账当前一共几列这里看不到',
    },
    { name: '选中', value: 3, unit: '列', note: '' },
    { name: '丢空列后', value: 2, unit: '列', note: '' },
    { name: '窗口命中', value: 5, unit: '行', note: '' },
    { name: '行数上限', value: 50000, unit: '行', note: '' },
    { name: '实取', value: 5, unit: '行', note: '' },
  ],
  by_column: [],
}

// `drop_missing` 真实产出：丢了 3 行，其中 1 行是判据列全空，两列各摊上 2 行
const HOLED_ROWS = {
  before: 5,
  after: 2,
  dropped: 3,
  dropped_blank: 1,
  ratio_configured: null,
  ratio_actual: 0.4,
  funnel: [
    { name: '进来', value: 5, unit: '行', note: '' },
    {
      name: '被判缺失',
      value: 3,
      unit: '行',
      note: '判据列里有一个空就丢这行',
    },
    { name: '留下', value: 2, unit: '行', note: '' },
  ],
  by_column: [
    { key: '湿度', count: 2, ratio: 0.666667 },
    { key: '露点', count: 2, ratio: 0.666667 },
  ],
}

// `split_dataset` 真实产出：配的 5% 与实际达成的 10% 是两个数
const SPLIT_ROWS = {
  before: 10,
  after: 10,
  dropped: 0,
  dropped_blank: 0,
  ratio_configured: 0.05,
  ratio_actual: 0.1,
  funnel: [
    { name: '切分前', value: 10, unit: '行', note: '' },
    { name: '训练集', value: 9, unit: '行', note: '' },
    { name: '测试集', value: 1, unit: '行', note: '' },
  ],
  by_column: [],
  notes: ['两路来自同一次取数，切分不改出处：下面两个端口的出处一字不差'],
}

// `one_hot` 真实产出
const ONE_HOT_COLUMNS = {
  added: ['机组=甲', '机组=丙', '机组=乙'],
  removed: ['机组'],
  kept: 3,
  dtype_before: [],
  reason: '1 列编成 3 个 0/1 列',
}

// `cast_type` 真实产出：列没有增减，只有一列换了类型
const CAST_COLUMNS = {
  added: [],
  removed: [],
  kept: 2,
  dtype_before: [{ key: '湿度', before: 'string', after: 'number' }],
  reason: '1 列转成数值，转不动的当成空值放过',
}

// `cast_type` 真实产出：转不动的两格连原值一起带回来
const CAST_CELLS = {
  by_column: [
    { key: '湿度', changed: 2, low: null, high: null, samples: ['--', 'n/a'] },
  ],
}

// `clip_outlier` 真实产出：夹它的那两个数在 low/high 上
const CLIP_CELLS = {
  by_column: [
    { key: '露点', changed: 1, low: -10.25, high: 21.25, samples: [100.0] },
  ],
}

function counts(payload: Record<string, unknown>): RowCounts {
  return rowsOf(payload)
}

function change(payload: Record<string, unknown>): ColumnChange {
  return columnsOf(payload)
}

function cells(payload: Record<string, unknown>): CellChange[] {
  return cellsOf(payload)
}

describe('漏斗按单位分组', () => {
  it('列的三级与行的三级各占一条轴', () => {
    const groups = groupStages(stagesOf(counts(SOURCE_ROWS).funnel))

    expect(groups.map((one) => one.unit)).toEqual(['列', '行'])
    expect(groups[0]?.stages.map((one) => one.name)).toEqual([
      '台账列数',
      '选中',
      '丢空列后',
    ])
    expect(groups[1]?.stages.map((one) => one.value)).toEqual([5, 50000, 5])
  })

  it('拿不到的那一级留成 null 并带着它自己的说明', () => {
    const [first] = stagesOf(counts(SOURCE_ROWS).funnel)

    expect(first?.value).toBeNull()
    expect(first?.note).toContain('台账当前一共几列这里看不到')
  })

  it('名字读不出来的那一级丢掉，不画一条没有名字的条', () => {
    const stages = stagesOf([
      { value: 3, unit: '行' },
      { name: '实取', value: 5 },
    ])

    expect(stages).toHaveLength(1)
    expect(stages[0]?.name).toBe('实取')
    expect(stages[0]?.unit).toBe('')
  })

  it('一级都没有时分不出组，不是分出一个空组', () => {
    expect(groupStages(stagesOf([]))).toEqual([])
  })

  it('同一个单位隔着别的单位再出现时仍归回原来那一组', () => {
    const groups = groupStages(
      stagesOf([
        { name: '甲', value: 1, unit: '行' },
        { name: '乙', value: 2, unit: '列' },
        { name: '丙', value: 3, unit: '行' },
      ]),
    )

    expect(groups).toHaveLength(2)
    expect(groups[0]?.stages.map((one) => one.name)).toEqual(['甲', '丙'])
  })
})

describe('按列归因', () => {
  it('列名与行数照搬，占比留成后端算的那个', () => {
    const blame = blameOf(counts(HOLED_ROWS).byColumn)

    expect(blame).toHaveLength(2)
    expect(blame[0]).toEqual({ key: '湿度', count: 2, ratio: 0.666667 })
  })

  it('列名读不出来的那一项丢掉，个数读不出来的按零算', () => {
    const blame = blameOf([{ count: 4 }, { key: '露点' }])

    expect(blame).toEqual([{ key: '露点', count: 0, ratio: null }])
  })

  it('一列都没归因时是空清单', () => {
    expect(blameOf(counts(SOURCE_ROWS).byColumn)).toEqual([])
  })
})

describe('行数的那一行结论', () => {
  it('丢了多少、其中多少是空值、谁摊得最多，四个数都在', () => {
    const found = rowsSummary(
      counts(HOLED_ROWS),
      blameOf(counts(HOLED_ROWS).byColumn),
    )

    expect(found).toBe(
      '5 行 → 2 行，丢了 3 行（60%），其中 1 行是因为有空值（33.3%），' +
        '按列看最多的是「湿度」：2 行，占丢掉那些行的 66.7%',
    )
  })

  it('行数变了但一行都没丢时不说「丢」——折进桶里的行不是丢掉的行', () => {
    const found = rowsSummary(counts({ before: 100, after: 10 }), [])

    expect(found).toBe('100 行 → 10 行，行数变了，但这一步没有丢行')
  })

  it('一行都没进来时占比写不出来，那就一个括号都不写', () => {
    const found = rowsSummary(counts({ before: 0, after: 0, dropped: 2 }), [])

    expect(found).toBe('0 行 → 0 行，丢了 2 行')
  })

  it('payload 整个读不出来时退化成 0 行 → 0 行，不是抛错', () => {
    expect(rowsSummary(counts({}), [])).toBe('0 行 → 0 行，一行都没丢')
  })

  it('一行都没丢时归因只报行数，不编一个占比出来', () => {
    const found = rowsSummary(counts({ before: 5, after: 5 }), [
      { key: '露点@lag2', count: 2, ratio: 0.4 },
    ])

    expect(found).toBe(
      '5 行 → 5 行，一行都没丢，按列看最多的是「露点@lag2」：2 行',
    )
  })

  it('上万行按千分位写，读得出量级', () => {
    const found = rowsSummary(counts({ before: 12480, after: 8336 }), [])

    expect(found).toContain('12,480 行 → 8,336 行')
  })
})

describe('配的比例与实际达成的比例', () => {
  it('两个数都印，且明说它们不一样', () => {
    const pair = ratioPairOf(counts(SPLIT_ROWS))

    expect(pair).toEqual({ configured: '5%', actual: '10%', isApart: true })
  })

  it('只有实际达成时另一个印成「—」，不是不印', () => {
    const pair = ratioPairOf(counts(HOLED_ROWS))

    expect(pair).toEqual({ configured: '—', actual: '40%', isApart: false })
  })

  it('两个都没有时整行不出现', () => {
    expect(ratioPairOf(counts(SOURCE_ROWS))).toBeNull()
  })

  it('两个数一样时不摆那句提醒', () => {
    const pair = ratioPairOf(
      counts({ ratio_configured: 0.2, ratio_actual: 0.2 }),
    )

    expect(pair?.isApart).toBe(false)
  })
})

describe('列的账', () => {
  it('结果列数、新增与移除三个数都在', () => {
    const found = change(ONE_HOT_COLUMNS)

    expect(columnsSummary(found, dtypesOf(found.dtypeBefore))).toBe(
      '这一步之后一共 3 列：新增 3 列、移除 1 列',
    )
  })

  it('只换了类型时说的是换类型，不是新增或移除', () => {
    const found = change(CAST_COLUMNS)

    expect(columnsSummary(found, dtypesOf(found.dtypeBefore))).toBe(
      '这一步之后一共 2 列：1 列换了类型',
    )
  })

  it('一列都没动时照实说没动，不留一个半句', () => {
    expect(columnsSummary(change({}), [])).toBe(
      '这一步之后一共 0 列：这一步一列都没动',
    )
  })

  it('类型对照缺了哪一头都整行丢掉：半行读不出换了什么', () => {
    const found = dtypesOf([
      { key: '湿度', before: 'string' },
      { key: '露点', before: 'string', after: 'number' },
    ])

    expect(found).toEqual([
      {
        key: '露点',
        before: 'string',
        after: 'number',
        cast: 'string → number',
      },
    ])
  })
})

describe('格子的账', () => {
  it('列数、总格数与摊得最多的那一列都在，并说清行数没变', () => {
    expect(cellsSummary(cells(CAST_CELLS))).toBe(
      '1 列上一共改了 2 个格子，行数一行都没变；最多的是「湿度」：2 格',
    )
  })

  it('一列都没有时说「一个格子都没被改」，不是一片空白', () => {
    expect(cellsSummary(cells({ by_column: [] }))).toBe(
      '一个格子都没有被改，行数也没变',
    )
  })

  it('最多的那一列按格数挑，不是按后端给的顺序挑第一个', () => {
    const found = cellsSummary([
      { key: '露点', changed: 1, low: null, high: null, samples: [] },
      { key: '湿度', changed: 9, low: null, high: null, samples: [] },
    ])

    expect(found).toContain('最多的是「湿度」：9 格')
  })

  it('夹它的那两个数照数写', () => {
    const [only] = cells(CLIP_CELLS)

    expect(rangeText(only?.low ?? null, only?.high ?? null)).toBe(
      '-10.25 ~ 21.25',
    )
  })

  it('两端都没有时说清是因为这一列不是数值，不印一段空区间', () => {
    expect(rangeText(null, null)).toBe('没有区间（这一列不是数值）')
  })

  it('只有一端时另一端印成「—」', () => {
    expect(rangeText(3, null)).toBe('3 ~ —')
  })

  it('同一个列名讲两遍时后一个排号，两行不会撞成一行', () => {
    expect(keyedNames(['露点', '湿度', '露点'])).toEqual([
      '露点',
      '湿度',
      '露点·2',
    ])
  })

  it('原值样例：文本一个字不改、数走统一写法、空值明说是空', () => {
    expect(sampleText('--')).toBe('--')
    expect(sampleText('n/a')).toBe('n/a')
    expect(sampleText(100)).toBe('100')
    expect(sampleText(1.23456789)).toBe('1.2346')
    expect(sampleText(null)).toBe('（空）')
  })
})

describe('块上挂的话', () => {
  // ⚠ 两档并在同一个 `notes` 键里、逐句带 `level`（规格 §4.3）：照「两个键」读
  // 的话两档双双读成空，而界面上「没有话要说」与「话被读丢了」长得一模一样
  it('口径说明与告警分成两档搬出来', () => {
    const found = noticesOf({
      notes: [
        { level: 'hint', text: '开头那几行是空值不是 0' },
        { level: 'alert', text: '这一步让整条流水线不可上线' },
      ],
    })

    expect(found.notes).toEqual(['开头那几行是空值不是 0'])
    expect(found.alerts).toEqual(['这一步让整条流水线不可上线'])
  })

  // ⚠ 档次读不出来的按口径说明收，不是丢掉：后端早期那一版发的是纯字符串
  it('没写档次的那一句按口径说明收下，不当没说过', () => {
    const found = noticesOf({ notes: ['开头那几行是空值不是 0'] })

    expect(found.notes).toEqual(['开头那几行是空值不是 0'])
    expect(found.alerts).toEqual([])
  })

  it('没挂话、或挂的不是一串文字时都是空清单', () => {
    expect(noticesOf({}).notes).toEqual([])
    expect(noticesOf({ alerts: '一句话' }).alerts).toEqual([])
    expect(noticesOf({ notes: ['', 7] }).notes).toEqual([])
  })

  it('退化的那一句只在后端说退化了时才出现', () => {
    const degraded = {
      degraded: true,
      degraded_reason: '图里下游的切分不是恰好一个',
    }

    expect(degradedReasonOf(degraded)).toBe('图里下游的切分不是恰好一个')
    expect(
      degradedReasonOf({ degraded: false, degraded_reason: '这句不该印' }),
    ).toBe('')
    expect(degradedReasonOf({})).toBe('')
  })
})
