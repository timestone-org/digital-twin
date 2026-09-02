/**
 * @fileoverview 结果摘要的读取：按 `kind` 派发、缺字段不崩、数值与非数值分开。
 */
import { describe, expect, it } from 'vitest'

import { previewOf } from '@/pages/Modeling/Canvas/scripts/preview'

/** 一份真实形状的模型摘要——`fitted` 是拟合参数字典，不是布尔。 */
function model(): Record<string, unknown> {
  return {
    kind: 'model',
    algo: 'linear',
    task: 'regression',
    hyper_params: { alpha: 0.5, use_intercept: true },
    feature_keys: ['a', 'b'],
    target_key: 'y',
    serving_channel: 'json',
    fitted: { coef: { a: 1.5, b: -0.5 }, intercept: 3 },
  }
}

describe('读一份结果摘要', () => {
  it('帧的形状、列统计与前几行都读得出来', () => {
    const preview = previewOf({
      kind: 'frame',
      shape: { rows: 120, cols: 3 },
      columns: [
        {
          key: 'power',
          name: '功率',
          dtype: 'number',
          role: 'feature',
          unit: 'kW',
          null_ratio: 0.25,
          n_unique: 90,
          min: 1,
          max: 9,
          mean: 5,
          p50: 4,
        },
      ],
      index_name: '时刻',
      index_head: ['2026-01-01T00:00:00Z'],
      head: [[3.5]],
      rows_truncated: true,
      cols_truncated: false,
    })

    expect(preview.kind).toBe('frame')
    if (preview.kind !== 'frame') return
    expect(preview.rowCount).toBe(120)
    expect(preview.columns[0]?.unit).toBe('kW')
    expect(preview.isRowsTruncated).toBe(true)
    expect(preview.isColsTruncated).toBe(false)
  })

  it('非数值列的四个数保持 null，不当成 0', () => {
    const preview = previewOf({
      kind: 'frame',
      shape: { rows: 1, cols: 1 },
      columns: [
        {
          key: 'label',
          name: '标签',
          dtype: 'string',
          role: 'feature',
          unit: '',
          null_ratio: 0,
          n_unique: 2,
          min: null,
          max: null,
          mean: null,
          p50: null,
        },
      ],
      head: [],
    })

    if (preview.kind !== 'frame') throw new Error('派发错了')
    expect(preview.columns[0]?.mean).toBeNull()
    expect(preview.columns[0]?.uniqueCount).toBe(2)
  })

  it('模型摘要的超参一律读成字符串，特征列保持顺序', () => {
    const preview = previewOf(model())

    if (preview.kind !== 'model') throw new Error('派发错了')
    expect(preview.featureKeys).toEqual(['a', 'b'])
    expect(preview.hyperParams).toEqual([
      ['alpha', '0.5'],
      ['use_intercept', 'true'],
    ])
  })

  // ⚠ 后端给的 `fitted` 是一份**拟合参数字典**，不是布尔。按布尔读的话每个训好
  // 的模型都会被说成没训出来，而这条只有真跑过一轮才看得见
  it('拟合参数是一份字典，有内容就算训出来了', () => {
    const preview = previewOf(model())

    if (preview.kind !== 'model') throw new Error('派发错了')
    expect(preview.isFitted).toBe(true)
    expect(preview.isFittedTrimmed).toBe(false)
    expect(preview.coefficients).toEqual([
      ['a', 1.5],
      ['b', -0.5],
    ])
    expect(preview.intercept).toBe(3)
    expect(preview.servingChannel).toBe('json')
  })

  it('拟合参数是空字典时才算没训出来', () => {
    const preview = previewOf({ ...model(), fitted: {} })

    if (preview.kind !== 'model') throw new Error('派发错了')
    expect(preview.isFitted).toBe(false)
    expect(preview.isFittedTrimmed).toBe(false)
  })

  // ⚠ 摘要撑爆字节预算时后端会把 `fitted` 整个摘掉，那与「没训出来」不是一回事
  it('整个键都不在时算被截断，不算没训出来', () => {
    const trimmed = model()
    delete trimmed['fitted']

    const preview = previewOf(trimmed)

    if (preview.kind !== 'model') throw new Error('派发错了')
    expect(preview.isFittedTrimmed).toBe(true)
    expect(preview.isFitted).toBe(false)
  })

  it('系数里读不出数的那几项丢掉，不混进 NaN', () => {
    const preview = previewOf({
      ...model(),
      fitted: { coef: { a: 1, bad: '不是数' }, intercept: 0 },
    })

    if (preview.kind !== 'model') throw new Error('派发错了')
    expect(preview.coefficients).toEqual([['a', 1]])
  })

  // ⚠ 无定义的指标要留着：丢掉等于把「算不出来」显示成「没有这个指标」
  it('无定义的指标读成 null 留着，不丢也不显示成 0', () => {
    const preview = previewOf({
      kind: 'metrics',
      task: 'regression',
      metrics: { r2: null, rmse: 2, note: '不是数' },
      pairs: [
        [1, 1.1],
        [2, 'x'],
      ],
      pairs_truncated: true,
    })

    if (preview.kind !== 'metrics') throw new Error('派发错了')
    expect(preview.metrics).toEqual([
      ['r2', null],
      ['rmse', 2],
      ['note', null],
    ])
    expect(preview.pairs).toEqual([[1, 1.1]])
    expect(preview.isPairsTruncated).toBe(true)
  })

  it('残差直方图三元组读成一根根柱子，缺项的那根丢掉', () => {
    const preview = previewOf({
      kind: 'metrics',
      task: 'regression',
      metrics: {},
      residual_bins: [
        [-1, 0, 3],
        [0, 1],
      ],
    })

    if (preview.kind !== 'metrics') throw new Error('派发错了')
    expect(preview.residualBins).toEqual([{ low: -1, high: 0, count: 3 }])
  })

  it('取数溯源读得出台账与时间范围，缺的给 null', () => {
    const preview = previewOf({
      kind: 'frame',
      shape: { rows: 1, cols: 1 },
      columns: [],
      head: [],
      provenance: {
        table_codes: ['energy'],
        since: '2026-01-01T00:00:00Z',
        until: null,
        is_truncated: true,
      },
    })

    if (preview.kind !== 'frame') throw new Error('派发错了')
    expect(preview.provenance).toEqual({
      tableCodes: ['energy'],
      since: '2026-01-01T00:00:00Z',
      until: null,
      isTruncated: true,
    })
  })

  it('整份摘要里没有 provenance 时给一份空的，不崩', () => {
    const preview = previewOf({ kind: 'frame', shape: {}, columns: [] })

    if (preview.kind !== 'frame') throw new Error('派发错了')
    expect(preview.provenance.tableCodes).toEqual([])
    expect(preview.provenance.isTruncated).toBe(false)
  })

  it('认不出的 kind 读成 unknown，并保留后端那句说明', () => {
    const preview = previewOf({ kind: '将来某种', note: '这一步没有摘要' })

    expect(preview.kind).toBe('unknown')
    if (preview.kind !== 'unknown') return
    expect(preview.note).toBe('这一步没有摘要')
  })

  it('结构长得像帧但 kind 不是 frame，就**不**按帧读', () => {
    const preview = previewOf({
      kind: 'metrics',
      shape: { rows: 9, cols: 9 },
      columns: [],
      metrics: {},
      pairs: [],
    })

    expect(preview.kind).toBe('metrics')
  })

  it('整份摘要是空的也不崩', () => {
    const preview = previewOf({})

    expect(preview.kind).toBe('unknown')
  })
})
