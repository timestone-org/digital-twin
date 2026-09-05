/**
 * @fileoverview 另外二十个算子的公式：实参从讲解块与 config 代进去，代不进就说清。
 *
 * ⚠ 夹具照抄后端真跑出来的 payload（`tests/contract/
 * test_modeling_report_coverage.py` 那份最小输入），不是手编的形状：这几条式子
 * 的整个价值就是「能拿去核对」，与真块漂一位数就全白搭。
 */
import { describe, expect, it } from 'vitest'

import { formulaText } from '@/pages/Modeling/Canvas/scripts/formula'
import type { FormulaContext } from '@/pages/Modeling/Canvas/scripts/formulaCatalog'
import { formulasOf } from '@/pages/Modeling/Canvas/scripts/formulaCatalog'
import type { ReportBlock } from '@/pages/Modeling/Canvas/scripts/reportBlocks'
import { reportOf } from '@/pages/Modeling/Canvas/scripts/reportBlocks'

function blocksOf(raw: Record<string, unknown>[]): ReportBlock[] {
  return reportOf({ blocks: raw }).blocks
}

function contextOf(
  raw: Record<string, unknown>[],
  config: Record<string, unknown> = {},
): FormulaContext {
  return { blocks: blocksOf(raw), ports: [], config }
}

/** 一个算子的某一条公式。找不到就当场炸，不静默给一条别的。 */
function pick(code: string, id: string, context: FormulaContext) {
  const found = formulasOf(code, context).find((spec) => spec.id === id)
  expect(found, `${code} 少了 ${id} 这一条`).toBeDefined()
  return found ?? formulasOf(code, context)[0]!
}

function filledOf(code: string, id: string, context: FormulaContext): string {
  return formulaText(pick(code, id, context).filled ?? [])
}

const EMPTY: FormulaContext = { blocks: [], ports: [], config: {} }

// `standardize` 真实产出
const SCALE_FITS = {
  kind: 'fits',
  zone: 'table',
  port: 'frame',
  title: '逐列尺度',
  tier: 1,
  payload: {
    method: 'zscore',
    train_rows: 48,
    total_rows: 48,
    by_column: [
      {
        key: '温度',
        params: { center: 23.9375, scale: 2.5465356368996686, fit_rows: 48 },
        skipped_reason: '',
      },
    ],
  },
}

// `clip_outlier` 真实产出
const CLIP_FITS = {
  kind: 'fits',
  zone: 'table',
  port: 'frame',
  title: '逐列定界',
  tier: 1,
  payload: {
    method: 'zscore',
    train_rows: 48,
    total_rows: 48,
    by_column: [
      {
        key: '温度',
        params: {
          k: 3.0,
          mean: 23.9375,
          sd: 2.5465356368996686,
          q1: null,
          q3: null,
          low: 16.297893089300995,
          high: 31.577106910699005,
        },
        skipped_reason: '',
      },
    ],
  },
}

// `fill_missing` 真实产出
const FILL_FITS = {
  kind: 'fits',
  zone: 'table',
  port: 'frame',
  title: '逐列填充',
  tier: 1,
  payload: {
    method: 'mean',
    train_rows: 48,
    total_rows: 48,
    by_column: [
      {
        key: '温度',
        params: { fill: 23.9375, filled: 0, null_ratio_before: 0.0 },
        skipped_reason: '',
      },
    ],
  },
}

// `pca` 真实产出
const PCA_FITS = {
  kind: 'fits',
  zone: 'formula',
  port: 'frame',
  title: '主成分的线性组合',
  tier: 1,
  payload: {
    method: 'pca',
    train_rows: 48,
    total_rows: 48,
    by_column: [
      {
        key: 'pc1',
        params: {
          explained: 0.998972,
          cumulative: 0.998972,
          terms: [
            { key: '能耗', weight: 0.949023, center: 1385.0625 },
            { key: '负荷', weight: -0.315203, center: 444.0625 },
          ],
          terms_total: 3,
        },
        skipped_reason: '',
      },
    ],
  },
}

// `resample` 真实产出
const RESAMPLE_AXIS = {
  kind: 'axis',
  zone: 'charts',
  port: 'frame',
  title: '桶占用与断档',
  tier: 2,
  payload: {
    bucket_ms: 3600000,
    tz_offset_minutes: 480,
    actual_since: '1970-01-01T00:00:00+00:00',
    actual_until: '1970-01-02T23:00:00+00:00',
    occupancy: [1.0, 0.0],
    gaps: [],
    segments: [],
  },
}

