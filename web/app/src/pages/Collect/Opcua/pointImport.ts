/**
 * @fileoverview 批量导入的上传编排：切批、逐批提交、逐批记账。
 *
 * ⚠ 后端一批最多 200 条且**整批原子**——一条编码撞了就整批 409。所以这里
 * 必须按批报进度与失败，不能只给一句「导入失败」：用户要知道前面几批已经进
 * 去了、是哪一批出的错、错在哪一条。
 *
 * ⚠ 每批一个独立幂等键：同一个键重发会被后端当成同一次请求，而不同批本来
 * 就是不同的请求。共用一个键的表现是「第二批开始全部静默丢失」。
 */
import type { CollectPointItemInput } from '@dt/contracts'
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

/** 把一串点位按后端上限切批。 */
export function chunk(
  items: readonly CollectPointItemInput[],
  size: number = COLLECT_POINT_BATCH_MAX,
): CollectPointItemInput[][] {
  const batches: CollectPointItemInput[][] = []
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
