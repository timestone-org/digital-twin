/**
 * @fileoverview 供应商弹窗的行为契约。
 *
 * 守四条：校验不过不许发请求；新建把表单换算成入参发出去；编辑态密钥留空时
 * 请求体里**没有**那一格；「测试连接」在编辑态没填新密钥时走的是「按库里那把
 * 探」的端点，绝不把旧密钥拼进请求。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import type { LlmProvider } from '@dt/contracts'

import * as llm from '@/api/llmProviders'
import ProviderFormDialog from '@/pages/System/Models/components/ProviderFormDialog.vue'

function provider(over: Partial<LlmProvider> = {}): LlmProvider {
  return {
    id: 'p1',
    name: '百炼',
    base_url: 'https://endpoint/v1',
    api_key_hint: '…1234',
    is_enabled: true,
    extra_body: null,
    models: [
      { name: 'qwen-plus', kind: 'chat', has_vision: false, dimensions: null },
    ],
    notes: '',
    assigned_purposes: ['assistant.chat'],
    updated_by: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...over,
  }
}

function render(editing: LlmProvider | null = null) {
  return mount(ProviderFormDialog, {
    props: { modelValue: true, provider: editing },
    global: { stubs: { teleport: true } },
  })
}

/** 按标签找输入框。⚠ DtInput 的 label 与 input 靠 for/id 连着。 */
function inputOf(wrapper: ReturnType<typeof render>, label: string) {
  const labelled = wrapper
    .findAll('label')
    .find((node) => node.text().startsWith(label))
  const id = labelled?.attributes('for')
  return wrapper.find(`#${id}`)
}

async function clickButton(
  wrapper: ReturnType<typeof render>,
  text: string,
): Promise<void> {
  const button = wrapper
    .findAll('button')
    .find((node) => node.text().includes(text))
  await button?.trigger('click')
  await flushPromises()
}

enableAutoUnmount(afterEach)

beforeEach(() => {
  vi.spyOn(llm, 'createProvider').mockResolvedValue(provider())
  vi.spyOn(llm, 'updateProvider').mockResolvedValue(provider())
  vi.spyOn(llm, 'probeDraft').mockResolvedValue({
    is_ok: true,
    message: '端点可用，自报 2 个模型',
    model_names: ['qwen-plus', 'text-embedding-v3'],
  })
  vi.spyOn(llm, 'probeProvider').mockResolvedValue({
    is_ok: false,
    message: '端点拒绝了这把密钥',
    model_names: [],
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('供应商弹窗', () => {
  it('校验不过就不发请求，并把原因摆出来', async () => {
    const wrapper = render()
    await clickButton(wrapper, '保存')
    expect(llm.createProvider).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('请填供应商名称')
  })

  it('新建时把表单换算成入参发出去', async () => {
    const wrapper = render()
    await inputOf(wrapper, '名称').setValue('百炼')
    await inputOf(wrapper, '端点地址').setValue('https://endpoint/v1/')
    await inputOf(wrapper, 'API 密钥').setValue('sk-secret')
    await clickButton(wrapper, '加一行')
    await wrapper.find('input[placeholder="模型代号"]').setValue('qwen-plus')
    await clickButton(wrapper, '保存')
    expect(llm.createProvider).toHaveBeenCalledWith({
      name: '百炼',
      base_url: 'https://endpoint/v1/',
      api_key: 'sk-secret',
      is_enabled: true,
      extra_body: null,
      models: [
        {
          name: 'qwen-plus',
          kind: 'chat',
          has_vision: false,
          dimensions: null,
        },
      ],
      notes: '',
    })
    expect(wrapper.emitted('saved')).toEqual([['供应商已创建']])
    expect(wrapper.emitted('update:modelValue')).toEqual([[false]])
  })

  it('编辑态密钥留空时请求体里没有那一格', async () => {
    const wrapper = render(provider())
    await inputOf(wrapper, '名称').setValue('改名')
    await clickButton(wrapper, '保存')
    const [, body] = vi.mocked(llm.updateProvider).mock.calls[0] ?? []
    expect(body).toBeDefined()
    expect(body).not.toHaveProperty('api_key')
    expect(body?.name).toBe('改名')
  })

  it('编辑态提醒改动会影响指着它的用途', () => {
    const wrapper = render(provider())
    expect(wrapper.text()).toContain('1 个用途')
  })

  it('新建态的测试连接拿表单里的地址与密钥去探，并把自报的模型摆成可点的片', async () => {
    const wrapper = render()
    await inputOf(wrapper, '端点地址').setValue('https://endpoint/v1')
    await inputOf(wrapper, 'API 密钥').setValue('sk-secret')
    await clickButton(wrapper, '测试连接')
    expect(llm.probeDraft).toHaveBeenCalledWith({
      base_url: 'https://endpoint/v1',
      api_key: 'sk-secret',
    })
    expect(wrapper.text()).toContain('端点可用')
    await clickButton(wrapper, 'text-embedding-v3')
    // 名字带 embed 的按嵌入模型起，维数留给人填
    expect(wrapper.find('input[placeholder="向量维数"]').exists()).toBe(true)
  })

  it('编辑态没填新密钥时测试连接走库里那把，密钥不出门', async () => {
    const wrapper = render(provider())
    await clickButton(wrapper, '测试连接')
    expect(llm.probeProvider).toHaveBeenCalledWith('p1')
    expect(llm.probeDraft).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('拒绝了这把密钥')
  })
})
