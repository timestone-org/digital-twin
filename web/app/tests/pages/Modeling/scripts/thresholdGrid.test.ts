/**
 * @fileoverview 阈值网格：滑杆停在哪一档、那一档的四格与四个指标是什么。
 *
 * ⚠ 夹具是后端真跑出来的那四档（概率 [0.9, 0.8, 0.4, 0.1]、真实 [1, 0, 1, 0]），
 * 四格与 F1 都能手算：0.800 那一档 (tp, fp, tn, fn) = (1, 1, 1, 1)，四个指标
 * 因此全是 0.5——与同一份讲解里 ② 区那四个数一个字不差。
 * ⚠ 分母为 0 的比率必须是 null：写成 0 会被读成「判成正类的全错了」。
 */
import { describe, expect, it } from 'vitest'

import {
  buildThresholdGrid,
  standAt,
} from '@/pages/Modeling/Canvas/scripts/thresholdGrid'

// 后端真实产出。⚠ 它是按阈值**从高到低**给的，滑杆要的是从低到高
const ITEMS = [
  { name: '0.900', threshold: 0.9, tp: 1, fp: 0, tn: 2, fn: 1, value: 2 / 3 },
  { name: '0.800', threshold: 0.8, tp: 1, fp: 1, tn: 1, fn: 1, value: 0.5 },
  { name: '0.400', threshold: 0.4, tp: 2, fp: 1, tn: 1, fn: 0, value: 0.8 },
  { name: '0.100', threshold: 0.1, tp: 2, fp: 2, tn: 0, fn: 0, value: 2 / 3 },
]

// 打分时判成正类的行里最低的那个概率
const TRAINED = 0.8

const GRID = { label: '', unit: '', score_kind: '', baseline: TRAINED, items: ITEMS }

function built(baseline: number | null = TRAINED) {
  return buildThresholdGrid({ ...GRID, baseline }, baseline)
}

function valueOf(seat: number, key: string): number | null {
  const found = standAt(built(), seat).cards.find((card) => card.key === key)
  return found?.value ?? null
}

describe('网格排成滑杆能查的表', () => {
  it('按阈值从低到高排：往右推就是把门槛抬高', () => {
    expect(built().rows.map((row) => row.threshold)).toEqual([
      0.1, 0.4, 0.8, 0.9,
    ])
  })

  it('默认停在打分时用的那一档，而不是最中间或第一档', () => {
    const grid = built()

    expect(grid.trainedSeat).toBe(2)
    expect(grid.rows[grid.trainedSeat]?.text).toBe('0.800')
    expect(grid.isExact).toBe(true)
  })

  // ⚠ 网格是从全部不同概率值上抽出来的几十档，打分时那个阈值不一定被抽中
  it('打分那个阈值没被抽中时就近停，并且不谎称正好是它', () => {
    const grid = built(0.85)

    expect(grid.rows[grid.trainedSeat]?.text).toBe('0.800')
    expect(grid.isExact).toBe(false)
  })

  it('一行都没判成正类时停在最高那一档，并照实说', () => {
    const grid = built(null)

    expect(grid.trainedSeat).toBe(3)
    expect(standAt(grid, 3).offset).toContain('一行都没判成正类')
  })

  it('四格缺一个整数的那一档整档不要，不补 0', () => {
    const broken = {
      ...GRID,
      items: [...ITEMS, { name: '0.700', threshold: 0.7, tp: 1, fp: 0, tn: 1 }],
    }

    expect(buildThresholdGrid(broken, TRAINED).rows).toHaveLength(4)
  })

  it('一档都没有时表是空的，站上去也不编数', () => {
    const empty = buildThresholdGrid({ ...GRID, items: [] }, TRAINED)

    expect(empty.rows).toEqual([])
    expect(standAt(empty, 0).summary).toBe('这一块一档阈值都没有')
    expect(standAt(empty, 0).cards).toEqual([])
  })

  it('拖到表外时不画一张假矩阵', () => {
    expect(standAt(built(), 9).matrix).toEqual([])
  })
})