// `ledger_source` 真实产出
const SOURCE_ROWS = {
  kind: 'rows',
  zone: 'step',
  port: 'frame',
  title: '取数漏斗',
  tier: 0,
  payload: {
    before: 48,
    after: 48,
    funnel: [
      { name: '窗口命中', value: 48, unit: '行', note: '' },
      { name: '行数上限', value: 50000, unit: '行', note: '' },
    ],
    by_column: [],
  },
}

// `one_hot` 真实产出
const ONE_HOT_HITS = {
  kind: 'breakdown',
  zone: 'charts',
  port: 'frame',
  title: '类目命中',
  tier: 1,
  payload: {
    label: '命中行数',
    unit: '行',
    items: [
      { name: '班次=乙', value: 24, ratio: 0.5, kept: true, position: 0 },
      { name: '班次=甲', value: 24, ratio: 0.5, kept: true, position: 1 },
    ],
    is_primary: true,
  },
}

// `select_feature` 真实产出
const SELECT_RANK = {
  kind: 'breakdown',
  zone: 'charts',
  port: 'frame',
  title: '打分排行',
  tier: 1,
  payload: {
    label: '方差',
    unit: '',
    baseline: 6.48484375,
    items: [
      { name: '能耗', value: 7917.263593750002, kept: true, rank: 1 },
      { name: '负荷', value: 875.68359375, kept: true, rank: 2 },
      { name: '温度', value: 6.48484375, kept: false, rank: 3 },
    ],
    is_primary: true,
  },
}

// `regression_metrics` 真实产出：MAPE 在真值有 0 的那种数据上是 null
const REGRESSION_METRICS = {
  kind: 'breakdown',
  zone: 'stats',
  port: 'metrics',
  title: '回归指标',
  tier: 0,
  payload: {
    label: '测试集上的五个指标',
    items: [
      { name: 'R²', key: 'r2', value: 0.99812382739212, score_kind: 'r2' },
      { name: 'RMSE', key: 'rmse', value: 0.5, score_kind: '' },
      { name: 'MAE', key: 'mae', value: 0.5, score_kind: '' },
      { name: 'MAPE', key: 'mape', value: 5.34817879867047, score_kind: 'mape' },
    ],
  },
}

// `classification_metrics` 真实产出
const CLASSIFY_METRICS = {
  kind: 'breakdown',
  zone: 'stats',
  port: 'metrics',
  title: '分类指标',
  tier: 0,
  payload: {
    label: '精确率 / 召回率 / F1 都是相对正类「1」算的',
    items: [
      { name: '准确率', key: 'accuracy', value: 0.675 },
      { name: '精确率', key: 'precision', value: 0.6842105263157895 },
      { name: '召回率', key: 'recall', value: 0.65 },
      { name: 'F1', key: 'f1', value: 0.6666666666666667 },
    ],
  },
}

// `residual_analysis` 真实产出
const RESIDUAL_STATS = {
  kind: 'breakdown',
  zone: 'stats',
  port: 'metrics',
  title: '残差统计量',
  tier: 0,
  payload: {
    label: '残差 = 真实值 − 预测值',
    items: [
      { name: '偏均值', key: 'residual_mean', value: 0.5 },
      { name: '离散度', key: 'residual_std', value: 0.25 },
    ],
  },
}

// `feature_importance` 真实产出
const IMPORTANCE_BASE = {
  kind: 'breakdown',
  zone: 'stats',
  port: 'metrics',
  title: '打乱前的基线分',
  tier: 0,
  payload: {
    label: '同一个 0.12 在 R²=0.9 的模型上是砍掉 13% 的解释力',
    score_kind: 'r2',
    baseline: 0.9,
    items: [{ name: 'R²', value: 0.9, score_kind: 'r2' }],
  },
}

// `cross_validate` 真实产出：配置 4 折、前向链只实得 3 折
const FOLD_ROWS = {
  kind: 'rows',
  zone: 'step',
  port: 'metrics',
  title: '折的配置与实得',
  tier: 0,
  payload: {
    before: 48,
    after: 48,
    funnel: [
      { name: '总行数', value: 48, unit: '行', note: '' },
      { name: '配置折数', value: 4, unit: '折', note: '' },
      { name: '实得折数', value: 3, unit: '折', note: '' },
    ],
    by_column: [],
  },
}

