/** @fileoverview 公开票据限定的台账最新值读取，不访问台账目录或历史接口。 */
import type { DatasetLatestValue } from './datasetLatest'
import { requestData } from './client'
import { onPlatform } from './dashboard'

export interface PublicDatasetLatestItemWire {
  dataset_key: string
  status: 'ok' | 'error'
  value: unknown
  ts: string | null
  stale_at: string | null
  message: string | null
}

export interface PublicDatasetLatestWire {
  items: PublicDatasetLatestItemWire[]
}

/** 仅读取票据所属大屏已经公开的台账标量。 */
export async function readPublicDatasetLatest(
  publicToken: string,
  keys: readonly string[],
  signal: AbortSignal,
): Promise<ReadonlyMap<string, DatasetLatestValue>> {
  const result = await requestData<PublicDatasetLatestWire>(
    `/public-dashboards/${encodeURIComponent(publicToken)}/dataset-latest`,
    onPlatform({ anonymous: true, signal }),
  )
  const wanted = new Set(keys)
  const found = new Map(
    result.items
      .filter((item) => wanted.has(item.dataset_key))
      .map((item) => [item.dataset_key, latestValue(item)]),
  )
  for (const key of keys) {
    if (!found.has(key)) found.set(key, failure('公开大屏未提供该台账读数'))
  }
  return found
}

function latestValue(item: PublicDatasetLatestItemWire): DatasetLatestValue {
  if (item.status === 'error')
    return failure(item.message ?? '公开台账读数不可用')
  const timestampMs = item.ts === null ? undefined : Date.parse(item.ts)
  const staleAtMs =
    item.stale_at === null ? undefined : Date.parse(item.stale_at)
  if ([timestampMs, staleAtMs].some(Number.isNaN))
    return failure('公开台账读数的时间格式不正确')
  return {
    slot: {
      state: 'ok',
      value: item.value,
      dependsOnRealtime: false,
      ...(timestampMs === undefined ? {} : { timestampMs }),
    },
    ...(staleAtMs === undefined ? {} : { staleAtMs }),
  }
}

function failure(message: string): DatasetLatestValue {
  return { slot: { state: 'error', message } }
}
