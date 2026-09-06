/**
 * @fileoverview 指标口径表：中文名、单位、分档，以及「按列名建的键不查这张表」
 * 那道开关（设计规格 R-34）。
 */
import { describe, expect, it } from 'vitest'

import {
  bandHintOf,
  bandOf,
  labelOf,
  metricSpaceOf,
  unitOf,
} from '@/pages/Modeling/Canvas/scripts/metricBands'

describe('指标的中文名', () => {
  it('残差分析那五个键都有中文名，不再印裸 snake_case', () => {
    const keys = [
      'residual_mean',
      'residual_std',
      'residual_p05',
      'residual_p95',
      'residual_max_abs',
    ]

    expect(keys.map((key) => labelOf(key))).toEqual([
      '偏均值',
      '离散度',
      '5% 分位',
      '95% 分位',
      '最大绝对误差',
    ])
  })

  it('交叉验证那四个键都有中文名', () => {
    const keys = ['folds', 'score_mean', 'score_std', 'score_worst']

    expect(keys.map((key) => labelOf(key))).toEqual([
      '实得折数',
      '平均分',
      '分数波动',
      '最差一折',
    ])
  })

  it('没登记的指标原样显示，不吞成空白', () => {
    expect(labelOf('someday_metric')).toBe('someday_metric')
  })
})

describe('那句口径说明', () => {
  it('无量纲的分数波动说的是「没有公认的好坏线」，不是量纲', () => {
    expect(bandHintOf('score_std')).toBe('这个数没有公认的好坏线')
  })

  it('跟着目标列量纲走的那些数说的才是量纲', () => {
    expect(bandHintOf('rmse')).toContain('量纲')
    expect(bandHintOf('residual_p95')).toContain('量纲')
  })

  it('没登记的指标也不许被说成「取决于量纲」', () => {
    expect(bandHintOf('someday_metric')).toBe('这个数没有公认的好坏线')
  })

  it('有阈值的指标把两道界连单位一起写出来', () => {
    expect(bandHintOf('mape')).toBe('≤ 10% 算好，≤ 20% 算一般')
  })
})

describe('键空间', () => {
  it('全是登记过的指标键就是指标语境', () => {
    expect(metricSpaceOf(['r2', 'rmse', 'mae'])).toBe('metric')
  })

  it('一个键认不出来，整份都按列名语境处理', () => {
    expect(metricSpaceOf(['mape', 'humidity'])).toBe('column')
  })

  it('空字典按指标语境，不当成列名', () => {
    expect(metricSpaceOf([])).toBe('metric')
  })
})

describe('列名语境不查阈值表与单位表', () => {
  // ⚠ 某一列恰好叫 mape 时，无量纲的 ΔR²=0.12 会被印成「0.12%」（规格 R-34）
  it('一列叫 mape 的重要性值不带百分号', () => {
    expect(unitOf('mape', 'column')).toBe('')
    expect(unitOf('mape')).toBe('%')
  })

  it('一列叫 r2 的重要性值不被套上 R² 的阈值', () => {
    expect(bandOf('r2', 0.95, 'column')).toBe('unknown')
    expect(bandOf('r2', 0.95)).toBe('good')
  })

  it('列名原样显示，不被换成指标的中文名', () => {
    expect(labelOf('mape', 'column')).toBe('mape')
    expect(labelOf('mape')).toBe('MAPE')
  })

  it('列名不配那句阈值说明', () => {
    expect(bandHintOf('r2', 'column')).toBe('')
  })
})

describe('分档', () => {
  it('越小越好的指标按它自己的方向判', () => {
    expect(bandOf('mape', 8)).toBe('good')
    expect(bandOf('mape', 15)).toBe('fair')
    expect(bandOf('mape', 30)).toBe('poor')
  })

  it('无定义的值不给颜色', () => {
    expect(bandOf('r2', null)).toBe('unknown')
  })

  it('没有阈值口径的指标一律不给颜色', () => {
    expect(bandOf('mae', 3)).toBe('unknown')
  })
})
