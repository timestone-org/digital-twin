/**
 * @fileoverview 守 data-table 的取值层：列与行两份配置的归一化（列键认不出的丢掉、
 * 重复的只留第一条并报出来，行脏了也不丢）、逐格四档、命中值规则的上色、
 * 表头与数据行共用的那一份列宽模板、行数截断与两句空态，以及绑点面板要的行名与行数。
 *
 * ⚠ 四档在注入袋里长得一模一样（键都不存在），全靠 `meta.slots` 分开。
 * ⚠ 行的 `fieldKey` 按下标拼、列的按列键拼，两条不对称，各有一条用例钉着。
 */
import type { ModuleSlotMeta } from '@dt/contracts'
import { describe, expect, it } from 'vitest'

import {
  buildTableView,
  CELL_MARKS,
  CELL_SLOT_KEY,
  cellFieldKey,
  cellText,
  columnsTemplateOf,
  emptyStateOf,
  readTableColumns,
  readTableRows,
  rowDisplayName,
  scanTableColumns,
  TABLE_COLUMNS_KEY,
  TABLE_EMPTY_TEXT,
  TABLE_NO_COLUMN_TEXT,
  TABLE_ROWS_KEY,
  TABLE_RULES_KEY,
  tableRowCounts,
  tableRowLabels,
  type TableColumn,
  type TableView,
} from '../../../src/modules/data-table/cells'

type Slots = Record<string, ModuleSlotMeta>

const TWO_COLUMNS = [
  { key: 'c1', name: '功率', unit: 'kW', precision: 1 },
  { key: 'c3', name: '效率', unit: '%', precision: 0 },
]

const TWO_ROWS = [{ name: '1# 机' }, { name: '2# 机' }]

function build(
  config: Record<string, unknown> = {},
  rows: unknown = undefined,
  slots?: Slots,
): TableView {
  return buildTableView({
    config: {
      [TABLE_COLUMNS_KEY]: TWO_COLUMNS,
      [TABLE_ROWS_KEY]: TWO_ROWS,
      ...config,
    },
    rows,
    slots,
  })
}

/** 第 row 行第 col 列那一格。 */
function cellAt(view: TableView, row: number, col: number) {
  return view.rows[row]?.cells[col]
}

describe('列的归一化', () => {
  it('列键认不出的整条丢掉，认得出的按声明序留下', () => {
    const columns = readTableColumns([
      { key: 'c2', name: '甲' },
      { key: 'c9', name: '不存在的列键' },
      { key: 'c1', name: '乙' },
    ])

    expect(columns.map((column) => column.key)).toEqual(['c2', 'c1'])
  })

  it('列键重复的只留先声明的那一条，并把丢掉的条数报出来', () => {
    const scan = scanTableColumns([
      { key: 'c1', name: '先' },
      { key: 'c1', name: '后' },
      { key: 'c1', name: '更后' },
    ])

    expect(scan.columns.map((column) => column.name)).toEqual(['先'])
    expect(scan.duplicated).toBe(2)
  })

  it('认不出的列键不计进重复条数——它本来就不是一列', () => {
    expect(scanTableColumns([{ key: 'zzz' }]).duplicated).toBe(0)
  })

  it('缺什么补什么：名字与单位空着、对齐回落右对齐、宽度回落 0', () => {
    const [column] = readTableColumns([{ key: 'c4' }])

    expect(column).toEqual({
      key: 'c4',
      name: '',
      unit: '',
      precision: null,
      align: 'right',
      width: 0,
    } satisfies TableColumn)
  })

  it('单位不去首尾空格，列名去', () => {
    const [column] = readTableColumns([
      { key: 'c1', name: '  功率  ', unit: '° C' },
    ])

    expect(column?.name).toBe('功率')
    expect(column?.unit).toBe('° C')
  })

  it('小数位与列宽夹回可配区间，脏值不让整条 CSS 声明作废', () => {
    const [wide] = readTableColumns([
      { key: 'c1', precision: 200, width: 9999 },
    ])
    const [narrow] = readTableColumns([{ key: 'c2', precision: -3, width: -8 }])

    expect(wide?.precision).toBe(6)
    expect(wide?.width).toBe(480)
    expect(narrow?.precision).toBe(0)
    expect(narrow?.width).toBe(0)
  })

  it('留空的小数位是 null 而不是 0——那是「跟随整块」', () => {
    expect(readTableColumns([{ key: 'c1' }])[0]?.precision).toBeNull()
  })
})

