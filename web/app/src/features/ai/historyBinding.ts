/** @fileoverview 助手历史来源参数转为绑定契约，拒绝无效或互相冲突的范围。 */
import { COLLECT_AGGREGATES, parseDatasetBindingKey } from '@dt/contracts'
import type {
  ArchiveBindingDetail,
  AssistantToolCall,
  BindingDetail,
  HistoryTimeRange,
} from '@dt/contracts'
import { resolveTrendBucket } from '@/features/trend/trendBucket'

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 读取非空字符串参数。 */
export function bindingText(call: AssistantToolCall, key: string): string {
  const value = call.arguments[key]
  if (typeof value !== 'string' || value.trim() === '')
    throw new Error(`缺少 ${key}`)
  return value.trim()
}

/** 按首个冒号分隔的数据源与点位身份。 */
export function pointKey(call: AssistantToolCall): string {
  const key = bindingText(call, 'node_key')
  if (key.indexOf(':') <= 0 || key.endsWith(':'))
    throw new Error('node_key 必须是 数据源id:点位编码')
  return key
}

/** 相对窗与绝对窗二选一；不依赖隐含的一小时回退。 */
function rangeOf(value: unknown): HistoryTimeRange {
  if (!record(value)) throw new Error('历史来源必须给 range')
  if (
    Object.keys(value).some(
      (key) => !['from_ms', 'to_ms', 'last_window', 'limit'].includes(key),
    )
  )
    throw new Error('range 含未知字段')
  const range =
    value.last_window === undefined
      ? absoluteRange(value)
      : relativeRange(value)
  if (value.limit !== undefined)
    throw new Error('时序渲染不支持 limit，请用时间窗控制范围')
  return range
}

function relativeRange(value: Record<string, unknown>): HistoryTimeRange {
  if (
    typeof value.last_window !== 'string' ||
    !/^[1-9]\d{0,3}[smhd]$/.test(value.last_window)
  )
    throw new Error('last_window 只认 30s / 15m / 2h / 7d 等正数窗口')
  if (value.from_ms !== undefined || value.to_ms !== undefined)
    throw new Error('相对窗与绝对窗只能给一组')
  return { lastWindow: value.last_window }
}

function absoluteRange(value: Record<string, unknown>): HistoryTimeRange {
  if (
    !validTimestamp(value.from_ms) ||
    !validTimestamp(value.to_ms) ||
    value.from_ms >= value.to_ms
  )
    throw new Error('必须给 from_ms < to_ms 的 UTC 毫秒窗口')
  return { fromMs: value.from_ms, toMs: value.to_ms }
}

function validTimestamp(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    Number.isFinite(new Date(value).getTime())
  )
}

/** 完整的归档或台账取数说明，转换后没有裸 JSON 断言。 */
export function historyDetail(
  call: AssistantToolCall,
  kind: 'archive' | 'dataset',
): BindingDetail {
  const range = rangeOf(call.arguments.range)
  if (kind === 'dataset') {
    const datasetKey = bindingText(call, 'dataset_key')
    if (parseDatasetBindingKey(datasetKey) === null)
      throw new Error('dataset_key 必须是 ds:台账编码:列key')
    if (
      ['aggregate', 'interval', 'timezone'].some(
        (key) => call.arguments[key] !== undefined,
      )
    )
      throw new Error('台账来源不支持归档分桶参数')
    return { datasetKey, range }
  }
  return archiveDetail(call, range)
}

function archiveDetail(
  call: AssistantToolCall,
  range: HistoryTimeRange,
): ArchiveBindingDetail {
  const detail: ArchiveBindingDetail = { nodeKey: pointKey(call), range }
  if (call.arguments.aggregate !== undefined) {
    const aggregate = COLLECT_AGGREGATES.find(
      (one) => one === call.arguments.aggregate,
    )
    if (aggregate === undefined)
      throw new Error('aggregate 必须是 avg / max / min / sum / count')
    detail.aggregate = aggregate
  }
  if (call.arguments.interval !== undefined) {
    const interval = bindingText(call, 'interval')
    if (resolveTrendBucket(1, interval)?.value !== interval)
      throw new Error('interval 不是支持的分桶档位')
    detail.interval = interval
  }
  if (call.arguments.timezone !== undefined) {
    const timezone = bindingText(call, 'timezone')
    try {
      new Intl.DateTimeFormat('en', { timeZone: timezone }).format(0)
    } catch {
      throw new Error('timezone 必须是有效的 IANA 时区')
    }
    detail.timezone = timezone
  }
  return detail
}