describe('站定一档：混淆矩阵与四个指标', () => {
  it('默认那一档的矩阵是 (tp, fn) / (fp, tn) 四格，行是真实、列是判成', () => {
    const stand = standAt(built(), 2)

    expect(stand.labels).toEqual(['正类', '负类'])
    expect(stand.matrix).toEqual([
      [1, 1],
      [1, 1],
    ])
  })

  // 与同一份讲解 ② 区那四个数逐个相等：滑杆没动过时两处必须一个字不差
  it.each([
    ['accuracy', 0.5],
    ['precision', 0.5],
    ['recall', 0.5],
    ['f1', 0.5],
  ])('默认那一档的 %s 是 %s', (key, want) => {
    expect(valueOf(2, key)).toBe(want)
  })

  it('拖到最低那一档：全判正类，召回率满、准确率掉到 0.5', () => {
    const stand = standAt(built(), 0)

    expect(stand.matrix).toEqual([
      [2, 0],
      [2, 0],
    ])
    expect(valueOf(0, 'recall')).toBe(1)
    expect(valueOf(0, 'accuracy')).toBe(0.5)
    expect(valueOf(0, 'f1')).toBeCloseTo(2 / 3, 12)
  })

  it('拖到最高那一档：只判中一行，精确率满而召回率掉一半', () => {
    expect(valueOf(3, 'precision')).toBe(1)
    expect(valueOf(3, 'recall')).toBe(0.5)
    expect(valueOf(3, 'accuracy')).toBe(0.75)
  })

  // ⚠ 与后端同一档的 F1 对齐：两侧各算一遍而算法漂了，同屏两个数就会打架
  it.each([0, 1, 2, 3])('第 %s 档的 F1 与后端那一档给的数相等', (seat) => {
    const rows = built().rows
    const row = rows[seat]
    const want = ITEMS.find((item) => item.threshold === row?.threshold)?.value

    expect(valueOf(seat, 'f1')).toBeCloseTo(want ?? -1, 12)
  })

  /** 一档四格，四个指标折成一张表好逐个问。Args: counts。 */
  function metricsOf(counts: {
    tp: number
    fp: number
    tn: number
    fn: number
  }): Map<string, number | null> {
    const one = { ...GRID, items: [{ name: '1.000', threshold: 1, ...counts }] }
    const stand = standAt(buildThresholdGrid(one, 1), 0)
    return new Map(stand.cards.map((card) => [card.key, card.value]))
  }

  it('一行都没判成正类时精确率无定义，而 F1 照样是 0——真正类还在', () => {
    const cards = metricsOf({ tp: 0, fp: 0, tn: 2, fn: 2 })

    expect(cards.get('precision')).toBeNull()
    expect(cards.get('recall')).toBe(0)
    expect(cards.get('f1')).toBe(0)
    expect(cards.get('accuracy')).toBe(0.5)
  })

  // ⚠ 这一档 F1 才是真的无定义：分子分母都没有正类，写成 0 会被读成「全错了」
  it('连一个真正类都没有时召回率与 F1 双双无定义，不是 0', () => {
    const cards = metricsOf({ tp: 0, fp: 0, tn: 4, fn: 0 })

    expect(cards.get('recall')).toBeNull()
    expect(cards.get('f1')).toBeNull()
    expect(cards.get('accuracy')).toBe(1)
  })

  it('图下那行结论带绝对行数，不只有比率', () => {
    expect(standAt(built(), 2).summary).toBe(
      '阈值 0.800：共 4 行，判对 2 行，判成正类 2 行',
    )
  })
})

describe('离打分时那个阈值有多远', () => {
  it('停在原处时说停在原处', () => {
    expect(standAt(built(), 2).offset).toBe('就停在打分时用的那个阈值 0.8 上')
  })

  it('往右推：门槛高了，判成正类的更少', () => {
    const text = standAt(built(), 3).offset

    expect(text).toContain('高了 0.1')
    expect(text).toContain('判成正类的行更少')
  })

  it('往左推：门槛低了，判成正类的更多', () => {
    const text = standAt(built(), 0).offset

    expect(text).toContain('低了 0.7')
    expect(text).toContain('判成正类的行更多')
  })
})
