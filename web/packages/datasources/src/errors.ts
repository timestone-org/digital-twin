/**
 * @fileoverview 取数失败的统一错误类型。调用方按 `code` 分支，不按 `message`
 * 分支——文案会改、会翻译。取不到就说取不到（docs/DASHBOARD_DESIGN.md §4.3）。
 */

/**
 * 取数没成的原因。
 * `unknown-source-kind` 来源种类没登记 provider、`unsupported-subscribe` 该来源
 * 没有可订阅的点位、`unsupported-history` 该来源没有历史序列、
 * `invalid-query` 取数参数自相矛盾、`missing-static-value` 常量绑定没配值、
 * `fetch-failed` 注入的取数函数失败。
 */
export const DATA_SOURCE_ERROR_CODES = [
  'unknown-source-kind',
  'unsupported-subscribe',
  'unsupported-history',
  'invalid-query',
  'missing-static-value',
  'fetch-failed',
] as const
export type DataSourceErrorCode = (typeof DATA_SOURCE_ERROR_CODES)[number]

/**
 * 一次取数为什么没成。
 * ⚠ 失败必须抛/拒这个类型，不许回退成空值或空序列——空序列会被读成
 * 「这段时间没数据」，那是另一个事实。
 */
export class DataSourceError extends Error {
  readonly code: DataSourceErrorCode

  constructor(
    code: DataSourceErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'DataSourceError'
    this.code = code
  }
}

/**
 * 一个未知值是不是取数错误。
 * @param value catch 到的东西，JS 里它可以是任何值
 */
export function isDataSourceError(value: unknown): value is DataSourceError {
  return value instanceof DataSourceError
}

/**
 * 把 catch 到的任意值说成一句话，用来做外层错误的正文。
 * @param value catch 到的东西
 */
export function describeError(value: unknown): string {
  return value instanceof Error ? value.message : String(value)
}
