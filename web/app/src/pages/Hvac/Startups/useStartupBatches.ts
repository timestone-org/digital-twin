/**
 * @fileoverview 抽取批次与组合覆盖度的取数。
 *
 * ⚠ 自持一个竞态序号：换房间会同时触发它与事件列表两条路，共用序号会让两边
 * 互相判成过期，表现是「换个房间有一半没数据」。
 * ⚠ 重算期间**不清空已有数据**：显示上一批次的完整结果 + 进度，比显示半份
 * 数据安全得多——半份数据看起来是完整的，没有任何迹象说明它只抽到一半
 * （AC_STARTUP_DESIGN §5）。
 */
import { computed, ref, type ComputedRef, type Ref } from 'vue'
import type { CombinationCoverage, StartupBatch } from '@dt/contracts'

import * as hvac from '@/api/hvac'
import { describeError } from '@/composables/useAsyncList'
import { useRacedFetch, type RacedFetch } from '@/composables/useRacedFetch'

export interface StartupBatchesView {
  current: Ref<StartupBatch | null>
  coverage: Ref<CombinationCoverage[]>
  /** 指纹对不上：现在屏幕上这份数据是按**另一套规则**算出来的。 */
  isStale: Ref<boolean>
  /** 有没有算过。没算过与该重算，要人做的事不同。 */
  hasBatch: ComputedRef<boolean>
  isRunning: ComputedRef<boolean>
  loading: Ref<boolean>
  rebuilding: Ref<boolean>
  error: Ref<string | null>
  load: () => Promise<void>
  rebuild: () => Promise<boolean>
}

interface BatchesState {
  roomId: () => string
  current: Ref<StartupBatch | null>
  coverage: Ref<CombinationCoverage[]>
  isStale: Ref<boolean>
  loading: Ref<boolean>
  rebuilding: Ref<boolean>
  error: Ref<string | null>
  raced: RacedFetch
}

/**
 * @param roomId 取当前选中的房间 id
 */
export function useStartupBatches(roomId: () => string): StartupBatchesView {
  const state: BatchesState = {
    roomId,
    current: ref<StartupBatch | null>(null),
    coverage: ref<CombinationCoverage[]>([]),
    isStale: ref(false),
    loading: ref(false),
    rebuilding: ref(false),
    error: ref<string | null>(null),
    raced: useRacedFetch(),
  }
  return {
    current: state.current,
    coverage: state.coverage,
    isStale: state.isStale,
    loading: state.loading,
    rebuilding: state.rebuilding,
    error: state.error,
    hasBatch: computed(() => state.current.value !== null),
    isRunning: computed(() => state.current.value?.status === 'running'),
    load: () => load(state),
    rebuild: () => rebuild(state),
  }
}

async function load(state: BatchesState): Promise<void> {
  const room = state.roomId()
  if (room === '') {
    state.current.value = null
    state.coverage.value = []
    state.isStale.value = false
    return
  }
  state.loading.value = true
  await state.raced.run(() => hvac.getStartupBatches(room), {
    ok: (found) => {
      state.current.value = found.current
      state.coverage.value = found.coverage
      state.isStale.value = found.is_stale
      state.error.value = null
    },
    fail: (caught) => (state.error.value = describeError(caught)),
    settled: () => (state.loading.value = false),
  })
}

/**
 * 触发一次重算，成功即刻回读一次拿到 running 状态。
 * ⚠ 端点只入队（202），这里**不等它算完**——等的话页面会挂到超时。
 */
async function rebuild(state: BatchesState): Promise<boolean> {
  const batch = state.current.value
  if (batch === null) return false
  state.rebuilding.value = true
  state.error.value = null
  try {
    await hvac.rebuildStartupBatches(state.roomId(), {
      window_start: batch.window_start,
      window_end: batch.window_end,
    })
    await load(state)
    return true
  } catch (caught) {
    state.error.value = describeError(caught)
    return false
  } finally {
    state.rebuilding.value = false
  }
}
