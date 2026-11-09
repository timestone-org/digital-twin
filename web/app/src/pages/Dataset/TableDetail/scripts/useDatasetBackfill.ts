/** @fileoverview 回填任务恢复与进度读取；迟到结果不得覆盖当前台账。 */
import { onBeforeUnmount, ref, watch } from 'vue'
import type { DatasetBackfillJob, DatasetTable } from '@dt/contracts'
import * as dataset from '@/api/dataset'
import { describeError } from '@/composables/useAsyncList'
import { useRacedFetch, type RacedFetch } from '@/composables/useRacedFetch'
import type { BackfillState } from './backfillState'
import { useBackfillActions } from './useBackfillActions'

/** 一份空白的回填状态。 */
function createState(): BackfillState {
  return {
    isOpen: ref(false),
    job: ref<DatasetBackfillJob | null>(null),
    since: ref(''),
    until: ref(''),
    loading: ref(false),
    busy: ref(false),
    uncertain: ref(false),
    error: ref<string | null>(null),
    notice: ref<string | null>(null),
  }
}

interface ReadContext {
  table: () => DatasetTable
  state: BackfillState
  raced: RacedFetch
  timer: ReturnType<typeof setTimeout> | null
  disposed: boolean
}

/**
 * 停掉轮询定时器。
 * @param ctx 读取上下文
 */
function stopPolling(ctx: ReadContext): void {
  if (ctx.timer !== null) clearTimeout(ctx.timer)
  ctx.timer = null
}

/**
 * 只在弹窗开着、任务运行中、没有写在飞且结果不是未知时排下一次读。
 * @param ctx 读取上下文
 */
function schedule(ctx: ReadContext): void {
  stopPolling(ctx)
  const { isOpen, job, uncertain, busy } = ctx.state
  if (
    !ctx.disposed &&
    isOpen.value &&
    job.value?.status === 'running' &&
    !uncertain.value &&
    !busy.value
  ) {
    ctx.timer = setTimeout(() => {
      void refresh(ctx)
    }, 2000)
  }
}

/**
 * 读一次实际任务；失败置 `uncertain` 锁写，不把「读不到」当成「没有任务」。
 * @param ctx 读取上下文
 */
async function refresh(ctx: ReadContext): Promise<void> {
  if (
    ctx.disposed ||
    ctx.table().collect_mode !== 'aggregate' ||
    ctx.state.busy.value
  )
    return
  stopPolling(ctx)
  const { loading, job, error, uncertain, notice } = ctx.state
  loading.value = true
  await ctx.raced.run(
    (signal) => dataset.getDatasetBackfill(ctx.table().id, signal),
    {
      ok: (result) => {
        job.value = result
        error.value = null
        uncertain.value = false
        if (result === null) notice.value = '当前没有保留的回填任务。'
      },
      fail: (caught) => {
        error.value = `进度读取失败：${describeError(caught)}。请手动刷新核查。`
        uncertain.value = true
      },
      settled: () => {
        loading.value = false
        schedule(ctx)
      },
    },
  )
}

/**
 * 换表即清空重读，关窗停读，卸载作废一切。
 * @param ctx 读取上下文
 */
function installLifecycle(ctx: ReadContext): void {
  const { isOpen, job, since, until, error, notice, uncertain, loading } =
    ctx.state
  watch(
    () => `${ctx.table().id}:${ctx.table().collect_mode}`,
    () => {
      ctx.raced.cancel()
      stopPolling(ctx)
      job.value = null
      since.value = ''
      until.value = ''
      error.value = null
      notice.value = null
      uncertain.value = false
      loading.value = false
      isOpen.value = false
      void refresh(ctx)
    },
    { immediate: true },
  )
  watch(isOpen, (open) => {
    if (open) void refresh(ctx)
    else {
      ctx.raced.cancel()
      stopPolling(ctx)
      loading.value = false
    }
  })
  onBeforeUnmount(() => {
    ctx.disposed = true
    ctx.raced.cancel()
    stopPolling(ctx)
  })
}

/**
 * 装上一张台账的历史桶回填面板。
 * @param table 取当前台账；随路由换人，故是个函数
 */
export function useDatasetBackfill(table: () => DatasetTable) {
  const state = createState()
  const ctx: ReadContext = {
    table,
    state,
    raced: useRacedFetch(),
    timer: null,
    disposed: false,
  }
  const refreshTask = () => refresh(ctx)
  const actions = useBackfillActions(table, {
    ...state,
    refresh: refreshTask,
    schedule: () => schedule(ctx),
    stopPolling: () => stopPolling(ctx),
    cancelRead: ctx.raced.cancel,
    isAlive: () => !ctx.disposed,
  })
  installLifecycle(ctx)
  return { ...state, ...actions, refresh: refreshTask }
}
