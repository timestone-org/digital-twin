/** @fileoverview 回填任务恢复与进度读取；迟到结果不得覆盖当前台账。 */
import { onBeforeUnmount, ref, watch } from 'vue'
import type { DatasetBackfillJob, DatasetTable } from '@dt/contracts'
import * as dataset from '@/api/dataset'
import { describeError } from '@/composables/useAsyncList'
import { useRacedFetch, type RacedFetch } from '@/composables/useRacedFetch'
import { useBackfillActions } from './useBackfillActions'

function createState() {
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
  state: ReturnType<typeof createState>
  raced: RacedFetch
  timer: ReturnType<typeof setTimeout> | null
  disposed: boolean
}
function stopPolling(ctx: ReadContext): void {
  if (ctx.timer !== null) clearTimeout(ctx.timer)
  ctx.timer = null
}
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