describe('取数与对齐', () => {
  it('取数上限从 config 代进去，实取行数从漏斗那一块来', () => {
    const context = contextOf([SOURCE_ROWS], {
      row_limit: 50000,
      table_code: 'energy_log',
    })

    expect(filledOf('ledger_source', 'window', context)).toContain('50000')
    expect(filledOf('ledger_source', 'window', context)).toContain('energy_log')
    expect(filledOf('ledger_source', 'window', context)).toContain('48')
  })

  // ⚠ 触顶时丢的是更早那一批：方向指反了，用户会往错的一头缩时间范围
  it('取数那一条点破丢的是更早那一批', () => {
    const spec = pick('ledger_source', 'window', EMPTY)

    expect(spec.notes.join('')).toContain('更早')
    expect(spec.fallback).toContain('没有记下这个参数')
  })

  it('容差同时印毫秒与秒，用户配的是毫秒、读的是秒', () => {
    const context = contextOf([], { tolerance_ms: 60000, how: 'left' })

    expect(filledOf('ledger_join', 'match', context)).toContain('60000')
    expect(filledOf('ledger_join', 'match', context)).toContain('60 秒')
  })

  it('left 档说清配不上的右侧是空不是 0', () => {
    const spec = pick('ledger_join', 'match', contextOf([], { how: 'left' }))

    expect(spec.notes.join('')).toContain('整排是空')
  })
})

describe('预处理那六个', () => {
  it('转坏的那一支按 on_error 说清是变空还是报错', () => {
    const coerce = pick('cast_type', 'cast', contextOf([], { on_error: 'coerce' }))
    const error = pick('cast_type', 'cast', contextOf([], { on_error: 'error' }))

    expect(coerce.notes.join('')).toContain('变成空值')
    expect(error.notes.join('')).toContain('整步报错')
  })

  it('丢列档把阈值代成 0.5 与 50%', () => {
    const context = contextOf([], { axis: 'column', max_null_ratio: 0.5 })

    expect(filledOf('drop_missing', 'drop', context)).toContain('0.5')
    expect(filledOf('drop_missing', 'drop', context)).toContain('50%')
  })

  // ⚠ 丢行档没有可代的实参：拿丢列档那个阈值顶上去，读的人会以为行也按它丢
  it('丢行档不摆阈值，两档的式子不是同一条', () => {
    const rows = pick('drop_missing', 'drop', contextOf([], { axis: 'row' }))

    expect(rows.filled).toBeNull()
    expect(rows.title).toContain('哪几行')
  })

  it('过滤条件把列名、比较号与值三样都代进去', () => {
    const context = contextOf([], { column: '温度', op: 'gte', value: 24 })

    expect(filledOf('filter_rows', 'keep', context)).toContain('温度 >= 24')
  })

  // ⚠ 比较档把空值当 0 去比是这一步最容易记反的一条
  it('比较档点破空值一律丢弃，不当 0 参与比较', () => {
    const spec = pick('filter_rows', 'keep', contextOf([], { op: 'gte' }))

    expect(spec.notes.join('')).toContain('不拿它当 0 去比')
  })

  it('is_blank 档不摆比较式，也不说空值被丢', () => {
    const spec = pick('filter_rows', 'keep', contextOf([], { op: 'is_blank' }))

    expect(spec.filled).toBeNull()
    expect(spec.notes.join('')).not.toContain('不拿它当 0 去比')
  })

  // ⚠ 时区偏移界面拿不到，只能从 axis 块里取：按 UTC 切一天在东八区会整体偏
  // 8 小时，而每个数看着都完全正常
  it('桶宽与时区偏移都从时间轴那一块代进去', () => {
    const context = contextOf([RESAMPLE_AXIS], { agg: 'avg' })

    expect(filledOf('resample', 'bucket', context)).toContain('3600000')
    expect(filledOf('resample', 'bucket', context)).toContain('UTC+8')
  })

  it('没有时间轴块时说清是块里没有，不是参数没配', () => {
    const spec = pick('resample', 'bucket', EMPTY)

    expect(spec.fallback).toContain('讲解里没有这一块')
  })

  it('填充值按列代进去，且点破它只在训练行上学', () => {
    const context = contextOf([FILL_FITS], { strategy: 'mean' })

    expect(filledOf('fill_missing', 'fill', context)).toContain('温度')
    expect(filledOf('fill_missing', 'fill', context)).toContain('23.9375')
    expect(pick('fill_missing', 'fill', context).notes.join('')).toContain(
      '训练行',
    )
  })

  // ⚠ 这是全模块第一处能把公式代上真参数的地方：μ、σ、k 与算出来的两端都要在
  it('定界那一条把 μ、σ、k 与 [lo, hi] 四样都代进去', () => {
    const context = contextOf([CLIP_FITS], { method: 'zscore', threshold: 3 })
    const text = filledOf('clip_outlier', 'bound', context)

    expect(text).toContain('23.9375')
    expect(text).toContain('2.5465')
    expect(text).toContain('k = 3')
    expect(text).toContain('[16.2979, 31.5771]')
  })

  it('定界那一条默认张开：它就是这一步的结论', () => {
    const context = contextOf([CLIP_FITS], { method: 'zscore' })

    expect(pick('clip_outlier', 'bound', context).isOpen).toBe(true)
  })

  it('iqr 档换成四分位那一套，不是 μ 与 σ', () => {
    const spec = pick('clip_outlier', 'bound', contextOf([], { method: 'iqr' }))

    expect(formulaText(spec.symbolic)).toContain('IQR')
    expect(formulaText(spec.symbolic)).not.toContain('sigma')
  })
})

