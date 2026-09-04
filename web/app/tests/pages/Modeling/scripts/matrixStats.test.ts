/**
 * @fileoverview 混淆矩阵的算料：行是真实、列是预测，以及一整排「算不出来」的退化档。
 *
 * ⚠ 夹具一律用**不对称**矩阵：对称矩阵上把精确率与召回率对调，一条用例都不会红。
 */
import { describe, expect, it } from 'vitest'

import {
  buildMatrixStats,
  MAX_MATRIX_CLASSES,
} from '@/pages/Modeling/Canvas/scripts/matrixStats'

/** 行是真实、列是预测：真实 0 有 8 行（判对 5、判错 3），真实 1 有 10 行。 */
const ASYMMETRIC = [
  [5, 3],
  [1, 9],
]

describe('每类的精确率与召回率', () => {
  it('召回率按行算：这一类真实有多少行，判对了几行', () => {
    const stats = buildMatrixStats(['0', '1'], ASYMMETRIC)

    expect(stats.classes.map((one) => one.recall)).toEqual([5 / 8, 9 / 10])
  })

  it('精确率按列算：判成这一类的有多少行，判对了几行', () => {
    const stats = buildMatrixStats(['0', '1'], ASYMMETRIC)

    expect(stats.classes.map((one) => one.precision)).toEqual([5 / 6, 9 / 12])
  })

  it('行合计是支持度，列合计是被判成这一类的行数', () => {
    const stats = buildMatrixStats(['0', '1'], ASYMMETRIC)

    expect(stats.classes.map((one) => one.support)).toEqual([8, 10])
    expect(stats.classes.map((one) => one.predicted)).toEqual([6, 12])
    expect(stats.classes.map((one) => one.hit)).toEqual([5, 9])
  })

  it('F1 是精确率与召回率的调和平均', () => {
    const stats = buildMatrixStats(['0', '1'], ASYMMETRIC)
    const first = stats.classes[0]
    const precision = 5 / 6
    const recall = 5 / 8

    expect(first?.f1).toBeCloseTo(
      (2 * precision * recall) / (precision + recall),
      12,
    )
  })

  it('两份分布占比分开算：真实占比按行合计，预测占比按列合计', () => {
    const stats = buildMatrixStats(['0', '1'], ASYMMETRIC)

    expect(stats.classes.map((one) => one.actualShare)).toEqual([
      8 / 18,
      10 / 18,
    ])
    expect(stats.classes.map((one) => one.predictedShare)).toEqual([
      6 / 18,
      12 / 18,
    ])
  })

  it('总数、判对数与准确率是对角线之和除以全部', () => {
    const stats = buildMatrixStats(['0', '1'], ASYMMETRIC)

    expect(stats.total).toBe(18)
    expect(stats.correct).toBe(14)
    expect(stats.accuracy).toBe(14 / 18)
    expect(stats.issue).toBe('')
  })

  it('三类也照样是行真实列预测', () => {
    const stats = buildMatrixStats(
      ['低', '中', '高'],
      [
        [4, 1, 0],
        [2, 6, 2],
        [0, 3, 7],
      ],
    )

    expect(stats.classes.map((one) => one.support)).toEqual([5, 10, 10])
    expect(stats.classes.map((one) => one.predicted)).toEqual([6, 10, 9])
    expect(stats.accuracy).toBe(17 / 25)
  })
})

