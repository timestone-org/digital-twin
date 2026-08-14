/**
 * @fileoverview 计算（`computed`）来源的 provider：同一个节点内其它槽的运算。
 * ⚠ 诚实的 null：任一输入不是有限数就整体算不出来，绝不做部分聚合——
 * 少了一台机组的平均值看上去完全正常，但它是错的。
 */
import type { ComputeOp, ComputeSpec, DataSourceProvider } from '@dt/contracts'

import { refuseHistory, refuseSubscribe } from '../capability'

const KIND = 'computed'

/** `toFixed` 认的小数位范围，超出这个范围视为没配。 */
const MAX_PRECISION = 20

/** 参与运算的都是有限数，算不出来给 null。 */
type Reducer = (values: readonly number[]) => number | null

const add = (total: number, value: number): number => total + value
const multiply = (total: number, value: number): number => total * value

/**
 * ⚠ 按 `ComputeOp` 逐个登记：漏一个的话那种绑定永远算不出值且不报错，
 * 由契约测试守住每个运算符都在这张表里。
 */
const REDUCERS: Record<ComputeOp, Reducer> = {
  sum: (values) => values.reduce(add, 0),
  avg: (values) => values.reduce(add, 0) / values.length,
  min: (values) => Math.min(...values),
  max: (values) => Math.max(...values),
  product: (values) => values.reduce(multiply, 1),
  diff: (values) =>
    values.reduce(
      (total, value, index) => (index === 0 ? value : total - value),
      0,
    ),
  ratio: (values) => {
    const [numerator, denominator] = values
    if (numerator === undefined || denominator === undefined) return null
    if (values.length !== 2) return null
    // ⚠ 除零给 null 而不是 Infinity：Infinity 会被格式化成一个看起来像数的东西
    return denominator === 0 ? null : numerator / denominator
  },
}

/**
 * 按规格算出派生值；算不出来返回 null。
 * @param spec 运算符、参与的槽键与小数位
 * @param values 同一节点内已求值的槽，键是 `BindingSpec.key`
 */
export function computeValue(
  spec: ComputeSpec,
  values: Readonly<Record<string, unknown>>,
): number | null {
  const numbers = toFiniteNumbers(spec.inputs, values)
  if (numbers === null || numbers.length === 0) return null
  const result = REDUCERS[spec.op](numbers)
  if (result === null || !Number.isFinite(result)) return null
  return round(result, spec.precision)
}

/** 全部输入都是有限数才给数组，任一个不是就整体判不可算。 */
function toFiniteNumbers(
  inputs: readonly string[],
  values: Readonly<Record<string, unknown>>,
): number[] | null {
  const numbers: number[] = []
  for (const key of inputs) {
    const value = values[key]
    // ⚠ 只认真正的 number：精确小数从后端是字符串，Number(v) 之后再算是有损的
    if (typeof value !== 'number' || !Number.isFinite(value)) return null
    numbers.push(value)
  }
  return numbers
}

function round(value: number, precision: number | null | undefined): number {
  if (precision === null || precision === undefined) return value
  if (!Number.isInteger(precision)) return value
  if (precision < 0 || precision > MAX_PRECISION) return value
  return Number(value.toFixed(precision))
}

/** 造一个计算 provider。 */
export function createComputedProvider(): DataSourceProvider {
  return {
    kind: KIND,
    subscribe: (nodeKeys) => refuseSubscribe(KIND, nodeKeys),
    readHistory: () => refuseHistory(KIND),
  }
}
