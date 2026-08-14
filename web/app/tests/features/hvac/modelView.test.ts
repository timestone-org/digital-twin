/**
 * @fileoverview 模型展示口径的单测：格式化的空值语义与行映射的提示优先级。
 */
import { describe, expect, it } from 'vitest'

import {
  formatCoverage,
  formatMinutes,
  formatR2,
  formatSet,
  isCovered,
  isModelBusy,
  r2Class,
  signedError,
  sortModelRows,
  toModelRows,
  toSetRows,
} from '@/features/hvac/modelView'
import { metrics, model, prediction } from '@/testing/modelFixtures'

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

  it('⚠ R² 的 null 是「—」不是 0.00，负数照实显示不夹到 0', () => {
    expect(formatR2(null)).toBe('—')
    expect(formatR2(0)).toBe('0.00')
    expect(formatR2(-0.14)).toBe('-0.14')
    expect(formatR2(0.6449)).toBe('0.64')
  })

  it('R² 的着色：缺席淡化、负数危险、弱相关警示', () => {
    expect(r2Class(null)).toBe('text-text-disabled')
    expect(r2Class(-0.14)).toBe('text-state-danger')
    expect(r2Class(0.2)).toBe('text-state-warning')
    expect(r2Class(0.3)).toBe('text-text-primary')
  })

  it('⚠ 误差是有符号的：预测偏短是负数，方向本身是行动信息', () => {
    expect(signedError(prediction({ actual_minutes: 60, p50: 30 }))).toBe(-30)
    expect(isCovered(prediction({ actual_minutes: 60 }))).toBe(false)
    expect(isCovered(prediction())).toBe(true)
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

  it('⚠ 列表行的 MAE 与覆盖率取热行统计；老评估退回整体值', () => {
    const rows = toModelRows([model()])
    expect(rows[0]?.mae).toBe('4.2 分钟')
    expect(rows[0]?.coverage).toBe('82%')
    const base = metrics()
    const legacy = toModelRows([
      model({
        metrics: {
          ...base,
          overall: {
            ...base.overall,
            hot: null,
            zero_count: null,
            zero_hit_rate: null,
            hot_hit_rate: null,
          },
        },
      }),
    ])
    expect(legacy[0]?.mae).toBe('2.1 分钟')
    expect(legacy[0]?.coverage).toBe('93%')
  })

  it('没训过的模型：样本与指标都是占位符，覆盖率那行整个不渲染', () => {
    const rows = toModelRows([
      model({ metrics: null, sample_count: null, trained_at: null }),
    ])
    expect(rows[0]?.sample).toBe('—')
    expect(rows[0]?.mae).toBe('—')
    expect(rows[0]?.r2).toBe('—')
    expect(rows[0]?.coverage).toBeNull()
    expect(rows[0]?.trained).toBe('未训练')
    expect(rows[0]?.sortValues.training).toBeNull()
  })

  it('样本副行拆热与零；覆盖率低于 0.7 才标警示', () => {
    const rows = toModelRows([model()])
    expect(rows[0]?.sampleSplit).toBe('热 80 · 零 40')
    expect(rows[0]?.isCoverageLow).toBe(false)
    const base = metrics()
    const hot = base.overall.hot
    if (!hot) throw new Error('夹具里应有热行')
    const thin = toModelRows([
      model({
        metrics: {
          ...base,
          overall: { ...base.overall, hot: { ...hot, coverage: 0.5 } },
        },
      }),
    ])
    expect(thin[0]?.isCoverageLow).toBe(true)
  })

  it('组合摘要只显示前两个，多出来的写 +n，标题给全部', () => {
    const rows = toModelRows([
      model({ serving_sets: [['K11'], ['K11', 'K12'], ['K13']] }),
    ])
    expect(rows[0]?.sets).toBe('K11 · K11+K12 +1')
    expect(rows[0]?.setsTitle).toBe('K11\nK11+K12\nK13')
  })

  it('queued 与 training 算忙，终态不算', () => {
    expect(isModelBusy(model({ status: 'queued' }))).toBe(true)
    expect(isModelBusy(model({ status: 'training' }))).toBe(true)
    expect(isModelBusy(model())).toBe(false)
    expect(isModelBusy(model({ status: 'failed', error: 'x' }))).toBe(false)
  })
})

describe('列表排序', () => {
  const rows = toModelRows([
    model({
      id: 'a',
      sample_count: 10,
      created_at: '2026-01-01T00:00:00.000Z',
    }),
    model({
      id: 'b',
      sample_count: null,
      metrics: null,
      created_at: '2026-03-01T00:00:00.000Z',
    }),
    model({
      id: 'c',
      sample_count: 30,
      created_at: '2026-02-01T00:00:00.000Z',
    }),
  ])

  it('默认序是最新建的在最上', () => {
    expect(sortModelRows(rows, null).map((row) => row.id)).toEqual([
      'b',
      'c',
      'a',
    ])
  })

  it('⚠ null 恒排末尾，与升降序无关——否则老评估会顶掉想看的行', () => {
    const asc = sortModelRows(rows, { key: 'sample', desc: false })
    expect(asc.map((row) => row.id)).toEqual(['a', 'c', 'b'])
    const desc = sortModelRows(rows, { key: 'sample', desc: true })
    expect(desc.map((row) => row.id)).toEqual(['c', 'a', 'b'])
  })

  it('按 R² 排同样把算不出的排在最后', () => {
    expect(
      sortModelRows(rows, { key: 'r2', desc: true }).map((row) => row.id),
    ).toEqual(['a', 'c', 'b'])
  })

  it('不认识的排序键退回默认序，不炸也不乱排', () => {
    expect(
      sortModelRows(rows, { key: 'nonsense', desc: true }).map((row) => row.id),
    ).toEqual(['b', 'c', 'a'])
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
    expect(solo?.count).toBe('热 74 / 零 36')
    expect(solo?.reliabilityLabel).toBe('可靠')
  })

  it('⚠ 误差列取热行统计，判零率与判出率各一列', () => {
    const rows = toSetRows(metrics().by_set)
    const solo = rows.find((row) => row.set === 'K11')
    expect(solo?.mae).toBe('4.0 分钟')
    expect(solo?.coverage).toBe('84%')
    expect(solo?.zeroHit).toBe('96%')
    expect(solo?.hotHit).toBe('94%')
    expect(solo?.r2).toBe('0.61')
    const empty = rows.find((row) => row.set === 'K11+K12')
    expect(empty?.r2).toBe('—')
    expect(empty?.hotHit).toBe('—')
  })

  it('老评估没有热行拆分时退回整体值，样本列给总数', () => {
    const block = metrics().by_set['K11']
    if (!block) throw new Error('夹具里应有 K11 分组')
    const legacy = {
      ...block,
      hot: null,
      zero_count: null,
      zero_hit_rate: null,
      hot_hit_rate: null,
    }
    const rows = toSetRows({ K11: legacy })
    const solo = rows.find((row) => row.set === 'K11')
    expect(solo?.count).toBe('110')
    expect(solo?.mae).toBe('2.0 分钟')
    expect(solo?.zeroHit).toBe('—')
  })
})
