/**
 * @fileoverview 正类反查：摘要里没有「正类是哪一个」这一项，只能由报上来的
 * 精确率与召回率对回混淆矩阵（设计规格 §5-21、R-20）。
 */
import { describe, expect, it } from 'vitest'

import { buildMatrixStats } from '@/pages/Modeling/Canvas/scripts/matrixStats'
import { positiveClassOf } from '@/pages/Modeling/Canvas/scripts/positiveClass'

/** 真实 0 有 8 行（判对 5），真实 1 有 10 行（判对 9）。故意不对称。 */
const ASYMMETRIC = [
  [5, 3],
  [1, 9],
]

function classesOf(
  labels: string[],
  matrix: (number | null)[][],
): ReturnType<typeof buildMatrixStats>['classes'] {
  return buildMatrixStats(labels, matrix).classes
}

const TWO = classesOf(['0', '1'], ASYMMETRIC)

describe('正类反查', () => {
  it('报上来的精确率与召回率对上哪一类，正类就是哪一类', () => {
    const found = positiveClassOf(TWO, [
      ['precision', 9 / 12],
      ['recall', 9 / 10],
    ])

    expect(found).toEqual({ kind: 'found', label: '1' })
  })

  it('换一组数就对到另一类去，不是永远认第二类', () => {
    const found = positiveClassOf(TWO, [
      ['precision', 5 / 6],
      ['recall', 5 / 8],
    ])

    expect(found).toEqual({ kind: 'found', label: '0' })
  })

  // ⚠ P 与 R 双双无定义 ⟺ 正类既没出现也没被判到 ⟺ 它不在 labels 里
  it('精确率与召回率双双无定义时判成「正类不在这份测试集里」', () => {
    const only = classesOf(['0'], [[6]])

    expect(
      positiveClassOf(only, [
        ['precision', null],
        ['recall', null],
      ]),
    ).toEqual({ kind: 'absent', label: '' })
  })

  it('只有一类时那一类就是正类', () => {
    const only = classesOf(['1'], [[7]])

    expect(
      positiveClassOf(only, [
        ['precision', 1],
        ['recall', 1],
      ]),
    ).toEqual({ kind: 'found', label: '1' })
  })

  it('两类的精确率与召回率一模一样时说不知道，不硬挑一个', () => {
    const tie = classesOf(
      ['0', '1'],
      [
        [5, 3],
        [3, 5],
      ],
    )

    expect(
      positiveClassOf(tie, [
        ['precision', 0.625],
        ['recall', 0.625],
      ]),
    ).toEqual({ kind: 'ambiguous', label: '' })
  })

  it('一个类都对不上时说不知道', () => {
    expect(
      positiveClassOf(TWO, [
        ['precision', 0.42],
        ['recall', 0.42],
      ]),
    ).toEqual({ kind: 'ambiguous', label: '' })
  })

  it('摘要里没有精确率这一项时不下任何结论', () => {
    expect(positiveClassOf(TWO, [['accuracy', 0.9]])).toEqual({
      kind: 'unknown',
      label: '',
    })
  })

  it('只有精确率没有召回率时也不下结论', () => {
    expect(positiveClassOf(TWO, [['precision', 0.75]])).toEqual({
      kind: 'unknown',
      label: '',
    })
  })

  // ⚠ 空测试集下 P/R 也是双 null，但那不是「正类不在里面」，是一行都没有
  it('测试集空成一个类目都没有时不说正类缺席', () => {
    expect(
      positiveClassOf(
        [],
        [
          ['precision', null],
          ['recall', null],
        ],
      ),
    ).toEqual({ kind: 'unknown', label: '' })
  })

  it('矩阵读不成方阵时不下结论', () => {
    const broken = classesOf(['0', '1'], [[1, 2]])

    expect(
      positiveClassOf(broken, [
        ['precision', 1],
        ['recall', 1],
      ]),
    ).toEqual({ kind: 'unknown', label: '' })
  })

  it('某一类没被判到过时精确率无定义，仍能靠召回率对上', () => {
    const skewed = classesOf(
      ['0', '1'],
      [
        [4, 0],
        [6, 0],
      ],
    )

    expect(
      positiveClassOf(skewed, [
        ['precision', null],
        ['recall', 0],
      ]),
    ).toEqual({ kind: 'found', label: '1' })
  })
})
