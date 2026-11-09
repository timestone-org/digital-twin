/**
 * @fileoverview 孪生编辑器里模型动画的选中、试播与「配置里有、模型里没有」的那几条。
 */
import type { TwinConfig } from '@dt/twin-config'
import type { ModelAnimationEntry } from '@dt/three-core'
import { computed, ref, watch, type ComputedRef, type Ref } from 'vue'

import { missingAnimationNames } from './missingAnimations'
import type { TwinSelection } from './types'

/** 动画检查器的试播档：跟配置走 / 临时播放 / 暂停 / 回到首帧。 */
export type TwinAnimationTestMode = 'live' | 'play' | 'pause' | 'reset'

export interface TwinAnimationSelection {
  /** 视口回传的模型装载状态。 */
  modelStatus: Ref<string>
  /** 视口回传的模型自带动画。 */
  animationClips: Ref<readonly ModelAnimationEntry[]>
  /** 左栏选中的动画名；null = 没选动画，右栏看实体。 */
  selectedAnimation: Ref<string | null>
  animationTest: Ref<TwinAnimationTestMode>
  currentAnimation: ComputedRef<ModelAnimationEntry | null>
  /** 配置里配了、当前模型里却没有的动画名。 */
  missingAnimations: ComputedRef<ReadonlySet<string>>
  selectAnimation: (name: string) => void
  /** 退出动画选中、试播回到跟配置走。 */
  resetAnimation: () => void
}

/**
 * 换模型时清掉旧剪辑；配置里的动画在模型里没了就退出选中。
 * @param config 当前草稿配置
 * @param state 要跟着改的那几份状态
 */
function followModel(
  config: () => TwinConfig | null,
  state: Pick<
    TwinAnimationSelection,
    'modelStatus' | 'animationClips' | 'selectedAnimation' | 'missingAnimations'
  >,
): void {
  // ⚠ 同步清：否则换模型那一拍缺失判定会拿旧模型的剪辑去比
  watch(
    [() => config()?.model.asset, () => config()?.model.variant],
    () => {
      state.modelStatus.value = 'loading'
      state.animationClips.value = []
    },
    { flush: 'sync' },
  )
  watch(state.missingAnimations, (missing) => {
    const selected = state.selectedAnimation.value
    if (selected !== null && missing.has(selected))
      state.selectedAnimation.value = null
  })
}

/**
 * 装上动画选中这一路。
 * @param config 当前草稿配置；还没读出来是 null
 * @param selection 当前大纲选中
 */
export function useTwinAnimationSelection(
  config: () => TwinConfig | null,
  selection: () => TwinSelection,
): TwinAnimationSelection {
  const modelStatus = ref('empty')
  const animationClips = ref<readonly ModelAnimationEntry[]>([])
  const selectedAnimation = ref<string | null>(null)
  const animationTest = ref<TwinAnimationTestMode>('live')
  const currentAnimation = computed(
    () =>
      animationClips.value.find(
        (item) => item.name === selectedAnimation.value,
      ) ?? null,
  )
  const missingAnimations = computed<ReadonlySet<string>>(() => {
    const current = config()
    return current === null
      ? new Set<string>()
      : missingAnimationNames(
          current.model.animations,
          animationClips.value,
          modelStatus.value,
        )
  })

  function resetAnimation(): void {
    selectedAnimation.value = null
    animationTest.value = 'live'
  }

  watch(selection, resetAnimation)
  followModel(config, {
    modelStatus,
    animationClips,
    selectedAnimation,
    missingAnimations,
  })

  return {
    modelStatus,
    animationClips,
    selectedAnimation,
    animationTest,
    currentAnimation,
    missingAnimations,
    selectAnimation: (name) => {
      selectedAnimation.value = name
      animationTest.value = 'live'
    },
    resetAnimation,
  }
}
