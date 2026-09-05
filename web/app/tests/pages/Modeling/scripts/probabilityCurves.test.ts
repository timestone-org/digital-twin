/**
 * @fileoverview 三条曲线的取料：哪个键画到哪根轴上、哪几档画不出来、空心那几个
 * 点从哪来。
 *
 * ⚠ 夹具照抄后端真跑出来的 payload（概率 [0.9, 0.8, 0.4, 0.1]、真实
 * [1, 0, 1, 0] 那四行），不是手编的形状：手编的与真块一漂，用例全绿而界面全错。
 * ⚠ 断言逐点带坐标：只数点数的话，横纵轴对调这种最要命的错法照样绿。
 */
import { describe, expect, it } from 'vitest'

import { buildCurve } from '@/pages/Modeling/Canvas/scripts/probabilityCurves'
import { curveKindOf } from '@/pages/Modeling/Canvas/scripts/reportBlocks'

const ROC = {
  label: '横轴假正率、纵轴真正率；对角线是随机基准',
  unit: '',
  score_kind: '',
  baseline: null,
  items: [
    { name: '全判负类', threshold: null, fpr: 0.0, tpr: 0.0, value: 0.0 },
    { name: '0.900', threshold: 0.9, fpr: 0.0, tpr: 0.5, value: 0.5 },
    { name: '0.800', threshold: 0.8, fpr: 0.5, tpr: 0.5, value: 0.5 },
    { name: '0.400', threshold: 0.4, fpr: 0.5, tpr: 1.0, value: 1.0 },
    { name: '0.100', threshold: 0.1, fpr: 1.0, tpr: 1.0, value: 1.0 },
  ],
  is_primary: true,
}

const PR = {
  label: '横轴召回率、纵轴精确率；基线是正类占比',
  unit: '',
  score_kind: '',
  baseline: 0.5,
  items: [
    { name: '0.900', threshold: 0.9, recall: 0.5, precision: 1.0, value: 1.0 },
    { name: '0.800', threshold: 0.8, recall: 0.5, precision: 0.5, value: 0.5 },
    {
      name: '0.400',
      threshold: 0.4,
      recall: 1.0,
      precision: 0.6666666666666666,
      value: 0.6666666666666666,
    },
    { name: '0.100', threshold: 0.1, recall: 1.0, precision: 0.5, value: 0.5 },
  ],
  is_primary: true,
}

const CALIBRATION = {
  label: '横轴平均预测概率、纵轴实际正类率',
  unit: '',
  score_kind: '',
  baseline: null,
  items: [
    {
      name: '0.1–0.2',
      value: 0.0,
      predicted: 0.1,
      actual: 0.0,
      count: 1,
      is_sparse: true,
      low: 0.1,
      high: 0.2,
    },
    {
      name: '0.9–1.0',
      value: 1.0,
      predicted: 0.92,
      actual: 1.0,
      count: 24,
      is_sparse: false,
      low: 0.9,
      high: 1.0,
    },
  ],
  is_primary: false,
}

const GRID = {
  label: '每个阈值上的 TP / FP / TN / FN 与 F1',
  unit: '',
  score_kind: '',
  baseline: 0.8,
  items: [
    { name: '0.900', threshold: 0.9, tp: 1, fp: 0, tn: 2, fn: 1, value: 2 / 3 },
    { name: '0.100', threshold: 0.1, tp: 2, fp: 2, tn: 0, fn: 0, value: 2 / 3 },
  ],
  is_primary: false,
}

// `cross_validate` 的逐折分数：概率侧一个键都不带，认不出才是对的
const FOLDS = {
  label: '每折的分',
  unit: '',
  score_kind: 'r2',
  baseline: 1.0,
  items: [
    { name: '第 1 折', value: 1.0 },
    { name: '第 2 折', value: 0.62 },
  ],
}

describe('概率侧那四块按键认得出来', () => {
  it.each([
    ['roc', ROC],
    ['pr', PR],
    ['calibration', CALIBRATION],
    ['grid', GRID],
  ])('%s 那一块认得出来', (kind, payload) => {
    expect(curveKindOf(payload)).toBe(kind)
  })

  it('别的 breakdown 一律认不出来，照旧走横条', () => {
    expect(curveKindOf(FOLDS)).toBeNull()
  })

  it('一项都没有的块也认不出来，不猜', () => {
    expect(curveKindOf({ ...ROC, items: [] })).toBeNull()
  })

  // ⚠ 两个键都在才算：只认半边的话，将来某个「逐类召回率」的块会被当成 PR
  // 曲线画出去，而它的横轴根本不是召回率
  it('只带半边键的块认不出来', () => {
    const half = { ...PR, items: [{ name: '第 1 类', recall: 0.5 }] }

    expect(curveKindOf(half)).toBeNull()
  })
})

