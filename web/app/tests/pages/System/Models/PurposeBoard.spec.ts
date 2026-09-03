/**
 * @fileoverview 用途分配板的行为契约。
 *
 * 守两条：供应商下拉只列**登记了配得上这个用途的模型**的那几路（嵌入用途不许
 * 挑到只有对话模型的一路，看图用途不许挑到不接图的），以及没分配时要写清是
 * 「沿用环境变量」而不是「没接」。
 */
import { nextTick } from 'vue'
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import type { LlmProvider, LlmPurpose } from '@dt/contracts'
import { DtSelect } from '@dt/ui'

import PurposeBoard from '@/pages/System/Models/components/PurposeBoard.vue'

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
      { name: 'qwen-vl', kind: 'chat', has_vision: true, dimensions: null },
    ],
    notes: '',
    assigned_purposes: [],
    updated_by: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...over,
  }
}

function purpose(over: Partial<LlmPurpose> = {}): LlmPurpose {
  return {
    purpose: 'assistant.chat',
    label: '对话',
    description: '助手每一轮对话走的模型',
    kind: 'chat',
    consumer: 'assistant',
    is_vision_required: false,
    has_env_default: true,
    provider_id: null,
    provider_name: null,
    model_name: null,
    updated_at: null,
    ...over,
  }
}

const EMBEDDING_ONLY = provider({
  id: 'p2',
  name: '只有嵌入',
  models: [
    { name: 'embed-1', kind: 'embedding', has_vision: false, dimensions: 1024 },
  ],
})

function render(
  purposes: LlmPurpose[],
  providers: LlmProvider[],
  canManage = true,
) {
  return mount(PurposeBoard, {
    props: { purposes, providers, canManage },
    global: { stubs: { teleport: true } },
  })
}

/** DtSelect 实例上用例要碰的那几格。⚠ `.vue` 在 typescript-eslint 眼里是 any，
 * 先按形状收窄再用，别让 any 一路流进断言。 */
interface SelectLike {
  $emit: (event: 'update:modelValue', value: string) => void
  modelValue: string
  options: readonly { value: string }[]
}

function isSelectLike(value: unknown): value is SelectLike {
  return (
    typeof value === 'object' &&
    value !== null &&
    '$emit' in value &&
    'options' in value
  )
}

/** 某一行里第几个 DtSelect。 */
function selectAt(
  scope: { findAllComponents: (definition: typeof DtSelect) => unknown[] },
  index: number,
): SelectLike {
  const found: unknown = scope.findAllComponents(DtSelect)[index]
  const vm: unknown =
    typeof found === 'object' && found !== null && 'vm' in found
      ? found.vm
      : undefined
  if (!isSelectLike(vm)) throw new Error(`第 ${index + 1} 个下拉不存在`)
  return vm
}

describe('用途分配板', () => {
  it('没分配的用途写清是沿用环境变量', () => {
    const wrapper = render([purpose()], [provider()])
    expect(wrapper.text()).toContain('沿用该服务环境变量里的配置')
  })

  it('分配了的用途写出当前走的哪一路哪个模型', () => {
    const wrapper = render(
      [
        purpose({
          provider_id: 'p1',
          provider_name: '百炼',
          model_name: 'qwen-plus',
        }),
      ],
      [provider()],
    )
    expect(wrapper.text()).toContain('当前：百炼 / qwen-plus')
  })

  it('按消费方分组，两组各自有标题', () => {
    const wrapper = render(
      [
        purpose(),
        purpose({
          purpose: 'knowledge.embedding',
          label: '文档嵌入',
          kind: 'embedding',
          consumer: 'knowledge',
        }),
      ],
      [provider(), EMBEDDING_ONLY],
    )
    expect(wrapper.text()).toContain('AI 助手')
    expect(wrapper.text()).toContain('知识库')
  })

  it('只读账号看不到任何下拉与按钮，但看得见当前分配', () => {
    const wrapper = render([purpose()], [provider()], false)
    expect(wrapper.find('button').exists()).toBe(false)
    expect(wrapper.findAllComponents(DtSelect)).toHaveLength(0)
    expect(wrapper.text()).toContain('沿用该服务环境变量里的配置')
  })

  it('选好供应商与模型再点保存，抛出的正是那一组', async () => {
    const wrapper = render([purpose()], [provider()])
    const row = wrapper.find('[data-purpose="assistant.chat"]')
    // DtSelect 对外是 update:modelValue；直接从组件实例上触发，绕开下拉的
    // 定位与动画——这里守的是「抛出去的是什么」，不是下拉怎么开
    selectAt(row, 0).$emit('update:modelValue', 'p1')
    await nextTick()
    selectAt(row, 1).$emit('update:modelValue', 'qwen-vl')
    await nextTick()
    const save = row.findAll('button').find((one) => one.text() === '保存')
    expect(save?.attributes('disabled')).toBeUndefined()
    await save?.trigger('click')
    expect(wrapper.emitted('assign')).toEqual([
      ['assistant.chat', 'p1', 'qwen-vl'],
    ])
  })

  it('只有一个配得上的模型时选了供应商就自动选中它', async () => {
    const wrapper = render(
      [purpose({ is_vision_required: true, purpose: 'assistant.vision' })],
      [provider()],
    )
    const row = wrapper.find('[data-purpose="assistant.vision"]')
    selectAt(row, 0).$emit('update:modelValue', 'p1')
    await nextTick()
    // 接图的只有 qwen-vl 一个
    expect(selectAt(row, 1).modelValue).toBe('qwen-vl')
  })

  it('嵌入用途的供应商下拉里没有只登记了对话模型的那一路', () => {
    const wrapper = render(
      [purpose({ purpose: 'knowledge.embedding', kind: 'embedding' })],
      [provider(), EMBEDDING_ONLY],
    )
    const row = wrapper.find('[data-purpose="knowledge.embedding"]')
    const options = selectAt(row, 0).options
    expect(options.map((one) => one.value)).toEqual(['p2'])
  })

  it('清除只在有分配时出现，点了抛用途码', async () => {
    const wrapper = render(
      [
        purpose({
          provider_id: 'p1',
          provider_name: '百炼',
          model_name: 'qwen-plus',
        }),
      ],
      [provider()],
    )
    const clear = wrapper.findAll('button').find((one) => one.text() === '清除')
    await clear?.trigger('click')
    expect(wrapper.emitted('clear')).toEqual([['assistant.chat']])
  })

  it('重排那一档带自己的标签，且不许说「沿用环境变量」', () => {
    // ⚠ 这一路只有目录一个来源：照着「沿用环境变量」去翻一个不存在的配置项，
    // 比不说更费时间
    const wrapper = render(
      [
        purpose({
          purpose: 'knowledge.rerank',
          label: '检索重排',
          kind: 'rerank',
          consumer: 'knowledge',
          has_env_default: false,
        }),
      ],
      [],
    )
    expect(wrapper.text()).toContain('重排')
    expect(wrapper.text()).toContain('这套部署不启用这一路')
    expect(wrapper.text()).not.toContain('沿用该服务环境变量')
  })
})
