/** @fileoverview 历史桶回填的状态形状，以及写失败时怎么落到状态上。 */
import type { Ref } from 'vue'
import type { DatasetBackfillJob } from '@dt/contracts'
import { ERROR_CODES } from '@dt/contracts'
import { BizError, TransportError } from '@/api/client'
import { describeError } from '@/composables/useAsyncList'

/** 回填面板的状态；读与写两半共用这一份。 */
export interface BackfillState {
  isOpen: Ref<boolean>
  job: Ref<DatasetBackfillJob | null>
  since: Ref<string>
  until: Ref<string>
  loading: Ref<boolean>
  /** 正在等确认或写请求在飞。 */
  busy: Ref<boolean>
  /** 上一次写或读的结果不明：此时禁止再发写，免得重复启动。 */
  uncertain: Ref<boolean>
  error: Ref<string | null>
  notice: Ref<string | null>
}

/**
 * 写失败的落点。409 冲突返回 true，调用方据此去读实际任务；超时、5xx 与传输错误
 * 结果未知，置 `uncertain` 锁写，不许用户再点一次重复启动。
 * @param state 回填状态
 * @param caught 写请求抛出的错误
 */
export function applyWriteError(
  state: BackfillState,
  caught: unknown,
): boolean {
  if (
    caught instanceof BizError &&
    (caught.code === ERROR_CODES.datasetBackfillBusy ||
      caught.code === ERROR_CODES.datasetBackfillNotRunning)
  ) {
    state.notice.value =
      caught.code === ERROR_CODES.datasetBackfillBusy
        ? '已有任务正在执行，尝试重新读取实际进度。'
        : '任务已不在运行，尝试重新读取实际状态。'
    return true
  }
  state.uncertain.value =
    caught instanceof TransportError ||
    !(caught instanceof BizError) ||
    caught.status >= 500
  state.error.value = state.uncertain.value
    ? `操作状态未确认：${describeError(caught)}。请手动刷新进度核查，不要重复启动。`
    : describeError(caught)
  return false
}
