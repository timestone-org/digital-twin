/**
 * @fileoverview 摄取轮询：表里还有没到终态的文档就每 5 秒重取一次，全部到终态即停。
 * ⚠ 摄取由后台 worker 异步接手，没有推送通道；不轮询的话，用户只会盯着一个
 * 不动的「待处理」。
 */
import { onScopeDispose, watch } from 'vue'
import type { Ref } from 'vue'
import type { KnowledgeDocumentStatus } from '@dt/contracts'

import type { KnowledgeDocument } from '@/api/knowledge'

/** 轮询周期。 */
export const INGEST_POLL_MS = 5000

const SETTLED: readonly KnowledgeDocumentStatus[] = ['ready', 'failed']

/** 这份文档还在后台处理中。 */
export function isIngesting(row: KnowledgeDocument): boolean {
  return !SETTLED.includes(row.status)
}

/**
 * 盯着文档表，有处理中的行就按周期重取；离开作用域时清掉定时器。
 * @param documents 当前库的文档
 * @param refresh 重取一次
 */
export function useIngestPolling(
  documents: Ref<readonly KnowledgeDocument[]>,
  refresh: () => Promise<void>,
): { stop: () => void } {
  let timer: ReturnType<typeof setInterval> | null = null

  function stop(): void {
    if (timer !== null) clearInterval(timer)
    timer = null
  }

  function sync(rows: readonly KnowledgeDocument[]): void {
    if (!rows.some(isIngesting)) {
      stop()
      return
    }
    if (timer === null) {
      timer = setInterval(() => void refresh(), INGEST_POLL_MS)
    }
  }

  watch(documents, sync, { immediate: true })
  // ⚠ 不清的话，切走的页面还在每 5 秒打接口并写进一个没人看的状态
  onScopeDispose(stop)

  return { stop }
}