describe('造特征那七个', () => {
  it('标准化把中心与跨度代成一条分式', () => {
    const context = contextOf([SCALE_FITS], { method: 'zscore' })
    const text = filledOf('standardize', 'scale', context)

    expect(text).toContain('温度 - 23.9375')
    expect(text).toContain('2.5465')
  })

  // ⚠ 除数是 0 的式子印出来比不印更糟
  it('跨度为 0 的那一列不画那条分式', () => {
    const flat = {
      ...SCALE_FITS,
      payload: {
        ...SCALE_FITS.payload,
        by_column: [{ key: '常数列', params: { center: 5, scale: 0 } }],
      },
    }

    expect(pick('standardize', 'scale', contextOf([flat])).filled).toBeNull()
  })

  it('标准化必带那条「均值不会正好是 0」的口径', () => {
    const spec = pick('standardize', 'scale', contextOf([SCALE_FITS]))

    expect(spec.notes.join('')).toContain('均值不会正好是 0')
  })

  it('独热把真造出来的那几个列名摆出来', () => {
    const context = contextOf([ONE_HOT_HITS], { max_categories: 20 })

    expect(filledOf('one_hot', 'encode', context)).toContain('班次=乙')
    expect(pick('one_hot', 'encode', context).notes.join('')).toContain(
      '全零',
    )
  })

  // ⚠ 分数断层在哪比排名本身更能指导调参
  it('筛选把第 k 名与下一名的分并排代出来', () => {
    const context = contextOf([SELECT_RANK], { method: 'variance', top_k: 2 })
    const text = filledOf('select_feature', 'score', context)

    expect(text).toContain('第 2 名 = 875.6836')
    expect(text).toContain('下一名 = 6.4848')
  })

  it('方差档点破排名读的其实是「谁的单位大」', () => {
    const context = contextOf([SELECT_RANK], { method: 'variance' })

    expect(pick('select_feature', 'score', context).notes.join('')).toContain(
      '单位大',
    )
  })

  it('相关档换成另一条式子，也不说量纲那句话', () => {
    const context = contextOf([SELECT_RANK], { method: 'correlation' })

    expect(pick('select_feature', 'score', context).notes.join('')).toContain(
      '两边都非空',
    )
  })

  // ⚠ 负权重拆成减号：连着写会印成「+ −0.32」
  it('主成分把权重与中心点代进去，负权重走减号', () => {
    const text = filledOf('pca', 'component', contextOf([PCA_FITS]))

    expect(text).toContain('0.949*(能耗 - 1385.0625)')
    expect(text).toContain('- 0.3152*(负荷 - 444.0625)')
    expect(text).not.toContain('+ -')
  })

  it('载荷项被截断时挂一句还剩几项，不是悄悄少一项', () => {
    expect(filledOf('pca', 'component', contextOf([PCA_FITS]))).toContain(
      '还有 1 项',
    )
  })

  it('时间特征把时区偏移代成 UTC+8，并说破口径差一个时区的后果', () => {
    const axis = {
      kind: 'axis',
      zone: 'step',
      port: 'frame',
      title: '时区口径',
      tier: 0,
      payload: { tz_offset_minutes: 480, gaps: [], segments: [] },
    }
    const context = contextOf([axis], { parts: ['hour'] })

    expect(filledOf('time_feature', 'parts', context)).toContain('UTC+8')
    expect(pick('time_feature', 'parts', context).notes.join('')).toContain(
      '差一个时区',
    )
  })

  it('滞后档去重排序，并说清配了几档实际只造得出几列', () => {
    const context = contextOf([], { lags: [1, 1, 3] })
    const text = filledOf('lag_feature', 'shift', context)

    expect(text).toContain('{1, 3}')
    expect(text).toContain('配了 3 档')
  })

  // ⚠ 这三条各说一件会让人读错的事：行序不是时刻、空不是 0、这一步上不了线
  it('滞后档三条告警一条不少', () => {
    const spec = pick('lag_feature', 'shift', contextOf([], { lags: [1] }))

    expect(spec.notes.join('')).toContain('行序')
    expect(spec.notes.join('')).toContain('历史上是 0')
    expect(spec.notes.join('')).toContain('上不了线')
  })

  it('滚动档把窗口代成「当前行 + 前几行」', () => {
    const context = contextOf([], { window: 3, stats: ['mean'] })

    expect(filledOf('rolling_feature', 'window', context)).toContain(
      '当前行 + 前 2 行',
    )
  })

  // ⚠ 分母逐行不同：缺失多的那一段上「近 3 期均值」可能只是一个点的值
  it('滚动档点破分母是逐行不同的 m_i', () => {
    const context = contextOf([], { window: 3 })

    expect(pick('rolling_feature', 'window', context).notes.join('')).toContain(
      '逐行不同',
    )
  })
})

