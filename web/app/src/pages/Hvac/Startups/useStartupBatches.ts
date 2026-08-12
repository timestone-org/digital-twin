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
import type {
  CombinationCoverage,
  SourceRange,
  StartupBatch,
  StartupRebuildResult,
} from '@dt/contracts'

import * as hvac from '@/api/hvac'
import { describeError } from '@/composables/useAsyncList'
import { useRacedFetch, type RacedFetch } from '@/composables/useRacedFetch'

export interface StartupBatchesView {
  current: Ref<StartupBatch | null>
  coverage: Ref<CombinationCoverage[]>
  /** 指纹对不上：现在屏幕上这份数据是按**另一套规则**算出来的。 */
  isStale: Ref<boolean>
  /** 外库实际有数据的那一段；null 表示没绑数据源或外库此刻不可达。 */
  sourceRange: Ref<SourceRange | null>
  /** 有没有算过。没算过与该重算，要人做的事不同。 */
  hasBatch: ComputedRef<boolean>
  isRunning: ComputedRef<boolean>
  loading: Ref<boolean>
  rebuilding: Ref<boolean>
  error: Ref<string | null>
  load: () => Promise<void>
  /** 成功给后端最终决定的那一段；失败给 null。 */
  rebuild: (window: RebuildWindow) => Promise<StartupRebuildResult | null>
}

/** 要抽哪一段，UTC RFC3339。⚠ 两端都可省，全省即全部可用历史。 */
export interface RebuildWindow {
  window_start?: string | undefined
  window_end?: string | undefined
}

interface BatchesState {
  roomId: () => string
  current: Ref<StartupBatch | null>
  coverage: Ref<CombinationCoverage[]>
  isStale: Ref<boolean>
  sourceRange: Ref<SourceRange | null>
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
    sourceRange: ref<SourceRange | null>(null),
    loading: ref(false),
    rebuilding: ref(false),
    error: ref<string | null>(null),
    raced: useRacedFetch(),
  }
  return {
    current: state.current,
    coverage: state.coverage,
    isStale: state.isStale,
    sourceRange: state.sourceRange,
    loading: state.loading,
    rebuilding: state.rebuilding,
    error: state.error,
    hasBatch: computed(() => state.current.value !== null),
    isRunning: computed(() => state.current.value?.status === 'running'),
    load: () => load(state),
    rebuild: (window) => rebuild(state, window),
  }
}

async function load(state: BatchesState): Promise<void> {
  const room = state.roomId()
  if (room === '') {
    state.current.value = null
    state.coverage.value = []
    state.isStale.value = false
    state.sourceRange.value = null
    return
  }
  state.loading.value = true
  await state.raced.run(() => hvac.getStartupBatches(room), {
    ok: (found) => {
      state.current.value = found.current
      state.coverage.value = found.coverage
      state.isStale.value = found.is_stale
      state.sourceRange.value = found.source_range
      state.error.value = null
    },
    fail: (caught) => (state.error.value = describeError(caught)),
    settled: () => (state.loading.value = false),
  })
}

/**
 * 触发一次重算，成功即刻回读一次拿到 running 状态。
 *
 * ⚠ 时间窗由调用方给，**不许再拿上一批次的窗口顶上**：那样一来窗口会被第一次
 * 跑的取值永久钉死，用户改不动，界面上也看不出它从哪来。
 * ⚠ 没有当前批次照样要能跑——那正是「第一次抽取」这条路。
 * ⚠ 端点只入队（202），这里**不等它算完**：等的话页面会挂到超时。
 * @param state 批次状态
 * @param window 要抽的那一段
 */
async function rebuild(
  state: BatchesState,
  window: RebuildWindow,
): Promise<StartupRebuildResult | null> {
  state.rebuilding.value = true
  state.error.value = null
  try {
    const started = await hvac.rebuildStartupBatches(state.roomId(), window)
    await load(state)
    return started
  } catch (caught) {
    state.error.value = describeError(caught)
    return null
  } finally {
    state.rebuilding.value = false
  }
}
