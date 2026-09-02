/**
 * @fileoverview 供应商弹窗的行为契约。
 *
 * 守四条：校验不过不许发请求；新建把表单换算成入参发出去；编辑态密钥留空时
 * 请求体里**没有**那一格；「测试连接」在编辑态没填新密钥时走的是「按库里那把
 * 探」的端点，绝不把旧密钥拼进请求。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import type { LlmProvider, LlmProviderKind } from '@dt/contracts'

import { DtSelect } from '@dt/ui'

import * as llm from '@/api/llmProviders'
import ProviderFormDialog from '@/pages/System/Models/components/ProviderFormDialog.vue'

function provider(over: Partial<LlmProvider> = {}): LlmProvider {
  return {
    id: 'p1',
    name: '百炼',
    kind: 'openai_compat',
    base_url: 'https://endpoint/v1',
    api_key_hint: '…1234',
    is_enabled: true,
    extra_body: null,
    options: null,
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

/** 后端下发的形态清单：表单按它摆格子。 */
const KINDS: LlmProviderKind[] = [
  {
    code: 'openai_compat',
    label: 'OpenAI 兼容端点',
    description: '填端点与密钥',
    is_endpoint_required: true,
    is_login_required: false,
    model_kinds: ['chat', 'embedding'],
    consumers: ['assistant', 'knowledge'],
    efforts: [],
    presets: [
      {
        code: 'dashscope',
        label: '阿里云百炼',
        base_url: 'https://dashscope.example/v1',
      },
    ],
  },
  {
    code: 'codex_oauth',
    label: 'Codex 订阅',
    description: '登录一次',
    is_endpoint_required: false,
    is_login_required: true,
    model_kinds: ['chat'],
    consumers: ['assistant'],
    efforts: ['low', 'medium', 'high', 'xhigh'],
    presets: [],
  },
]

function render(editing: LlmProvider | null = null) {
  return mount(ProviderFormDialog, {
    props: { modelValue: true, provider: editing, kinds: KINDS },
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
      kind: 'openai_compat',
      base_url: 'https://endpoint/v1/',
      api_key: 'sk-secret',
      is_enabled: true,
      extra_body: null,
      options: null,
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

describe('按类型摆格子', () => {
  /** 把类型下拉切到某一档。⚠ 打的是 DtSelect 的口子，不是原生 select。 */
  async function pickKind(
    wrapper: ReturnType<typeof render>,
    code: string,
  ): Promise<void> {
    const found = wrapper.findAllComponents(DtSelect)[0]
    found?.vm.$emit('update:modelValue', code)
    await flushPromises()
  }

  it('端点那一类摆地址、密钥与测试连接', () => {
    const wrapper = render()
    expect(inputOf(wrapper, '端点地址').exists()).toBe(true)
    expect(inputOf(wrapper, 'API 密钥').exists()).toBe(true)
    expect(wrapper.text()).toContain('测试连接')
    expect(wrapper.text()).not.toContain('默认推理档位')
  })

  it('订阅那一类整格不摆端点与密钥，改摆推理档位', async () => {
    // ⚠ 摆出来的话人会填、填了后端当场拒，而那句话指不回是哪一格多余
    const wrapper = render()
    await pickKind(wrapper, 'codex_oauth')
    expect(inputOf(wrapper, '端点地址').exists()).toBe(false)
    expect(inputOf(wrapper, 'API 密钥').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('测试连接')
    expect(wrapper.text()).toContain('默认推理档位')
  })

  it('预设点一下填上地址', async () => {
    const wrapper = render()
    await clickButton(wrapper, '阿里云百炼')
    expect(
      (inputOf(wrapper, '端点地址').element as HTMLInputElement).value,
    ).toBe('https://dashscope.example/v1')
  })

  it('换类型时把上一类填的东西清掉', async () => {
    // ⚠ 留着的话，切回去会看到一份属于另一类的残留，而保存时后端拒
    const wrapper = render()
    await inputOf(wrapper, '端点地址').setValue('https://someone/v1')
    await pickKind(wrapper, 'codex_oauth')
    await pickKind(wrapper, 'openai_compat')
    expect(
      (inputOf(wrapper, '端点地址').element as HTMLInputElement).value,
    ).toBe('')
  })

  it('编辑态只报类型，不给改', () => {
    const wrapper = render(provider({ kind: 'codex_oauth' }))
    expect(wrapper.text()).toContain('类型：Codex 订阅')
    expect(wrapper.text()).not.toContain('供应商类型')
  })
})
