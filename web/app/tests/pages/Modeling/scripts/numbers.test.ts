/**
 * @fileoverview 结果里数字的写法：小量不许印成 0，且卡片与弹窗必须给同一串。
 */
import { describe, expect, it } from 'vitest'

import { headlineOf } from '@/pages/Modeling/Canvas/scripts/nodeHeadline'
import type { MetricsPreview } from '@/pages/Modeling/Canvas/scripts/preview'
import { grouped, niceNumber } from '@/pages/Modeling/Canvas/scripts/numbers'

function metrics(pairs: [string, number | null][]): MetricsPreview {
  return {
    kind: 'metrics',
    task: 'regression',
    metrics: pairs,
    pairs: [],
    isPairsTruncated: false,
    isPairsTrimmed: false,
    residualBins: [],
  }
}

describe('小系数不许印成 0', () => {
  it('比四位小数还小的量走指数记法，量级看得见', () => {
    expect(niceNumber(3e-5)).toBe('3e-5')
    expect(niceNumber(-3e-5)).toBe('-3e-5')
    expect(niceNumber(1e-7)).toBe('1e-7')
    expect(niceNumber(1.23456e-7)).toBe('1.235e-7')
  })

  it('小数保留四位有效数字，不是四位小数', () => {
    expect(niceNumber(0.000123456)).toBe('0.0001235')
    expect(niceNumber(0.0001)).toBe('0.0001')
  })

  it('整数不补零，尾零不留', () => {
    expect(niceNumber(50)).toBe('50')
    expect(niceNumber(0)).toBe('0')
    expect(niceNumber(-7)).toBe('-7')
    expect(niceNumber(0.93)).toBe('0.93')
    expect(niceNumber(1.5)).toBe('1.5')
  })

  // ⚠ 整数部分一位都不许丢：12345.678 截成 12350 是把一个精确的数改错了
  it('大数不被截成有效数字，小数仍收在四位', () => {
    expect(niceNumber(12345.678)).toBe('12345.678')
    expect(niceNumber(1.23456789)).toBe('1.2346')
  })

  it('空值与非有限数写成「—」而不是 0', () => {
    expect(niceNumber(null)).toBe('—')
    expect(niceNumber(undefined)).toBe('—')
    expect(niceNumber(Number.NaN)).toBe('—')
    expect(niceNumber(Number.POSITIVE_INFINITY)).toBe('—')
  })

  it('千分位只插在整数位之间', () => {
    expect(grouped(12000)).toBe('12,000')
    expect(grouped(999)).toBe('999')
  })
})

// ⚠ 这条是防复制品复活的：卡片那行字与结果弹窗必须走同一个格式化函数，谁再自带
// 一份 `toFixed` 都会让同一个数在两处显示成两样。
describe('卡片与弹窗对同一个数给同一串', () => {
  const SAMPLES = [0, 1, -7, 0.93, 1.23456789, 3e-5, -3e-5, 1e-7, 12345.678]

  it.each(SAMPLES)('R² %p 在两处写法一致', (value) => {
    expect(headlineOf(metrics([['r2', value]]))).toBe(`R² ${niceNumber(value)}`)
  })

  // ⚠ 无定义的指标在卡片上是整条不印，不是印成「—」占位
  it('null 的指标不落到卡片上', () => {
    expect(headlineOf(metrics([['r2', null]]))).toBe('')
    expect(niceNumber(null)).toBe('—')
  })
})

describe('卡片认得后端真正产出的指标键', () => {
  it('残差分析给残差均值与波动', () => {
    expect(
      headlineOf(
        metrics([
          ['residual_max_abs', 9],
          ['residual_std', 2],
          ['residual_mean', 0.5],
        ]),
      ),
    ).toBe('残差均值 0.5 · 残差标准差 2')
  })

  it('交叉验证给折均分与最差的那一折', () => {
    expect(
      headlineOf(
        metrics([
          ['folds', 5],
          ['score_worst', 0.71],
          ['score_mean', 0.88],
        ]),
      ),
    ).toBe('折均分 0.88 · 最差折 0.71')
  })

  it('分类在 F1 无定义时接着取精确率', () => {
    expect(
      headlineOf(
        metrics([
          ['accuracy', 0.9],
          ['f1', null],
          ['precision', 0.8],
        ]),
      ),
    ).toBe('准确率 0.9 · 精确率 0.8')
  })
})
