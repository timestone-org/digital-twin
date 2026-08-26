/**
 * @fileoverview 契约：面板上那个「用哪一路模型」的下拉。
 *
 * 守三条：只接了一路时整个不渲染（一个只有一项的下拉纯属占地方）、
 * 配了却没登录的那一路要**摆出来但选不了**（整个藏掉的话，部署方会以为配置
 * 没生效）、换路时把档位清掉（各路的档位取值不通用）。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import type { AssistantModelProfile, DtSelectOption } from '@dt/contracts'

import { DtSelect } from '@dt/ui'

import AiModelPicker from '@/components/ai/AiModelPicker.vue'

function profile(
  overrides: Partial<AssistantModelProfile> = {},
): AssistantModelProfile {
  return {
    id: 'default',
    label: '按量计费端点',
    is_ready: true,
    has_vision: true,
    models: ['some-model'],
    efforts: [],
    ...overrides,
  }
}

const CODEX = profile({
  id: 'codex',
  label: '订阅账号',
  has_vision: false,
  models: ['some-codex'],
  efforts: ['low', 'medium', 'high'],
})

function picker(models: AssistantModelProfile[], profileId = 'default') {
  return mount(AiModelPicker, {
    props: { models, choice: { profile: profileId, effort: '' } },
  })
}

describe('模型下拉', () => {
  it('只接了一路时整个不渲染', () => {
    expect(picker([profile()]).find('.ai-model').exists()).toBe(false)
  })

  it('接了两路时摆出来', () => {
    expect(picker([profile(), CODEX]).find('.ai-model').exists()).toBe(true)
  })

  it('没登录的那一路摆着但选不了', () => {
    // 整个藏掉的话，部署方配好了却在界面上找不到它，会以为配置没生效；
    // 摆成可选的话，点下去收到的是一条「模型暂时不可用」
    const wrapper = picker([profile(), { ...CODEX, is_ready: false }])
    const select = wrapper.findAllComponents(DtSelect)[0]
    const options: readonly DtSelectOption[] = select?.props('options') ?? []
    const codex = options.find((one) => one.value === 'codex')
    expect(codex?.disabled).toBe(true)
    expect(codex?.label).toContain('未登录')
  })

  it('选中带档位的那一路时多出一个档位下拉', () => {
    const one = picker([profile(), CODEX], 'default')
    expect(one.findAllComponents(DtSelect)).toHaveLength(1)
    const two = picker([profile(), CODEX], 'codex')
    expect(two.findAllComponents(DtSelect)).toHaveLength(2)
  })

  it('换路时把档位一起清掉', async () => {
    // 各路的档位取值不通用，带过去的那个多半不认识
    const wrapper = picker([profile(), CODEX], 'codex')
    const select = wrapper.findAllComponents(DtSelect)[0]
    select?.vm.$emit('update:modelValue', 'default')
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('pick')?.[0]).toEqual([
      { profile: 'default', effort: '' },
    ])
  })
})
