/**
 * @fileoverview 实时测试弹窗的三个动作：取当下工况、按屏幕上的条件推荐、
 * 以及打开时把两件事串起来。
 *
 * ⚠ 两条取数各自防竞态：连点「重新取数并推荐」时，慢的那次后返回会把上一次的
 * 读数与结果混在一起，而且不报任何错。
 */
import type { AcModel } from '@dt/contracts'
import { ERROR_CODES } from '@dt/contracts'

import * as hvac from '@/api/hvac'
import { useRacedFetch, type RacedFetch } from '@/composables/useRacedFetch'
import {
  draftFromUnits,
  isDraftEdited,
  toRecommendReadings,
} from '@/features/hvac/liveTest'
import { classifyProblem, type LiveState } from './liveTestState'

export function createLiveActions(
  model: () => AcModel | null,
  state: LiveState,
) {
  const readingsFetch = useRacedFetch()
  const recommendFetch = useRacedFetch()

  const recommend = (): Promise<void> =>
    runRecommend(model, state, recommendFetch)
  const loadReadings = (): Promise<void> =>
    runLoadReadings(model, state, readingsFetch, recommend)

  /** 取消勾选 = 丢弃全部改动，恢复实时值。 */
  function setTuning(on: boolean): void {
    state.isTuning.value = on
    if (on) return
    state.draft.value = draftFromUnits(state.readings.value?.units ?? [])
  }

  function start(): void {
    state.readings.value = null
    state.readingsProblem.value = null
    state.recommendProblem.value = null
    state.result.value = null
    state.draft.value = {}
    state.idleMinutes.value = undefined
    state.isTuning.value = false
    state.openedTrainedAt.value = model()?.trained_at ?? null
    void loadReadings()
  }

  return { loadReadings, recommend, setTuning, start }
}

/** 取当下工况；至少有一台读到了就顺手推荐。 */
async function runLoadReadings(
  model: () => AcModel | null,
  state: LiveState,
  fetcher: RacedFetch,
  recommend: () => Promise<void>,
): Promise<void> {
  const room = model()?.room.id
  if (room === undefined) return
  state.loadingReadings.value = true
  state.readingsProblem.value = null
  state.result.value = null
  state.recommendProblem.value = null
  await fetcher.run(() => hvac.getRoomLiveReadings(room), {
    ok: (got) => {
      state.readings.value = got
      state.draft.value = draftFromUnits(got.units)
      state.isTuning.value = false
      // 窗内一台都没读到时不自动推荐：给用户一次「仍要按未知条件试算」的选择
      if (got.units.some((unit) => unit.sampled_at !== null)) void recommend()
    },
    fail: (caught) => {
      state.readings.value = null
      state.draft.value = {}
      state.readingsProblem.value = classifyProblem(
        caught,
        ERROR_CODES.sourceUnavailable,
        'unavailable',
      )
    },
    settled: () => (state.loadingReadings.value = false),
  })
}

/** 拿屏幕上当前的条件推荐一次；不重新取数。 */
async function runRecommend(
  model: () => AcModel | null,
  state: LiveState,
  fetcher: RacedFetch,
): Promise<void> {
  const found = model()
  if (found === null) return
  const readings = toRecommendReadings(state.draft.value)
  const idle = state.idleMinutes.value
  const edited = isDraftEdited(
    state.draft.value,
    state.readings.value?.units ?? [],
  )
  state.recommending.value = true
  state.recommendProblem.value = null
  const body = {
    readings,
    ...(idle === undefined ? {} : { idle_minutes: idle }),
  }
  await fetcher.run(() => hvac.recommendWithAcModel(found.id, body), {
    ok: (got) => {
      state.result.value = got
      state.resultBlind.value = Object.keys(readings).length === 0
      state.resultEdited.value = edited
      state.appliedIdle.value = idle
    },
    fail: (caught) => {
      state.result.value = null
      state.recommendProblem.value = classifyProblem(
        caught,
        ERROR_CODES.modelConfigInvalid,
        'unknownUnits',
      )
    },
    settled: () => (state.recommending.value = false),
  })
}
