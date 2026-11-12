/** @fileoverview 报告指标的取数方式、常用报告期与列表检索。 */
import type { ReportMetric } from '@dt/contracts'

export const AGGREGATIONS = [
  { value: 'window_agg', label: '期内均值' },
  { value: 'sum', label: '期内合计' },
  { value: 'min', label: '期内最小值' },
  { value: 'max', label: '期内最大值' },
  { value: 'count', label: '有效数据条数' },
  { value: 'delta', label: '期末减期初' },
  { value: 'latest', label: '期末最新值' },
  { value: 'at_bucket', label: '指定期最新值' },
  { value: 'first', label: '期内首个值' },
  { value: 'last', label: '期内末个值' },
  { value: 'expr', label: '指标表达式' },
]

export const PERIODS = [
  { value: '0', label: '本期' },
  { value: '-1', label: '上期' },
  { value: '-12', label: '前 12 期（月报同比）' },
]

/** 文本字段可用的取数方式。 */
export const TEXT_MODES: ReadonlySet<string> = new Set([
  'latest',
  'at_bucket',
  'first',
  'last',
  'count',
  'expr',
])

/**
 * 把已存指标折回表单里的取数方式。
 * @param metric 指标定义
 */
export function existingMode(metric: ReportMetric): string {
  if (
    metric.mode === 'expr' ||
    metric.mode === 'latest' ||
    metric.mode === 'at_bucket'
  )
    return metric.mode
  return metric.agg === 'avg' || !metric.agg ? 'window_agg' : metric.agg
}

/** 表单里一条指标的可编辑文本。 */
export interface MetricFields {
  name: string
  key: string
  expression: string
  mode: string
  offset: string
  unit: string
}

/**
 * 指标转成表单初值；null 给空白表单。
 * @param metric 指标定义
 */
export function metricFields(metric: ReportMetric | null): MetricFields {
  if (!metric)
    return {
      name: '',
      key: '',
      expression: '',
      mode: 'window_agg',
      offset: '0',
      unit: '',
    }
  return {
    name: metric.name,
    key: metric.key ?? '',
    expression: metric.expr ?? '',
    mode: existingMode(metric),
    offset: String(metric.offset ?? 0),
    unit: metric.unit ?? '',
  }
}

/**
 * 按名称、字段、来源或说明文字过滤指标，忽略大小写与首尾空白。
 * @param metrics 全部指标
 * @param query 检索词
 * @param describe 一条指标的说明文字
 */
export function filterMetrics(
  metrics: readonly ReportMetric[],
  query: string,
  describe: (metric: ReportMetric) => string,
): ReportMetric[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return [...metrics]
  return metrics.filter((metric) =>
    [metric.name, metric.key ?? '', describe(metric)].some((text) =>
      text.toLowerCase().includes(needle),
    ),
  )
}
