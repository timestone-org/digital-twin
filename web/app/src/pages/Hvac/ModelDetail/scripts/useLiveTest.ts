/**
 * @fileoverview 实时测试弹窗的状态机：取当下工况 → 自动推荐 → 允许微调重算。
 *
 * ⚠ 打开即出结果，用户不用点第二次——这是这个弹窗存在的全部意义。
 * ⚠ 外库不可达时不拿旧数据顶上（后端 503，这里如实说读不到）。
 */
import { computed, onBeforeUnmount, ref } from 'vue'
import type { AcModel } from '@dt/contracts'

import {
  hasAnyReading,
  isDraftEdited,
  missingSetKeys,
  staleStats,
} from '@/features/hvac/liveTest'
import { createLiveActions } from './liveTestActions'
import { createLiveState, type LiveState } from './liveTestState'

/** 相对时间自己不会走，弹窗开着期间按这个间隔推一下参照时刻。 */
const TICK_MS = 30_000

/**
 * @param model 当前模型，null = 还没加载回来
 */
export function useLiveTest(model: () => AcModel | null) {
  const state = createLiveState()
  const clock = useLiveClock()
  const actions = createLiveActions(model, state)
  return {
    ...state,
    ...derive(model, state),
    now: clock.now,
    recommend: actions.recommend,
    /** 丢弃手动改动，重新拉 live-readings 再推荐。 */
    reload: actions.loadReadings,
    setTuning: actions.setTuning,
    start: (): void => {
      clock.start()
      actions.start()
    },
    stop: clock.stop,
  }
}

/** 30 秒推一次参照时刻。⚠ 关弹窗与卸载都要停，否则它会一直转。 */
function useLiveClock() {
  const now = ref(new Date())
  let timer: ReturnType<typeof setInterval> | null = null

  function stop(): void {
    if (timer === null) return
    clearInterval(timer)
    timer = null
  }

  onBeforeUnmount(stop)

  return {
    now,
    start: (): void => {
      stop()
      now.value = new Date()
      timer = setInterval(() => (now.value = new Date()), TICK_MS)
    },
    stop,
  }
}

function derive(model: () => AcModel | null, state: LiveState) {
  const units = computed(() => state.readings.value?.units ?? [])
  const stale = computed(() => staleStats(state.readings.value))
  const isEdited = computed(() => isDraftEdited(state.draft.value, units.value))
  return {
    units,
    isEdited,
    /** 屏幕上的条件与算出这份结果时用的不一样了，才谈得上「重算」。 */
    canRecompute: computed(
      () =>
        isEdited.value || state.idleMinutes.value !== state.appliedIdle.value,
    ),
    /** 房间一台机组都没绑：终止，指向台账页。 */
    hasNoUnits: computed(
      () => state.readings.value !== null && units.value.length === 0,
    ),
    /** 回看窗内一台都没读到。 */
    allMissing: computed(
      () =>
        units.value.length > 0 &&
        units.value.every((unit) => unit.sampled_at === null),
    ),
    missingCount: computed(
      () =>
        units.value.filter(
          (unit) => unit.sampled_at === null || !hasAnyReading(unit.readings),
        ).length,
    ),
    staleCount: computed(() => stale.value.count),
    staleMinutes: computed(() => Math.round(stale.value.minutes)),
    /** 工件里没有这些机组，后端跳过了它们——必须列出来。 */
    missingSets: computed(() => missingSetKeys(model(), state.result.value)),
    /** 弹窗开着的时候这个模型重训完了。 */
    isModelRetrained: computed(
      () =>
        state.openedTrainedAt.value !== null &&
        model()?.trained_at !== state.openedTrainedAt.value,
    ),
  }
}
