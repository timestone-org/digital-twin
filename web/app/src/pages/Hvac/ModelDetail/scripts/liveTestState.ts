/**
 * @fileoverview 实时测试弹窗持有的那一份状态，与「出错该归成哪一类」。
 *
 * ⚠ 错误一律按信封里的 `code` 分类，不按 message：message 是给人看的，
 * 随时会改，按它分支等于把界面行为绑在一句文案上。
 */
import { ref } from 'vue'
import type { ModelRecommendResult, RoomLiveReadings } from '@dt/contracts'

import { BizError } from '@/api/client'
import { describeError } from '@/composables/useAsyncList'
import type { ReadingDraft } from '@/features/hvac/liveTest'

/** 出错的分类：呈现与可继续与否按它分支。 */
export type LiveProblemKind = 'unavailable' | 'unknownUnits' | 'other'

export interface LiveProblem {
  kind: LiveProblemKind
  message: string
}

export function createLiveState() {
  return {
    loadingReadings: ref(false),
    recommending: ref(false),
    readings: ref<RoomLiveReadings | null>(null),
    readingsProblem: ref<LiveProblem | null>(null),
    recommendProblem: ref<LiveProblem | null>(null),
    result: ref<ModelRecommendResult | null>(null),
    draft: ref<ReadingDraft>({}),
    idleMinutes: ref<number | undefined>(undefined),
    isTuning: ref(false),
    /** 这一份结果是在完全没有读数的情况下算的。 */
    resultBlind: ref(false),
    /** 这一份结果算的时候读数已被手动改过。 */
    resultEdited: ref(false),
    /** 算这一份结果时用的全停时长，用来判断「还要不要重算」。 */
    appliedIdle: ref<number | undefined>(undefined),
    /** 打开弹窗那一刻的训练时刻，用来发现「开着的时候重训完了」。 */
    openedTrainedAt: ref<string | null>(null),
  }
}

export type LiveState = ReturnType<typeof createLiveState>

/**
 * 把一个异常归成某一类。
 * @param caught 抓到的异常
 * @param code 命中这个业务码就算 `kind`，否则算 `other`
 * @param kind 命中时的分类
 */
export function classifyProblem(
  caught: unknown,
  code: number,
  kind: LiveProblemKind,
): LiveProblem {
  const message = describeError(caught)
  if (caught instanceof BizError && caught.code === code) {
    return { kind, message }
  }
  return { kind: 'other', message }
}