describe('ROC 曲线', () => {
  const view = buildCurve(ROC, 'roc')

  it('五个点逐个落在 (假正率, 真正率) 上，横纵轴没对调', () => {
    expect(view.series[0]?.points).toEqual([
      [0, 0],
      [0, 0.5],
      [0.5, 0.5],
      [0.5, 1],
      [1, 1],
    ])
  })

  it('两条轴名各就各位，对角线是随机基准', () => {
    expect(view.xLabel).toBe('假正率')
    expect(view.yLabel).toBe('真正率')
    expect(view.diagonal).toBe(true)
  })

  it('没有横向基线：ROC 的基准是那条对角线', () => {
    expect(view.rules).toEqual([])
  })
})

describe('PR 曲线', () => {
  const view = buildCurve(PR, 'pr')

  it('四个点落在 (召回率, 精确率) 上', () => {
    expect(view.series[0]?.points).toEqual([
      [0.5, 1],
      [0.5, 0.5],
      [1, 0.6666666666666666],
      [1, 0.5],
    ])
  })

  // ⚠ 一个「全押正类」的模型精确率恰好等于正类占比：这条线才是 PR 的判据
  it('基线是正类占比那条横线，不是对角线', () => {
    expect(view.diagonal).toBe(false)
    expect(view.rules).toEqual([
      { at: 0.5, label: '正类占比', intent: 'reference' },
    ])
  })

  it('精确率无定义的那几档不画，也不补 0，并且照实说一句', () => {
    const blind = {
      ...PR,
      items: [
        ...PR.items,
        { name: '1.000', threshold: 1, recall: 0, precision: null, value: null },
      ],
    }
    const made = buildCurve(blind, 'pr')

    expect(made.series[0]?.points).toHaveLength(4)
    expect(made.note).toContain('有 1 档一行都没判成正类，精确率无定义')
  })

  it('基线读不出来时不画那条线，也不画到 0 上', () => {
    const made = buildCurve({ ...PR, baseline: null }, 'pr')

    expect(made.rules).toEqual([])
  })
})

describe('校准曲线', () => {
  const view = buildCurve(CALIBRATION, 'calibration')

  it('点落在 (平均预测概率, 实际正类率) 上，对角线是完美校准', () => {
    expect(view.series[0]?.points).toEqual([
      [0.1, 0],
      [0.92, 1],
    ])
    expect(view.diagonal).toBe(true)
  })

  // ⚠ 空心是可信度不是另一路数据：不足十行的箱抖得读不出校准
  it('不足十行的那一箱画空心，够厚的不画', () => {
    expect(view.series[0]?.hollow).toEqual([true, false])
    expect(view.note).toContain('2 个箱里有 1 个不足十行')
  })

  it('一箱都不缺时不说空心那句话', () => {
    const thick = {
      ...CALIBRATION,
      items: [{ ...CALIBRATION.items[1], is_sparse: false }],
    }

    expect(buildCurve(thick, 'calibration').note).toBe('')
  })
})

describe('曲线的退化分支', () => {
  it('一项都没有时一个点都不画，也不编一条线', () => {
    const made = buildCurve({ ...ROC, items: [] }, 'roc')

    expect(made.series[0]?.points).toEqual([])
    expect(made.rules).toEqual([])
  })

  it('点少时连点带线画，点多了只画线——几十个标记会糊成一条粗带', () => {
    const many = {
      ...ROC,
      items: Array.from({ length: 40 }, (_, seat) => ({
        name: `${seat}`,
        threshold: seat / 40,
        fpr: seat / 40,
        tpr: seat / 40,
        value: 0,
      })),
    }

    expect(buildCurve(ROC, 'roc').series[0]?.draw).toBe('both')
    expect(buildCurve(many, 'roc').series[0]?.draw).toBe('line')
  })

  it('全同概率时 ROC 只剩两个点，仍从原点起', () => {
    const flat = {
      ...ROC,
      items: [
        { name: '全判负类', threshold: null, fpr: 0.0, tpr: 0.0, value: 0.0 },
        { name: '0.500', threshold: 0.5, fpr: 1.0, tpr: 1.0, value: 1.0 },
      ],
    }

    expect(buildCurve(flat, 'roc').series[0]?.points).toEqual([
      [0, 0],
      [1, 1],
    ])
  })
})