describe('每一格的行内占比', () => {
  it('深浅按行内占比取，不按绝对计数——少数类那一行才看得见', () => {
    const stats = buildMatrixStats(
      ['0', '1'],
      [
        [3, 1],
        [50, 950],
      ],
    )

    expect(stats.cells[0]?.map((cell) => cell.share)).toEqual([3 / 4, 1 / 4])
    expect(stats.cells[1]?.map((cell) => cell.share)).toEqual([0.05, 0.95])
  })

  it('对角格的热力强度就是这一行的召回率', () => {
    const stats = buildMatrixStats(['0', '1'], ASYMMETRIC)

    expect(stats.cells[0]?.[0]?.heat).toBe(5 / 8)
    expect(stats.cells[1]?.[1]?.heat).toBe(9 / 10)
  })

  it('错格的热力强度按全表最深那一格归一，最深的那格是满格', () => {
    const stats = buildMatrixStats(
      ['A', 'B', 'C'],
      [
        [90, 1, 0],
        [0, 50, 500],
        [0, 0, 100],
      ],
    )

    expect(stats.missPeak).toBe(500)
    expect(stats.cells[1]?.[2]?.heat).toBe(1)
    expect(stats.cells[0]?.[1]?.heat).toBeCloseTo(Math.sqrt(1 / 500), 12)
  })

  // ⚠ 按每行的错格最大值归一时这两格都是 1：一行只错了 1 行，会算得和错了
  // 500 行的那一行一样重
  it('只错了 1 行的格子远比错了 500 行的格子浅', () => {
    const stats = buildMatrixStats(
      ['A', 'B', 'C'],
      [
        [90, 1, 0],
        [0, 50, 500],
        [0, 0, 100],
      ],
    )
    const one = stats.cells[0]?.[1]?.heat ?? 0
    const many = stats.cells[1]?.[2]?.heat ?? 0

    expect(many - one).toBeGreaterThan(0.9)
  })

  // ⚠ 线性铺时 1/4/50 会挤在 0.02–0.08 里分不开；开平方后才拉得出三档
  it('小错格开平方压过一道，彼此才分得开', () => {
    const stats = buildMatrixStats(
      ['A', 'B'],
      [
        [500, 1],
        [50, 400],
      ],
    )

    expect(stats.cells[0]?.[1]?.heat).toBeCloseTo(Math.sqrt(1 / 50), 12)
    expect(stats.cells[1]?.[0]?.heat).toBe(1)
  })

  it('一格都没判错时不除零：错格尺子是 0，所有热力强度也是 0', () => {
    const stats = buildMatrixStats(
      ['0', '1'],
      [
        [6, 0],
        [0, 4],
      ],
    )

    expect(stats.missPeak).toBe(0)
    expect(stats.cells[0]?.[1]?.heat).toBe(0)
    expect(stats.cells[1]?.[0]?.heat).toBe(0)
    expect(stats.cells[0]?.[0]?.heat).toBe(1)
  })

  it('计数为 0 的格子热力强度是 0，跟「有一点点」区分开', () => {
    const stats = buildMatrixStats(
      ['0', '1'],
      [
        [6, 0],
        [4, 0],
      ],
    )

    expect(stats.cells[0]?.[1]?.heat).toBe(0)
    expect(stats.cells[1]?.[1]?.heat).toBe(0)
    expect(stats.cells[1]?.[0]?.heat).toBe(1)
  })

  it('对角格标出来，供另一重非颜色编码用', () => {
    const stats = buildMatrixStats(['0', '1'], ASYMMETRIC)

    expect(stats.cells.map((row) => row.map((cell) => cell.isHit))).toEqual([
      [true, false],
      [false, true],
    ])
  })
})