describe('评估那五个', () => {
  it('R² 有数时代进去，且不默认张开', () => {
    const context = contextOf([REGRESSION_METRICS])

    expect(filledOf('regression_metrics', 'r2', context)).toContain('0.9981')
    expect(pick('regression_metrics', 'r2', context).isOpen).toBe(false)
  })

  // ⚠ 算不出来的时候才是最需要读这条公式的时候：它回答「为什么是无定义」
  it('R² 算不出来时那一条自动张开并说清分母为什么是 0', () => {
    const spec = pick('regression_metrics', 'r2', EMPTY)

    expect(spec.isOpen).toBe(true)
    expect(spec.fallback).toContain('分母就是 0')
  })

  it('MAPE 缺席时那一条张开，并说清哪些行进不了分母', () => {
    const noMape = {
      ...REGRESSION_METRICS,
      payload: {
        ...REGRESSION_METRICS.payload,
        items: REGRESSION_METRICS.payload.items.filter(
          (one) => one.key !== 'mape',
        ),
      },
    }
    const spec = pick('regression_metrics', 'errors', contextOf([noMape]))

    expect(spec.isOpen).toBe(true)
    expect(spec.fallback).toContain('真值等于 0')
    expect(formulaText(spec.filled ?? [])).toContain('RMSE = 0.5')
  })

  it('三个误差指标都在，且点破它们带着量纲', () => {
    const spec = pick('regression_metrics', 'errors', contextOf([REGRESSION_METRICS]))

    expect(formulaText(spec.filled ?? [])).toContain('MAPE = 5.348')
    expect(spec.notes.join('')).toContain('没有公认的好坏线')
  })

  it('精确率与召回率有数时代进去', () => {
    const context = contextOf([CLASSIFY_METRICS], { positive_label: 1 })
    const text = filledOf('classification_metrics', 'confusion', context)

    expect(text).toContain('0.6842')
    expect(text).toContain('0.65')
    expect(pick('classification_metrics', 'confusion', context).isOpen).toBe(
      false,
    )
  })

  // ⚠ 两种分母为 0 要分得开：一次都没判成正类 vs 正类一次都没出现过
  it('精确率算不出来时张开，并把两种分母为 0 分开讲', () => {
    const spec = pick('classification_metrics', 'confusion', EMPTY)

    expect(spec.isOpen).toBe(true)
    expect(spec.fallback).toContain('一次都没判成正类')
    expect(spec.fallback).toContain('一次都没出现')
  })

  it('残差统计把偏均值与离散度代进去，并点破总体口径', () => {
    const context = contextOf([RESIDUAL_STATS])

    expect(filledOf('residual_analysis', 'spread', context)).toContain('0.25')
    expect(pick('residual_analysis', 'spread', context).notes.join('')).toContain(
      'n−1',
    )
  })

  it('置换重要性把基线分与重复次数代进去', () => {
    const context = contextOf([IMPORTANCE_BASE], { repeats: 5 })
    const text = filledOf('feature_importance', 'permutation', context)

    expect(text).toContain('0.9')
    expect(text).toContain('R = 5')
  })

  // ⚠ 离开基线读不出轻重：同一个 0.12 在 R²=0.9 与 R²=0.2 上差了五倍
  it('置换重要性必带那条「离开基线读不出轻重」', () => {
    const spec = pick('feature_importance', 'permutation', EMPTY)

    expect(spec.notes.join('')).toContain('离开基线')
    expect(spec.notes.join('')).toContain('噪声')
  })

  it('前向链把配置折数与实得折数并排代出来', () => {
    const context = contextOf([FOLD_ROWS], { folds: 4, method: 'forward_chain' })
    const text = filledOf('cross_validate', 'folds', context)

    expect(text).toContain('K = 4')
    expect(text).toContain('= 3')
    expect(text).toContain('整折丢弃')
  })

  // ⚠ K 折在时序数据上会拿未来训过去，那句告警只在这一档出现
  it('K 折那一档换成另一句告警', () => {
    const context = contextOf([FOLD_ROWS], { folds: 4, method: 'kfold' })

    expect(pick('cross_validate', 'folds', context).notes.join('')).toContain(
      '未来的行去训过去',
    )
    expect(pick('cross_validate', 'folds', context).notes.join('')).not.toContain(
      '实得折数比配置少',
    )
  })

  it('漏斗里没有实得折数那一级时代不进，也不编一个出来', () => {
    const bare = { ...FOLD_ROWS, payload: { funnel: [], by_column: [] } }
    const spec = pick('cross_validate', 'folds', contextOf([bare], { folds: 4 }))

    expect(spec.filled).toBeNull()
    expect(spec.fallback).toContain('没有这一块')
  })
})

