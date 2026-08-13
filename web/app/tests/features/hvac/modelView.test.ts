/**
 * @fileoverview 模型展示口径的单测：格式化的空值语义与行映射的提示优先级。
 */
import { describe, expect, it } from 'vitest'

import {
  formatCoverage,
  formatMinutes,
  formatSet,
  isModelBusy,
  toModelRows,
  toSetRows,
} from '@/features/hvac/modelView'
import { metrics, model } from '@/testing/modelFixtures'

describe('格式化', () => {
  it('分钟数：一位小数；null/undefined/NaN 一律占位符', () => {
    expect(formatMinutes(4.25)).toBe('4.3 分钟')
    expect(formatMinutes(null)).toBe('—')
    expect(formatMinutes(undefined)).toBe('—')
    expect(formatMinutes(Number.NaN)).toBe('—')
  })

  it('覆盖率取整成百分比', () => {
    expect(formatCoverage(0.824)).toBe('82%')
  })

  it('组合键按 serial 升序拼接', () => {
    expect(formatSet(['K12', 'K11'])).toBe('K11+K12')
  })
})

describe('行映射', () => {
  it('提示的优先级：失败原因 > 数据已更新 > 特征口径已更新', () => {
    const failed = toModelRows([
      model({
        status: 'failed',
        error: '炸了',
        is_batch_stale: true,
        is_feature_stale: true,
      }),
    ])
    expect(failed[0]?.notice).toBe('炸了')
    const stale = toModelRows([
      model({ is_batch_stale: true, is_feature_stale: true }),
    ])
    expect(stale[0]?.notice).toBe('数据已更新，可重训')
    const feature = toModelRows([model({ is_feature_stale: true })])
    expect(feature[0]?.notice).toBe('特征口径已更新，建议重训')
    expect(toModelRows([model()])[0]?.notice).toBeNull()
  })

  it('没训过的模型：样本与指标都是占位符', () => {
    const rows = toModelRows([
      model({ metrics: null, sample_count: null, trained_at: null }),
    ])
    expect(rows[0]?.sample).toBe('—')
    expect(rows[0]?.mae).toBe('—')
    expect(rows[0]?.coverage).toBe('—')
  })

  it('queued 与 training 算忙，终态不算', () => {
    expect(isModelBusy(model({ status: 'queued' }))).toBe(true)
    expect(isModelBusy(model({ status: 'training' }))).toBe(true)
    expect(isModelBusy(model())).toBe(false)
    expect(isModelBusy(model({ status: 'failed', error: 'x' }))).toBe(false)
  })
})

describe('按组合分组', () => {
  it('⚠ 没样本的组合是「无样本」，不显示成零误差', () => {
    const rows = toSetRows(metrics().by_set)
    const empty = rows.find((row) => row.set === 'K11+K12')
    expect(empty?.hasSamples).toBe(false)
    expect(empty?.reliabilityLabel).toBe('无样本')
    expect(empty?.mae).toBe('—')
    const solo = rows.find((row) => row.set === 'K11')
    expect(solo?.count).toBe('110')
    expect(solo?.reliabilityLabel).toBe('可靠')
  })
})
