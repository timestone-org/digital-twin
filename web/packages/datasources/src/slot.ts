/**
 * @fileoverview 一次取数的结果信封：要么 `ok` 带值，要么 `error` 带原因。
 * ⚠ 没有第三档——「空」不是一档结果。把取不到渲染成空序列，正是本设计
 * 要消灭的那类静默故障（docs/DASHBOARD_DESIGN.md §4.3）。
 */
import type {
  DataSourceProvider,
  HistoryQuery,
  HistoryResult,
} from '@dt/contracts'

import { DataSourceError, describeError, isDataSourceError } from './errors'

/** 取到了。 */
export interface DataSlotOk<TValue> {
  state: 'ok'
  value: TValue
}

/** 没取到，且说得出为什么。 */
export interface DataSlotError {
  state: 'error'
  error: DataSourceError
}

export type DataSlot<TValue> = DataSlotOk<TValue> | DataSlotError

/**
 * 包一个取到的值。
 * @param value 取到的值
 */
export function okSlot<TValue>(value: TValue): DataSlotOk<TValue> {
  return { state: 'ok', value }
}

/**
 * 包一次失败。
 * @param error 失败原因
 */
export function errorSlot(error: DataSourceError): DataSlotError {
  return { state: 'error', error }
}

/**
 * 读一段历史并收成槽结果，失败一律成 `error` 槽。
 * @param provider 认这条绑定的 provider
 * @param query 点位与时间范围
 */
export async function readHistorySlot(
  provider: DataSourceProvider,
  query: HistoryQuery,
): Promise<DataSlot<HistoryResult>> {
  try {
    return okSlot(await provider.readHistory(query))
  } catch (error) {
    return errorSlot(toDataSourceError(error))
  }
}

function toDataSourceError(error: unknown): DataSourceError {
  if (isDataSourceError(error)) return error
  return new DataSourceError(
    'fetch-failed',
    `历史取数失败：${describeError(error)}`,
    { cause: error },
  )
}
