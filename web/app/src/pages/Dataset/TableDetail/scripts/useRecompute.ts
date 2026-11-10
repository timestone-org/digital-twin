/**
 * @fileoverview 重算任务：起任务 → 轮询到终态 → 报回执；迟到结果不得覆盖当前台账。
 *
 * 重算是后台任务（docs/DATASET_DESIGN.md §14.10）：受理回执永远是 `running`
 * 且一行都还没算，数要读到终态才有。轮询口径见 §7.12。
 */

import { onBeforeUnmount, ref, watch, type Ref } from 'vue'
import type { DatasetRecomputeJob } from '@dt/contracts'
import type { useToast } from '@dt/ui'

import * as dataset from '@/api/dataset'
import { describeError } from '@/composables/useAsyncList'
import { useRacedFetch, type RacedFetch } from '@/composables/useRacedFetch'
import { recomputeReceipt } from './recordView'
import type { RecordsView } from './useRecords'

/** 轮询间隔（毫秒）。 */
export const RECOMPUTE_POLL_MS = 1500

export interface RecomputeTask {
  /** 有一个重算在跑（含刚受理、含刷新之前起的那一个）。 */
  running: Ref<boolean>
  start: () => Promise<void>
}

export interface RecomputeHooks {
  /** 起任务失败（权限、撞锁、网络）。 */
  onStartFailed: (message: string) => void
  /** 读到终态（done / failed）。 */
  onFinished: (job: DatasetRecomputeJob) => Promise<void>
}

interface Ctx {
  tableId: () => string
  hooks: RecomputeHooks
  running: Ref<boolean>
  raced: RacedFetch
  timer: ReturnType<typeof setTimeout> | null
  disposed: boolean
}

/**
 * 停掉轮询定时器。
 * @param ctx 上下文
 */
function stopPolling(ctx: Ctx): void {
  if (ctx.timer !== null) clearTimeout(ctx.timer)
  ctx.timer = null
}

/**
 * 只在仍在跑且没卸载时排下一次读。
 * @param ctx 上下文
 */
function schedule(ctx: Ctx): void {
  stopPolling(ctx)
  if (ctx.disposed || !ctx.running.value) return
  ctx.timer = setTimeout(() => {
    void poll(ctx)
  }, RECOMPUTE_POLL_MS)
}

/**
 * 读一次进度。
 * ⚠ 读失败**静默**重排：每 1.5 秒一个吐司会糊满屏幕；按钮保持「重算中」直到
 * 读到终态——读不到不等于没在跑，放开按钮会让人再发一次，撞上的是那把锁。
 * @param ctx 上下文
 */
async function poll(ctx: Ctx): Promise<void> {
  stopPolling(ctx)
  // 回调里写、回调外读：用持有对象而不是 let，免得被控制流收窄成常量
  const seen: { job: DatasetRecomputeJob | null; isOver: boolean } = {
    job: null,
    isOver: false,
  }
  await ctx.raced.run(
    (signal) => dataset.getDatasetRecompute(ctx.tableId(), signal),
    {
      ok: (job) => {
        seen.isOver = job === null || job.status !== 'running'
        seen.job = job
      },
      fail: () => undefined,
      settled: () => undefined,
    },
  )
  if (ctx.disposed) return
  if (!seen.isOver) {
    schedule(ctx)
    return
  }
  ctx.running.value = false
  // 任务态已过期（null）时什么都说不出来，只放开按钮
  if (seen.job !== null) await ctx.hooks.onFinished(seen.job)
}

/**
 * 挂载 / 换表时读一次：接上刷新页面之前起的那一个，但不为旧任务报回执。
 * @param ctx 上下文
 */
async function resume(ctx: Ctx): Promise<void> {
  await ctx.raced.run(
    (signal) => dataset.getDatasetRecompute(ctx.tableId(), signal),
    {
      ok: (job) => {
        ctx.running.value = job?.status === 'running'
      },
      fail: () => undefined,
      settled: () => schedule(ctx),
    },
  )
}

/**
 * 起一次重算。
 * @param ctx 上下文
 */
async function start(ctx: Ctx): Promise<void> {
  if (ctx.running.value) return
  ctx.raced.cancel()
  stopPolling(ctx)
  ctx.running.value = true
  try {
    await dataset.startDatasetRecompute(ctx.tableId())
  } catch (caught) {
    ctx.running.value = false
    if (!ctx.disposed) ctx.hooks.onStartFailed(describeError(caught))
    return
  }
  schedule(ctx)
}

/**
 * 读到终态之后：报回执、放横幅、原地重取当前页。
 * ⚠ 只有**算完且一行没错**才放下「下游过期」的横幅：触顶的那一次没算完，
 * 收起横幅等于告诉用户已经算好了。
 * @param job 终态任务
 * @param deps 吐司与数据分区的状态
 */
export async function reportRecompute(
  job: DatasetRecomputeJob,
  deps: { toast: ReturnType<typeof useToast>; records: RecordsView },
): Promise<void> {
  if (job.status === 'failed') deps.toast.error(job.message)
  else {
    const receipt = recomputeReceipt(job)
    if (receipt.isPartial) deps.toast.warning(receipt.text)
    else {
      deps.toast.success(receipt.text)
      deps.records.isStale.value = false
    }
  }
  await deps.records.refresh()
}

/**
 * 装上一张台账的重算任务。
 * @param tableId 取台账 id；随路由换人，故是个函数
 * @param hooks 起不来 / 算完时的回调
 */
export function useRecompute(
  tableId: () => string,
  hooks: RecomputeHooks,
): RecomputeTask {
  const ctx: Ctx = {
    tableId,
    hooks,
    running: ref(false),
    raced: useRacedFetch(),
    timer: null,
    disposed: false,
  }
  watch(
    tableId,
    (id) => {
      ctx.raced.cancel()
      stopPolling(ctx)
      ctx.running.value = false
      if (id !== '') void resume(ctx)
    },
    { immediate: true },
  )
  onBeforeUnmount(() => {
    ctx.disposed = true
    ctx.raced.cancel()
    stopPolling(ctx)
  })
  return { running: ctx.running, start: () => start(ctx) }
}
