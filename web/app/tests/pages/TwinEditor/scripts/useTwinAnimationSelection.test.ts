/** @fileoverview 动画选中：换实体即退出、换模型清剪辑、模型里没了的动画自动退出选中。 */
import { normalizeTwinConfig, type TwinConfig } from '@dt/twin-config'
import { describe, expect, it } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'

import { useTwinAnimationSelection } from '@/pages/TwinEditor/scripts/useTwinAnimationSelection'
import {
  TWIN_SELECT_MODEL,
  type TwinSelection,
} from '@/pages/TwinEditor/scripts/types'

const CLIP = { name: 'spin', duration: 1 }

function configWith(asset: string, clips: string[] = []): TwinConfig {
  return normalizeTwinConfig({
    model: {
      asset,
      animations: { controls: clips.map((clip) => ({ clip, mode: 'always' })) },
    },
  })
}

function setup(initial: TwinConfig = configWith('asset:a', ['spin'])) {
  const config = ref<TwinConfig | null>(initial)
  const selection = ref<TwinSelection>(TWIN_SELECT_MODEL)
  const scope = effectScope()
  const state = scope.run(() =>
    useTwinAnimationSelection(
      () => config.value,
      () => selection.value,
    ),
  )
  if (state === undefined) throw new Error('没装上')
  return { state, config, selection, scope }
}

describe('动画选中', () => {
  it('选中动画后试播回到跟配置走，换了大纲选中就退出', async () => {
    const { state, selection, scope } = setup()
    state.animationClips.value = [CLIP]
    state.selectAnimation('spin')
    state.animationTest.value = 'play'
    state.selectAnimation('spin')

    expect(state.animationTest.value).toBe('live')
    expect(state.currentAnimation.value).toEqual(CLIP)

    selection.value = { kind: 'parts', id: 'p1' }
    await nextTick()
    expect(state.selectedAnimation.value).toBeNull()
    scope.stop()
  })

  it('换模型时同步清掉旧剪辑并回到装载中', () => {
    const { state, config, scope } = setup()
    state.modelStatus.value = 'ready'
    state.animationClips.value = [CLIP]

    config.value = configWith('asset:b')

    expect(state.modelStatus.value).toBe('loading')
    expect(state.animationClips.value).toEqual([])
    scope.stop()
  })

  it('模型装好后配置里的动画不在模型里，就记为缺失并退出选中', async () => {
    const { state, scope } = setup()
    state.selectAnimation('spin')
    state.modelStatus.value = 'ready'
    state.animationClips.value = []
    await nextTick()

    expect([...state.missingAnimations.value]).toEqual(['spin'])
    expect(state.selectedAnimation.value).toBeNull()
    scope.stop()
  })
})
