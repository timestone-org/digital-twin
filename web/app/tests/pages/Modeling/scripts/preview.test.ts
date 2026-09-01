/**
 * @fileoverview 结果摘要的读取：按 `kind` 派发、缺字段不崩、数值与非数值分开。
 */
import { describe, expect, it } from 'vitest'

import { previewOf } from '@/pages/Modeling/Canvas/scripts/preview'

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
    const preview = previewOf({
      kind: 'model',
      algo: 'linear',
      task: 'regression',
      hyper_params: { alpha: 0.5, use_intercept: true },
      feature_keys: ['a', 'b'],
      target_key: 'y',
      serving_channel: 'row',
      fitted: true,
    })

    if (preview.kind !== 'model') throw new Error('派发错了')
    expect(preview.featureKeys).toEqual(['a', 'b'])
    expect(preview.hyperParams).toEqual([
      ['alpha', '0.5'],
      ['use_intercept', 'true'],
    ])
    expect(preview.isFitted).toBe(true)
  })

  it('指标里读不出数的那几项直接丢掉，不混进 NaN', () => {
    const preview = previewOf({
      kind: 'metrics',
      task: 'regression',
      metrics: { r2: 0.91, note: '不是数' },
      pairs: [
        [1, 1.1],
        [2, 'x'],
      ],
      pairs_truncated: true,
    })

    if (preview.kind !== 'metrics') throw new Error('派发错了')
    expect(preview.metrics).toEqual([['r2', 0.91]])
    expect(preview.pairs).toEqual([[1, 1.1]])
    expect(preview.isPairsTruncated).toBe(true)
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
