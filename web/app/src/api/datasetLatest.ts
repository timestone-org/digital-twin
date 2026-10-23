/** @fileoverview 台账标量按表合并读取最新生效值，采集桶超期时保留陈旧标记。 */
import type { DatasetLatest, DatasetTableSummary, Page } from '@dt/contracts'
import { parseDatasetBindingKey } from '@dt/contracts'
import type { BindingSlot } from '@dt/runtime'

import { PLATFORM_BASE_URL } from '@/config/app'

import { BizError, requestData, TransportError } from './client'

const TABLE_PAGE_SIZE = 200
const REFRESH_TOLERANCE_MS = 60_000

export interface DatasetLatestValue {
  slot: BindingSlot
  staleAtMs?: number
  canRetain?: boolean
}

/** 只有网络中断或服务端暂态错误才允许保留陈旧值。 */
export function canRetainDatasetLatest(caught: unknown): boolean {
  if (caught instanceof BizError) return caught.status >= 500
  return (
    caught instanceof TransportError &&
    (caught.status === 0 || caught.status >= 500)
  )
}

/** 按台账列身份取最新值；一张表失败不影响其它表。 */
export async function readDatasetLatest(
  keys: readonly string[],
  signal: AbortSignal,
): Promise<ReadonlyMap<string, DatasetLatestValue>> {
  const tables = await readTables(signal)
  const found = new Map<string, DatasetLatestValue>()
  const groups = new Map<string, string[]>()
  for (const key of keys) {
    const parts = parseDatasetBindingKey(key)
    if (parts === null) {
      found.set(key, failure('台账列身份必须是 ds:台账编码:列标识'))
      continue
    }
    const group = groups.get(parts.code) ?? []
    group.push(key)
    groups.set(parts.code, group)
  }
  const results = await Promise.allSettled(
    [...groups].map(async ([code, wanted]) => {
      const table = tables.get(code)
      if (table === undefined) {
        for (const key of wanted) found.set(key, failure(`台账不存在：${code}`))
        return
      }
      await readTable(table, wanted, found, signal)
    }),
  )
  for (const result of results) {
    if (result.status === 'rejected') throw result.reason
  }
  return found
}

/** 翻完目录，避免将第二页之后的表误报为不存在。 */
async function readTables(
  signal: AbortSignal,
): Promise<Map<string, DatasetTableSummary>> {
  const tables = new Map<string, DatasetTableSummary>()
  let page = 1
  while (true) {
    const result = await requestData<Page<DatasetTableSummary>>(
      '/dataset-tables',
      {
        baseUrl: PLATFORM_BASE_URL,
        query: { page, size: TABLE_PAGE_SIZE },
        signal,
      },
    )
    for (const table of result.items) tables.set(table.code, table)
    if (page * result.size >= result.total) return tables
    if (result.items.length === 0) throw new Error('台账目录分页未返回完整结果')
    page += 1
  }
}

/** 同表所有列共享一次 latest，请求失败逐列保留原因。 */
async function readTable(
  table: DatasetTableSummary,
  keys: readonly string[],
  found: Map<string, DatasetLatestValue>,
  signal: AbortSignal,
): Promise<void> {
  try {
    const latest = await requestData<DatasetLatest>(
      `/dataset-tables/${table.id}/latest`,
      {
        baseUrl: PLATFORM_BASE_URL,
        signal,
      },
    )
    for (const key of keys) found.set(key, valueOf(table, latest, key))
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught)
    for (const key of keys)
      found.set(key, {
        ...failure(`台账最新值取数失败：${message}`),
        canRetain: canRetainDatasetLatest(caught),
      })
  }
}

/** latest 的 values 已含人工修正，公式结果独立放在 computed。 */
function valueOf(
  table: DatasetTableSummary,
  latest: DatasetLatest,
  key: string,
): DatasetLatestValue {
  if (latest.ts === null) return { slot: { state: 'ok', value: null } }
  const timestampMs = Date.parse(latest.ts)
  if (!Number.isFinite(timestampMs))
    return failure('台账最新行的时间格式不正确')
  const column = parseDatasetBindingKey(key)?.columnKey ?? ''
  const values = { ...latest.values, ...latest.computed }
  if (!Object.hasOwn(values, column))
    return failure(`台账最新行缺少列：${column}`)
  return {
    slot: {
      state: 'ok',
      value: values[column],
      timestampMs,
      dependsOnRealtime: false,
    },
    ...(table.collect_mode === 'aggregate'
      ? {
          staleAtMs:
            table.is_enabled === false
              ? 0
              : timestampMs +
                table.collect_interval_ms * 2 +
                REFRESH_TOLERANCE_MS,
        }
      : {}),
  }
}

function failure(message: string): DatasetLatestValue {
  return { slot: { state: 'error', message } }
}
