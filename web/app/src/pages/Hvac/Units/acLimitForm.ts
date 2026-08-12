/**
 * @fileoverview 达标范围表单的取值规则：空 ≠ 0、上下限比大小、组装覆盖式载荷。
 *
 * ⚠ 上下限是精确小数，全程按字符串走。`Number('20.15')` 再算回来是
 * 20.149999999999999，见 docs/agents/code-style-typescript.md §8——所以连
 * 「谁大谁小」都在这里按十进制位比，不借道 Number。
 */
import type { AcDataset, AcMetricLimit } from '@dt/contracts'

/** 表单里的一行：一个可配指标的两个边界。空串表示该侧不限制。 */
export interface LimitRow {
  metric: string
  name: string
  unit: string
  lower: string
  upper: string
}

// 允许负数与小数，不允许指数写法与千分位——它们进不了后端的 numeric
const DECIMAL = /^-?\d+(?:\.\d+)?$/

interface Decimal {
  sign: 1 | -1
  int: string
  frac: string
}

function parseDecimal(text: string): Decimal {
  const digits = text.replace(/^[-+]/, '')
  const [int = '0', frac = ''] = digits.split('.')
  return {
    // 全是 0 时不分正负，否则 '-0' 会被判成小于 '0'
    sign: text.startsWith('-') && /[1-9]/.test(digits) ? -1 : 1,
    int: int.replace(/^0+(?=\d)/, ''),
    frac,
  }
}

/** 等长后按字面比；不等长的先比位数——'100' 比 '99' 大，字典序反过来。 */
function compareDigits(left: string, right: string): number {
  if (left.length !== right.length) return left.length < right.length ? -1 : 1
  if (left === right) return 0
  return left < right ? -1 : 1
}

/**
 * 比两个十进制字面量的大小，返回 -1 / 0 / 1。
 * @param left 左值
 * @param right 右值
 */
export function compareDecimal(left: string, right: string): number {
  const a = parseDecimal(left)
  const b = parseDecimal(right)
  if (a.sign !== b.sign) return a.sign < b.sign ? -1 : 1
  const width = Math.max(a.frac.length, b.frac.length)
  const magnitude =
    compareDigits(a.int, b.int) ||
    compareDigits(a.frac.padEnd(width, '0'), b.frac.padEnd(width, '0'))
  return a.sign * magnitude
}

/**
 * 目录里全部可配达标范围的指标，铺上这台空调已有的取值。
 *
 * ⚠ 跨**全部**数据集收集，不是只收当前选中那个：达标范围按指标存、与数据集
 * 无关，而 PUT 是覆盖式的——只提交当前数据集的那几项会把别的数据集配过的
 * 范围一起清掉。
 * @param datasets 数据集目录
 * @param existing 这台空调已有的达标范围
 */
export function buildLimitRows(
  datasets: readonly AcDataset[],
  existing: readonly AcMetricLimit[],
): LimitRow[] {
  const saved = new Map(existing.map((item) => [item.metric, item]))
  const rows = new Map<string, LimitRow>()
  for (const dataset of datasets) {
    for (const metric of dataset.metrics) {
      if (!metric.is_limitable || rows.has(metric.key)) continue
      const found = saved.get(metric.key)
      rows.set(metric.key, {
        metric: metric.key,
        name: metric.name,
        unit: metric.unit,
        lower: found?.lower_limit ?? '',
        upper: found?.upper_limit ?? '',
      })
    }
  }
  return [...rows.values()]
}

/** 空串归一成 null——留空是「这一侧不限制」，不是 0。 */
function boundOf(text: string): string | null {
  const trimmed = text.trim()
  return trimmed === '' ? null : trimmed
}

/**
 * 逐行校验，返回第一条说得清的错；全通过给 null。
 * @param rows 表单当前的全部行
 */
export function validateRows(rows: readonly LimitRow[]): string | null {
  for (const row of rows) {
    const lower = boundOf(row.lower)
    const upper = boundOf(row.upper)
    for (const [text, side] of [
      [lower, '下限'],
      [upper, '上限'],
    ] as const) {
      if (text !== null && !DECIMAL.test(text)) {
        return `${row.name}的${side}不是一个数`
      }
    }
    if (lower !== null && upper !== null && compareDecimal(lower, upper) > 0) {
      return `${row.name}的下限不能大于上限`
    }
  }
  return null
}

/**
 * 组装覆盖式载荷。
 * ⚠ **每个可配指标都要出现**，被清空的那些送 null：PUT 是整包覆盖，漏掉一项
 * 等于把它删了，而送 null 才是明确表达「这项不限制」。
 * @param rows 表单当前的全部行
 */
export function toLimitPayload(rows: readonly LimitRow[]): AcMetricLimit[] {
  return rows.map((row) => ({
    metric: row.metric,
    lower_limit: boundOf(row.lower),
    upper_limit: boundOf(row.upper),
  }))
}
