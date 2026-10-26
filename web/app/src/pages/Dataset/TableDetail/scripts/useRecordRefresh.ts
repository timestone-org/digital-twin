/** @fileoverview 自动采集台账的首页定时刷新，隐藏、失活或编辑时暂停。 */
import { computed, onScopeDispose, ref, watch } from 'vue'
import type { DatasetTable } from '@dt/contracts'

import { useWorkspacePage } from '@/features/workspace/context'
import type { RecordsView } from './useRecords'

const REFRESH_MS = 60_000

interface RefreshOptions {
  table: () => DatasetTable | null
  records: RecordsView
  isBusy: () => boolean
}

/** 定时读取新记录并在恢复可见时立即补读。@param options 页面读取状态。 */
export function useRecordRefresh(options: RefreshOptions): void {
  const workspacePage = useWorkspacePage()
  const isVisible = ref(!document.hidden)
  const isEnabled = computed(() => {
    const table = options.table()
    return (
      table?.collect_mode === 'aggregate' &&
      table.is_enabled &&
      options.records.page.value === 1 &&
      !options.isBusy() &&
      isVisible.value &&
      workspacePage?.active.value !== false
    )
  })
  const refresh = (): void => {
    if (isEnabled.value && !options.records.isFetching.value)
      void options.records.refreshInBackground()
  }
  let timer: ReturnType<typeof setInterval> | null = null
  function stop(): void {
    if (timer !== null) clearInterval(timer)
    timer = null
  }
  watch(
    isEnabled,
    (enabled) => {
      stop()
      if (!enabled) return
      timer = setInterval(refresh, REFRESH_MS)
    },
    { immediate: true },
  )
  const followVisibility = (): void => {
    isVisible.value = !document.hidden
  }
  document.addEventListener('visibilitychange', followVisibility)
  watch(
    () => isVisible.value && workspacePage?.active.value !== false,
    (isActive) => {
      if (isActive) refresh()
      else if (!options.records.loading.value) options.records.cancel()
    },
  )
  onScopeDispose(() => {
    stop()
    document.removeEventListener('visibilitychange', followVisibility)
  })
}
