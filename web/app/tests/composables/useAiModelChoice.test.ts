/**
 * @fileoverview 面板上那个「用哪一路模型」的下拉背后的一格状态。
 *
 * 守的是一件运行期没有任何迹象的事：会话行上存的档位名可能已经不在册了
 * （一路供应商删了、或环境变量那一路让位给目录里配的那一路）。不退回默认的话，
 * 下拉是空的、而回合照常按服务端退回的第一路发出去——差异只出现在账单上。
 */
import { describe, expect, it } from 'vitest'
import { ref } from 'vue'
import type { AssistantCapability, AssistantModelProfile } from '@dt/contracts'

import {
  keepInRange,
  newModelChoice,
  pickModel,
} from '@/composables/useAiModelChoice'

function profile(id: string): AssistantModelProfile {
  return {
    id,
    label: id,
    is_ready: true,
    has_vision: false,
    models: [],
    efforts: [],
  }
}

function capability(ids: string[], fallback: string): AssistantCapability {
  return {
    is_model_enabled: true,
    skills: [],
    models: ids.map(profile),
    default_model_id: fallback,
    attachment_suffixes: [],
    default_effort: 'medium',
  }
}

describe('会话行上那一路不在册时', () => {
  it('尚未建会话时可更新选择，明确作废的选择不写入', async () => {
    const choice = ref({ profile: 'default', effort: '' })
    const session = ref<string | null>(null)
    expect(
      await pickModel({ profile: 'codex', effort: 'high' }, choice, session),
    ).toBe(true)
    expect(choice.value.profile).toBe('codex')
    expect(
      await pickModel(
        { profile: 'old', effort: '' },
        choice,
        session,
        () => false,
      ),
    ).toBe(false)
    expect(choice.value.profile).toBe('codex')
  })

  it('退回部署报的默认', () => {
    const choice = ref({ profile: 'codex', effort: 'high' })
    keepInRange(choice, capability(['p1', 'p2'], 'p2'))
    expect(choice.value).toEqual({ profile: 'p2', effort: 'medium' })
  })

  it('在册就一格不动', () => {
    const choice = ref({ profile: 'p1', effort: 'high' })
    keepInRange(choice, capability(['p1', 'p2'], 'p2'))
    expect(choice.value).toEqual({ profile: 'p1', effort: 'high' })
  })

  it('还没选过时不管', () => {
    const choice = newModelChoice()
    keepInRange(choice, capability(['p1'], 'p1'))
    expect(choice.value.profile).toBe('')
  })

  it('探不到能力时不动它', () => {
    // ⚠ 探不到 ≠ 那一路没了：助手临时不可达时把用户选的那一路抹掉，
    // 等于每次抖动都换一次模型
    const choice = ref({ profile: 'codex', effort: '' })
    keepInRange(choice, null)
    expect(choice.value.profile).toBe('codex')
  })
})