describe('行的归一化', () => {
  it('脏行不丢、只补默认：丢一行会让其后每条绑定改喂前一行', () => {
    expect(readTableRows([{ name: '甲' }, 42, null, { name: '乙' }])).toEqual([
      '甲',
      '',
      '',
      '乙',
    ])
  })

  it('没起名的按「第 N 行」称呼', () => {
    expect(rowDisplayName('', 2)).toBe('第 3 行')
    expect(rowDisplayName('甲', 2)).toBe('甲')
  })

  it('行键是行名签名加出现序，重名不撞、也不是下标', () => {
    const view = build({
      [TABLE_ROWS_KEY]: [{ name: '甲' }, { name: '甲' }, { name: '' }],
    })

    expect(view.rows.map((row) => row.key)).toEqual(['甲#0', '甲#1', '#0'])
  })
})

describe('逐格四档', () => {
  it('没配来源、等首帧、取不到、有值各画各的记号', () => {
    const slots: Slots = {
      [cellFieldKey(0, 'c1')]: { state: 'ok' },
      [cellFieldKey(0, 'c3')]: { state: 'pending' },
      [cellFieldKey(1, 'c1')]: { state: 'error', message: '表被删了' },
    }
    const view = build({}, [{ c1: 12.34, c3: 9 }, {}], slots)

    expect(cellAt(view, 0, 0)?.text).toBe('12.3 kW')
    expect(cellAt(view, 0, 1)?.text).toBe(CELL_MARKS.pending)
    expect(cellAt(view, 1, 0)?.text).toBe(CELL_MARKS.error)
    expect(cellAt(view, 1, 1)?.text).toBe(CELL_MARKS.unbound)
  })

  it('三个记号互不相同——共用一个「—」会让断线与没配长得一模一样', () => {
    expect(new Set(Object.values(CELL_MARKS)).size).toBe(3)
  })

  it('非 ok 档一律不带单位：「— kV」看着像是有读数的', () => {
    const view = build({}, [{}], {
      [cellFieldKey(0, 'c1')]: { state: 'error' },
    })

    expect(cellAt(view, 0, 0)?.text).not.toContain('kW')
  })

  it('取不到那一档把取数侧给的原因挂进悬停提示', () => {
    const view = build({}, [{}], {
      [cellFieldKey(0, 'c1')]: { state: 'error', message: '表被删了' },
    })

    expect(cellAt(view, 0, 0)?.title).toContain('表被删了')
  })

  it('运行时没下发逐槽结论时按「有没有值」判，设计态因此照画', () => {
    const view = build({}, [{ c1: 5 }])

    expect(cellAt(view, 0, 0)?.state).toBe('ok')
    expect(cellAt(view, 0, 1)?.state).toBe('unbound')
  })

  it('状态按清单声明的子槽逐一去问，slots 里多出来的键不影响任何一格', () => {
    const view = build({}, [{ c1: 5 }], {
      [cellFieldKey(0, 'c1')]: { state: 'ok' },
      [`${CELL_SLOT_KEY}[0].c1Points`]: { state: 'error' },
    })

    expect(cellAt(view, 0, 0)?.state).toBe('ok')
    expect(view.rows[0]?.cells).toHaveLength(2)
  })
})