describe('算不出来的那些档', () => {
  it('1×1：只有一类，全判对', () => {
    const stats = buildMatrixStats(['1'], [[7]])

    expect(stats.classes[0]?.precision).toBe(1)
    expect(stats.classes[0]?.recall).toBe(1)
    expect(stats.classes[0]?.f1).toBe(1)
    expect(stats.accuracy).toBe(1)
  })

  it('空矩阵：没有类目也不崩，准确率无定义', () => {
    const stats = buildMatrixStats([], [])

    expect(stats.issue).toBe('')
    expect(stats.classes).toEqual([])
    expect(stats.cells).toEqual([])
    expect(stats.total).toBe(0)
    expect(stats.accuracy).toBeNull()
  })

  it('全零矩阵：一行都没有，四个数全部无定义而不是 0', () => {
    const stats = buildMatrixStats(
      ['0', '1'],
      [
        [0, 0],
        [0, 0],
      ],
    )

    expect(stats.total).toBe(0)
    expect(stats.accuracy).toBeNull()
    expect(stats.classes[0]).toMatchObject({
      precision: null,
      recall: null,
      f1: null,
      actualShare: null,
      predictedShare: null,
    })
    expect(stats.cells[0]?.[0]?.share).toBeNull()
  })

  it('某一类一次都没出现过：召回率无定义，不给 0', () => {
    const stats = buildMatrixStats(
      ['0', '1'],
      [
        [6, 4],
        [0, 0],
      ],
    )

    expect(stats.classes[1]?.support).toBe(0)
    expect(stats.classes[1]?.recall).toBeNull()
    expect(stats.classes[1]?.precision).toBe(0)
    expect(stats.classes[1]?.f1).toBeNull()
  })

  it('某一列一次都没被判到：精确率无定义，不给 0', () => {
    const stats = buildMatrixStats(
      ['0', '1'],
      [
        [6, 0],
        [4, 0],
      ],
    )

    expect(stats.classes[1]?.predicted).toBe(0)
    expect(stats.classes[1]?.precision).toBeNull()
    expect(stats.classes[1]?.recall).toBe(0)
    expect(stats.classes[1]?.f1).toBeNull()
  })

  it('精确率与召回率双零时 F1 的分母也是 0，照样无定义', () => {
    const stats = buildMatrixStats(
      ['0', '1'],
      [
        [0, 3],
        [4, 0],
      ],
    )

    expect(stats.classes[0]?.precision).toBe(0)
    expect(stats.classes[0]?.recall).toBe(0)
    expect(stats.classes[0]?.f1).toBeNull()
    expect(stats.accuracy).toBe(0)
  })

  it('类目数与矩阵行数对不上：照实报出来，不静静画一张错的', () => {
    const stats = buildMatrixStats(['0', '1', '2'], ASYMMETRIC)

    expect(stats.issue).toContain('3 个类目')
    expect(stats.issue).toContain('2 行')
    expect(stats.cells).toEqual([])
    expect(stats.classes).toEqual([])
    expect(stats.accuracy).toBeNull()
  })

  it('某一行的格数对不上：说清是第几行', () => {
    const stats = buildMatrixStats(['0', '1'], [[5, 3], [1]])

    expect(stats.issue).toContain('第 2 行')
    expect(stats.classes).toEqual([])
  })

  it('某一格读不出数：报出来而不是按 0 补', () => {
    const stats = buildMatrixStats(
      ['0', '1'],
      [
        [5, 3],
        [null, 9],
      ],
    )

    expect(stats.issue).toContain('第 2 行')
    expect(stats.total).toBe(0)
  })

  it('负数与非有限数都不是行数', () => {
    expect(buildMatrixStats(['0'], [[-1]]).issue).not.toBe('')
    expect(buildMatrixStats(['0'], [[Number.NaN]]).issue).not.toBe('')
    expect(
      buildMatrixStats(['0'], [[Number.POSITIVE_INFINITY]]).issue,
    ).not.toBe('')
  })

  it('20 类是上限，算得出来', () => {
    const labels = Array.from({ length: MAX_MATRIX_CLASSES }, (_, index) =>
      String(index),
    )
    const matrix = labels.map((_, row) =>
      labels.map((__, column) => (row === column ? 2 : 1)),
    )
    const stats = buildMatrixStats(labels, matrix)

    expect(MAX_MATRIX_CLASSES).toBe(20)
    expect(stats.classes).toHaveLength(20)
    expect(stats.total).toBe(20 * 21)
    expect(stats.correct).toBe(40)
    expect(stats.classes[0]?.recall).toBe(2 / 21)
  })

  it('类名极长也原样带着，截断是画法的事', () => {
    const long = '1#冷冻水泵出口温度异常偏高的那一类样本'
    const stats = buildMatrixStats([long, 'b'], ASYMMETRIC)

    expect(stats.classes[0]?.label).toBe(long)
    expect(stats.labels[0]).toBe(long)
  })
})
