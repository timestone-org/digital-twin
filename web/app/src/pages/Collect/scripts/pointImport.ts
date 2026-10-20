/** @fileoverview 批量建点与 CSV 更新：切批、独立幂等键、逐批反馈结果。 */
import type {
  CollectPointItemInput,
  CollectPointImportItemInput,
} from '@dt/contracts'
import { COLLECT_POINT_BATCH_MAX } from '@dt/contracts'

import * as collect from '@/api/collect'
import { newIdempotencyKey } from '@/api/idempotency'
import { describeError } from '@/composables/useAsyncList'

export interface ImportProgress {
  /** 已经提交完的条数（含失败批）。 */
  done: number
  total: number
}

export interface ImportFailure {
  /** 这一批在整份文件里的序号，从 1 开始。 */
  batch: number
  /** 这一批里的点位编码，供用户回文件里找。 */
  codes: string[]
  message: string
}

export interface ImportOutcome {
  created: number
  failures: ImportFailure[]
  /** 现场没确认过的寻址串条数。⚠ 它不是失败，但也绝不是「校过没问题」。 */
  unverified: number
}

export interface CsvImportOutcome extends ImportOutcome {
  updated: number
  unchanged: number
}

/** 把一串点位按后端上限切批。 */
export function chunk<T>(
  items: readonly T[],
  size: number = COLLECT_POINT_BATCH_MAX,
): T[][] {
  const batches: T[][] = []
  for (let start = 0; start < items.length; start += size) {
    batches.push(items.slice(start, start + size))
  }
  return batches
}

/**
 * 逐批提交。
 * @param sourceId 数据源
 * @param items 全部要建的点位
 * @param onProgress 每批结束回调一次，供界面走进度条
 */
export async function importPoints(
  sourceId: string,
  items: readonly CollectPointItemInput[],
  onProgress: (progress: ImportProgress) => void = () => undefined,
): Promise<ImportOutcome> {
  const batches = chunk(items)
  const outcome: ImportOutcome = { created: 0, failures: [], unverified: 0 }
  let done = 0
  for (const [index, batch] of batches.entries()) {
    try {
      const result = await collect.createPoints(
        { source_id: sourceId, items: batch },
        newIdempotencyKey(),
      )
      outcome.created += result.items.length
      outcome.unverified += result.address_checks.filter(
        (check) => check.status === 'unverified',
      ).length
    } catch (caught) {
      outcome.failures.push({
        batch: index + 1,
        codes: batch.map((item) => item.code),
        message: describeError(caught),
      })
    }
    done += batch.length
    onProgress({ done, total: items.length })
  }
  return outcome
}

/** CSV 按编码新增或更新，逐批报告结果。 */
export async function importCsvPoints(
  sourceId: string,
  items: readonly CollectPointImportItemInput[],
  onProgress: (progress: ImportProgress) => void = () => undefined,
  isSkippingExisting = false,
): Promise<CsvImportOutcome> {
  const outcome: CsvImportOutcome = {
    created: 0,
    updated: 0,
    unchanged: 0,
    failures: [],
    unverified: 0,
  }
  let done = 0
  for (const [index, batch] of chunk(items).entries()) {
    try {
      const result = await collect.importPoints(
        {
          source_id: sourceId,
          items: batch,
          is_skipping_existing: isSkippingExisting,
        },
        newIdempotencyKey(),
      )
      outcome.created += result.created_count
      outcome.updated += result.updated_count
      outcome.unchanged += result.unchanged_count
      outcome.unverified += result.address_checks.filter(
        (check) => check.status === 'unverified',
      ).length
    } catch (caught) {
      outcome.failures.push({
        batch: index + 1,
        codes: batch.map((item) => item.code),
        message: describeError(caught),
      })
    }
    done += batch.length
    onProgress({ done, total: items.length })
  }
  return outcome
}