describe('数值文本', () => {
  it('千分位开与关走两条不同的口径', () => {
    expect(cellText(12345.678, 1, true)).toBe('12,345.7')
    expect(cellText(12345.678, 1, false)).toBe('12345.7')
  })

  // ⚠ 抹掉尾随零的话，同一列里 91 与 91.9 并排出现，小数点对不上，
  //   整列读起来像两个精度不同的表——而逐列对齐正是表格存在的理由
  it('小数位补零，一列里的小数点因此对得齐', () => {
    expect(cellText(91, 1, false)).toBe('91.0')
    expect(cellText(91.9, 1, false)).toBe('91.9')
    expect(cellText(2, 3, false)).toBe('2.000')
  })

  it('小数位 0 那一档不留小数点', () => {
    expect(cellText(683, 0, false)).toBe('683')
  })

  it('认不出的值照实显示原文，不静默换成占位符', () => {
    expect(cellText('运行中', 2, false)).toBe('运行中')
    expect(cellText(true, 2, false)).toBe('true')
    expect(cellText(false, 2, false)).toBe('false')
  })

  it('只有空白的字符串按缺值处理，不画出一格看不见的空', () => {
    expect(cellText('   ', 2, false)).toBe(CELL_MARKS.unbound)
  })

  it('缺值给「—」而不是 0', () => {
    expect(cellText(null, 2, false)).toBe(CELL_MARKS.unbound)
    expect(cellText(Number.NaN, 2, false)).toBe(CELL_MARKS.unbound)
  })

  it('列自己的小数位压过整块那一档，没配才跟随', () => {
    const view = build({ precision: 3 }, [{ c1: 1.23456, c3: 1.23456 }], {
      [cellFieldKey(0, 'c1')]: { state: 'ok' },
      [cellFieldKey(0, 'c3')]: { state: 'ok' },
    })
    const follower = build(
      { precision: 3, [TABLE_COLUMNS_KEY]: [{ key: 'c1' }] },
      [{ c1: 1.23456 }],
      { [cellFieldKey(0, 'c1')]: { state: 'ok' } },
    )

    expect(cellAt(view, 0, 0)?.text).toBe('1.2 kW')
    expect(cellAt(view, 0, 1)?.text).toBe('1 %')
    expect(cellAt(follower, 0, 0)?.text).toBe('1.235')
  })
})

describe('值规则', () => {
  const RULES = [
    { column: 'c3', op: 'lt', value: 90, level: 'danger', label: '效率偏低' },
  ]

  it('只给挑中的那一列上色，别的列同一个数不动', () => {
    const view = build({ [TABLE_RULES_KEY]: RULES }, [{ c1: 80, c3: 80 }], {
      [cellFieldKey(0, 'c1')]: { state: 'ok' },
      [cellFieldKey(0, 'c3')]: { state: 'ok' },
    })

    expect(cellAt(view, 0, 0)?.color).toBe('')
    expect(cellAt(view, 0, 1)?.color).not.toBe('')
    expect(cellAt(view, 0, 1)?.title).toBe('效率偏低')
  })

  it('挑「全部列」的规则每一列都判', () => {
    const view = build(
      { [TABLE_RULES_KEY]: [{ ...RULES[0], column: '' }] },
      [{ c1: 80, c3: 80 }],
      {
        [cellFieldKey(0, 'c1')]: { state: 'ok' },
        [cellFieldKey(0, 'c3')]: { state: 'ok' },
      },
    )

    expect(cellAt(view, 0, 0)?.color).not.toBe('')
    expect(cellAt(view, 0, 1)?.color).not.toBe('')
  })

  it('没有读数的那几格不判规则——占位符不该被染成告警色', () => {
    const view = build({ [TABLE_RULES_KEY]: [{ ...RULES[0], column: '' }] }, [
      {},
    ])

    expect(cellAt(view, 0, 0)?.color).toBe('')
    expect(cellAt(view, 0, 0)?.blink).toBe(false)
  })
})

describe('列宽模板', () => {
  it('行名列打头，逐列跟在后面；定宽的写 px、不定宽的分剩下的', () => {
    expect(
      columnsTemplateOf(
        readTableColumns([{ key: 'c1', width: 90 }, { key: 'c2' }]),
      ),
    ).toBe('minmax(0, 1.6fr) minmax(0, 90px) minmax(0, 1fr)')
  })

  it('一列都没有时仍给得出行名列那一格', () => {
    expect(columnsTemplateOf([])).toBe('minmax(0, 1.6fr)')
  })

  it('整块只算一次，表头与行读的是同一个字符串', () => {
    const view = build()

    expect(view.columnsTemplate).toBe(columnsTemplateOf(view.columns))
  })
})