describe('退化分支：读不出来就不编', () => {
  it('minmax 档换成另一条分式，符号里没有 σ', () => {
    const minmax = {
      ...SCALE_FITS,
      payload: {
        ...SCALE_FITS.payload,
        method: 'minmax',
        by_column: [{ key: '温度', params: { center: 20, scale: 8.4 } }],
      },
    }
    const spec = pick(
      'standardize',
      'scale',
      contextOf([minmax], { method: 'minmax' }),
    )

    expect(formulaText(spec.symbolic)).toContain('max_j - min_j')
    expect(formulaText(spec.filled ?? [])).toContain('(温度 - 20) / (8.4)')
  })

  it('iqr 档代的是 Q1 与 Q3，不是 μ 与 σ', () => {
    const iqr = {
      ...CLIP_FITS,
      payload: {
        ...CLIP_FITS.payload,
        method: 'iqr',
        by_column: [
          {
            key: '温度',
            params: { k: 1.5, mean: null, sd: null, q1: 21.5, q3: 26.2, low: 14.45, high: 33.25 },
          },
        ],
      },
    }
    const text = filledOf('clip_outlier', 'bound', contextOf([iqr], { method: 'iqr' }))

    expect(text).toContain('21.5')
    expect(text).toContain('26.2')
    expect(text).toContain('[14.45, 33.25]')
  })

  // ⚠ 两端算不出来时整条不画：印一半的界比不印更容易被当成真界
  it('定界参数缺一样就整条不代，不印半条界', () => {
    const half = {
      ...CLIP_FITS,
      payload: {
        ...CLIP_FITS.payload,
        by_column: [{ key: '温度', params: { k: 3, mean: 23.9, sd: 2.5 } }],
      },
    }

    expect(pick('clip_outlier', 'bound', contextOf([half])).filled).toBeNull()
  })

  it('一列都没有的 fits 块当成没有这一块', () => {
    const bare = { ...FILL_FITS, payload: { method: 'mean', by_column: [] } }
    const spec = pick('fill_missing', 'fill', contextOf([bare]))

    expect(spec.filled).toBeNull()
    expect(spec.fallback).toContain('没有这一块')
  })

  it('类目一个都没数出来时不摆列名', () => {
    const bare = { ...ONE_HOT_HITS, payload: { label: '命中行数', items: [] } }

    expect(pick('one_hot', 'encode', contextOf([bare])).filled).toBeNull()
  })

  it('排行里一列都没留下时代不进那条切割线', () => {
    const none = {
      ...SELECT_RANK,
      payload: {
        ...SELECT_RANK.payload,
        items: [{ name: '温度', value: 1, kept: false }],
      },
    }

    expect(pick('select_feature', 'score', contextOf([none])).filled).toBeNull()
  })

  it('全都留下来时那条线明说后面没有别的列了', () => {
    const all = {
      ...SELECT_RANK,
      payload: {
        ...SELECT_RANK.payload,
        items: [{ name: '温度', value: 1, kept: true }],
      },
    }

    expect(filledOf('select_feature', 'score', contextOf([all]))).toContain(
      '后面没有别的列了',
    )
  })

  it('主成分那一项缺权重时整项跳过，不补 0', () => {
    const broken = {
      ...PCA_FITS,
      payload: {
        ...PCA_FITS.payload,
        by_column: [
          {
            key: 'pc1',
            params: { terms: [{ key: '能耗' }], terms_total: 1 },
          },
        ],
      },
    }

    expect(pick('pca', 'component', contextOf([broken])).filled).toBeNull()
  })

  it('主成分的 terms 不是数组时当代不进', () => {
    const broken = {
      ...PCA_FITS,
      payload: {
        ...PCA_FITS.payload,
        by_column: [{ key: 'pc1', params: { terms: '两项' } }],
      },
    }

    expect(pick('pca', 'component', contextOf([broken])).filled).toBeNull()
  })

  it('时间特征没配 parts 时不编一串档位出来', () => {
    const axis = {
      kind: 'axis',
      zone: 'step',
      port: 'frame',
      title: '时区口径',
      tier: 0,
      payload: { tz_offset_minutes: -300 },
    }
    const spec = pick('time_feature', 'parts', contextOf([axis]))

    expect(spec.notes.join('')).toContain('按配置那几档')
    expect(formulaText(spec.filled ?? [])).toContain('UTC-5')
  })

  it('没配滞后档时代不进，说的是参数没记下', () => {
    const spec = pick('lag_feature', 'shift', EMPTY)

    expect(spec.fallback).toContain('没有记下这个参数')
  })

  it('滞后档没有重复时不多说一句「配了几档」', () => {
    expect(filledOf('lag_feature', 'shift', contextOf([], { lags: [1, 3] }))).not.toContain(
      '配了',
    )
  })

  it('没配窗口时那句「前几行」写成符号，不写成 NaN', () => {
    const spec = pick('rolling_feature', 'window', EMPTY)

    expect(spec.notes.join('')).toContain('前 W − 1 行')
    expect(spec.notes.join('')).not.toContain('NaN')
  })

  it('分类那条在没配正类时也画得出符号态', () => {
    const spec = pick('classification_metrics', 'confusion', contextOf([CLASSIFY_METRICS]))

    expect(spec.legend.some((one) => one.symbol === 'TP')).toBe(true)
  })

  it('残差统计缺一个数就整条不代', () => {
    const half = {
      ...RESIDUAL_STATS,
      payload: {
        ...RESIDUAL_STATS.payload,
        items: [{ name: '偏均值', key: 'residual_mean', value: 0.5 }],
      },
    }

    expect(pick('residual_analysis', 'spread', contextOf([half])).filled).toBeNull()
  })

  it('置换重要性没配重复次数时只代基线分', () => {
    const text = filledOf('feature_importance', 'permutation', contextOf([IMPORTANCE_BASE]))

    expect(text).toContain('0.9')
    expect(text).not.toContain('R =')
  })
})
