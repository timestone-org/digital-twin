/**
 * @fileoverview 逐类总账的算料：最常错判去向、按列重排、无定义排最后。
 *
 * ⚠ 「最常错判成」是这张表上唯一一件矩阵读不出来的事：矩阵里它是一行里最深的
 * 那一格，得靠眼睛横扫；算错了界面上照样是一句通顺的中文，只有用例逮得到。
 */
import { describe, expect, it } from 'vitest'

import {
  DEFAULT_LEDGER_SORT,
  buildClassLedger,
  sortLedger,
} from '@/pages/Modeling/Canvas/scripts/classLedger'
import { buildMatrixStats } from '@/pages/Modeling/Canvas/scripts/matrixStats'

/** 真实 A 错到 C 最多（7 行），真实 B 一行都没错，真实 C 错到 A 最多（5 行）。 */
const LABELS = ['A', 'B', 'C']
const MATRIX = [
  [40, 3, 7],
  [0, 20, 0],
  [5, 1, 30],
]

function ledgerOf(
  labels: readonly string[],
  matrix: readonly (readonly number[])[],
) {
  return buildClassLedger(buildMatrixStats(labels, matrix))
}

describe('每类一行', () => {
  it('最常错判成认的是这一行最深的那一格，不是最后一格', () => {
    const rows = ledgerOf(LABELS, MATRIX)

    expect(rows.map((row) => row.missLabel)).toEqual(['C', '', 'A'])
    expect(rows.map((row) => row.missCount)).toEqual([7, 0, 5])
  })

  it('对角格再多也不算错判', () => {
    const rows = ledgerOf(
      ['A', 'B'],
      [
        [900, 2],
        [1, 3],
      ],
    )

    expect(rows[0]?.missLabel).toBe('B')
    expect(rows[0]?.missCount).toBe(2)
  })

  it('并列时取靠前的那一格，不跟着列序抖', () => {
    const rows = ledgerOf(
      ['A', 'B', 'C'],
      [
        [10, 4, 4],
        [0, 9, 0],
        [0, 0, 9],
      ],
    )

    expect(rows[0]?.missLabel).toBe('B')
  })

  it('行序就是矩阵的行序，支持度与 F1 原样带出来', () => {
    const rows = ledgerOf(LABELS, MATRIX)

    expect(rows.map((row) => row.label)).toEqual(['A', 'B', 'C'])
    expect(rows.map((row) => row.support)).toEqual([50, 20, 36])
    expect(rows[1]?.f1).toBeCloseTo((2 * (20 / 24) * 1) / (20 / 24 + 1), 6)
  })
})

describe('重排', () => {
  it('默认序把最弱的一类排在最上面', () => {
    const rows = sortLedger(ledgerOf(LABELS, MATRIX), DEFAULT_LEDGER_SORT)

    expect(rows.map((row) => row.label)).toEqual(['C', 'A', 'B'])
  })

  it('掉个头就是最强的排最上面', () => {
    const rows = sortLedger(ledgerOf(LABELS, MATRIX), {
      key: 'f1',
      desc: true,
    })

    expect(rows.map((row) => row.label)).toEqual(['B', 'A', 'C'])
  })

  it('按支持度排的是行数，不是 F1', () => {
    const rows = sortLedger(ledgerOf(LABELS, MATRIX), {
      key: 'support',
      desc: true,
    })

    expect(rows.map((row) => row.label)).toEqual(['A', 'C', 'B'])
  })

  it('按最常错判的行数排', () => {
    const rows = sortLedger(ledgerOf(LABELS, MATRIX), {
      key: 'miss',
      desc: true,
    })

    expect(rows.map((row) => row.label)).toEqual(['A', 'C', 'B'])
  })

  // ⚠ F1 无定义 ≠ 0：一次都没出现过的类目若当 0 排，会顶掉真正最差的那一类
  it('F1 无定义的排在最后，掉个头也还在最后', () => {
    const rows = ledgerOf(
      ['A', 'B'],
      [
        [8, 0],
        [0, 0],
      ],
    )
    const up = sortLedger(rows, { key: 'f1', desc: false })
    const down = sortLedger(rows, { key: 'f1', desc: true })

    expect(rows[1]?.f1).toBeNull()
    expect(up.map((row) => row.label)).toEqual(['A', 'B'])
    expect(down.map((row) => row.label)).toEqual(['A', 'B'])
  })

  it('认不出的排序键原样返回，不抛也不乱序', () => {
    const rows = ledgerOf(LABELS, MATRIX)

    expect(
      sortLedger(rows, { key: 'label', desc: false }).map((row) => row.label),
    ).toEqual(['A', 'B', 'C'])
  })

  // ⚠ Array.prototype.sort 是就地排的：直接排上游那份会把矩阵的行序也换掉
  it('重排不动原来那份', () => {
    const rows = ledgerOf(LABELS, MATRIX)

    sortLedger(rows, { key: 'support', desc: true })

    expect(rows.map((row) => row.label)).toEqual(['A', 'B', 'C'])
  })
})