describe('空态与截断', () => {
  it('一列都没启用与一行都没配各说各的', () => {
    expect(emptyStateOf({}, [], 3).text).toBe(TABLE_NO_COLUMN_TEXT)
    expect(emptyStateOf({}, readTableColumns(TWO_COLUMNS), 0).text).toBe(
      TABLE_EMPTY_TEXT,
    )
  })

  it('空态文案可换，一串空格不算换', () => {
    const columns = readTableColumns(TWO_COLUMNS)

    expect(emptyStateOf({ emptyText: '未接设备' }, columns, 0).text).toBe(
      '未接设备',
    )
    expect(emptyStateOf({ emptyText: '   ' }, columns, 0).text).toBe(
      TABLE_EMPTY_TEXT,
    )
  })

  it('格子都还没绑不算空：那时照画整张表，逐格自己交代四档', () => {
    const view = build()

    expect(view.empty.isEmpty).toBe(false)
    expect(view.rows).toHaveLength(2)
  })

  it('截断时只画前 N 行，并把「一共几行」写成一句说明', () => {
    const view = build({
      maxRows: 1,
      [TABLE_ROWS_KEY]: [{ name: '甲' }, { name: '乙' }, { name: '丙' }],
    })

    expect(view.rows.map((row) => row.name)).toEqual(['甲'])
    expect(view.notes).toEqual(['已截断：共 3 行，只显示前 1 行。'])
  })

  it('0 = 不限，也不写截断说明', () => {
    const view = build({ maxRows: 0 })

    expect(view.rows).toHaveLength(2)
    expect(view.notes).toEqual([])
  })

  it('列键重复也写一句说明，不静默少画一列', () => {
    const view = build({
      [TABLE_COLUMNS_KEY]: [{ key: 'c1' }, { key: 'c1' }],
    })

    expect(view.columns).toHaveLength(1)
    expect(view.notes[0]).toContain('有 1 列的列键重复')
  })
})

describe('绑点面板要的那两份', () => {
  it('行名的键是该行第一个子槽的 fieldKey', () => {
    expect(tableRowLabels({ [TABLE_ROWS_KEY]: TWO_ROWS })).toEqual({
      [cellFieldKey(0, 'c1')]: { title: '1# 机', id: '1# 机' },
      [cellFieldKey(1, 'c1')]: { title: '2# 机', id: '2# 机' },
    })
  })

  it('没起名的行在面板上仍有个称呼，联动值是空串', () => {
    expect(tableRowLabels({ [TABLE_ROWS_KEY]: [{}] })).toEqual({
      [cellFieldKey(0, 'c1')]: { title: '第 1 行', id: '' },
    })
  })

  it('一行都没有时也给 0，别把键漏掉', () => {
    expect(tableRowCounts({})).toEqual({ [CELL_SLOT_KEY]: 0 })
  })

  it('行数按全量给，不按 maxRows 截断后的给——那几行的绑定还要改得了', () => {
    expect(tableRowCounts({ maxRows: 1, [TABLE_ROWS_KEY]: TWO_ROWS })).toEqual({
      [CELL_SLOT_KEY]: 2,
    })
  })
})

describe('联动值', () => {
  it('上抛的是配置里写的行名，没起名的点了不上抛', () => {
    const view = build({ [TABLE_ROWS_KEY]: [{ name: '甲' }, {}] })

    expect(view.rows[0]?.emitValue).toBe('甲')
    expect(view.rows[1]?.emitValue).toBe('')
  })
})

describe('fieldKey 的两条不对称', () => {
  it('列按列键拼：调顺序不动任何绑定', () => {
    expect(cellFieldKey(2, 'c5')).toBe(`${CELL_SLOT_KEY}[2].c5`)
  })

  it('行按下标拼：删掉中间一行会让其后每一行改喂前一行', () => {
    const before = build({
      [TABLE_ROWS_KEY]: [{ name: '甲' }, { name: '乙' }, { name: '丙' }],
    })
    const after = build({
      [TABLE_ROWS_KEY]: [{ name: '甲' }, { name: '丙' }],
    })

    expect(before.rows[2]?.index).toBe(2)
    expect(after.rows[1]?.index).toBe(1)
  })
})
