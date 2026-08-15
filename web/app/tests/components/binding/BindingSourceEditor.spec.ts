/**
 * @fileoverview 契约：一条绑定按来源种类要填的那几项。
 * ⚠ 常量的 `0` / `false` / `''` 都是合法取值：清空输入写的是 `null`（= 没配过），
 * 把 falsy 当成「没配」会让一整屏的零值消失。
 */
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import type { BindingPayload, BindingSpec } from '@dt/contracts'
import { DtSelect } from '@dt/ui'

import BindingSourceEditor from '@/components/binding/BindingSourceEditor.vue'

function binding(over: Partial<BindingPayload> = {}): BindingPayload {
  return {
    id: 'b1',
    nodeId: 'n1',
    fieldKey: 'value',
    sourceKind: 'static',
    nodeKey: null,
    staticValueJson: null,
    computeJson: null,
    detailJson: null,
    transformJson: null,
    createdAt: '',
    updatedAt: '',
    ...over,
  }
}

function spec(dataType: BindingSpec['dataType']): BindingSpec {
  return { key: 'value', label: '数值', dataType }
}

function mountEditor(
  current: BindingPayload,
  dataType: BindingSpec['dataType'] = 'string',
  siblingKeys: string[] = [],
) {
  return mount(BindingSourceEditor, {
    props: { spec: spec(dataType), binding: current, siblingKeys },
  })
}

/** 最后一次写回去的绑定。 */
function written(wrapper: ReturnType<typeof mountEditor>): BindingPayload {
  const events = wrapper.emitted('write') ?? []
  return (events.at(-1)?.[0] ?? binding()) as BindingPayload
}

describe('实时点位', () => {
  it('还没挑点时说清楚，挑点键抛 pick', async () => {
    const wrapper = mountEditor(binding({ sourceKind: 'opcua' }))

    expect(wrapper.text()).toContain('还没挑点位')
    await wrapper
      .findAll('button')
      .find((item) => item.text().includes('挑点位'))
      ?.trigger('click')

    expect(wrapper.emitted('pick')).toHaveLength(1)
  })

  it('挑过点之后把点位身份显示出来', () => {
    const wrapper = mountEditor(
      binding({ sourceKind: 'opcua', nodeKey: 's1:temp' }),
    )

    expect(wrapper.text()).toContain('s1:temp')
  })
})

describe('常量', () => {
  it('数值槽用数字输入，写回去的是数', async () => {
    const wrapper = mountEditor(binding(), 'number')

    await wrapper.find('.dt-number__el').setValue('12')

    expect(written(wrapper).staticValueJson).toBe(12)
  })

  it('清空数值写回 null，而不是 0', async () => {
    const wrapper = mountEditor(binding({ staticValueJson: 12 }), 'number')

    await wrapper.find('.dt-number__el').setValue('')

    expect(written(wrapper).staticValueJson).toBeNull()
  })

  it('布尔槽用开关，关掉写回 false 而不是没配', async () => {
    const wrapper = mountEditor(binding({ staticValueJson: true }), 'boolean')

    await wrapper.find('button[role="switch"]').trigger('click')

    expect(written(wrapper).staticValueJson).toBe(false)
  })

  it('文本槽写回字符串，空串也是合法取值', async () => {
    const wrapper = mountEditor(binding({ staticValueJson: '甲' }))

    await wrapper.find('.dt-input__el').setValue('')

    expect(written(wrapper).staticValueJson).toBe('')
  })
})

describe('派生', () => {
  it('挑运算符时保留已选的输入', async () => {
    const wrapper = mountEditor(
      binding({
        sourceKind: 'computed',
        computeJson: { op: 'sum', inputs: ['a'] },
      }),
      'number',
      ['a', 'b'],
    )

    wrapper.findComponent(DtSelect).vm.$emit('update:modelValue', 'avg')
    await wrapper.vm.$nextTick()

    expect(written(wrapper).computeJson).toEqual({ op: 'avg', inputs: ['a'] })
  })

  it('认不出的运算符不写回去', async () => {
    const wrapper = mountEditor(
      binding({
        sourceKind: 'computed',
        computeJson: { op: 'sum', inputs: [] },
      }),
      'number',
    )

    wrapper.findComponent(DtSelect).vm.$emit('update:modelValue', 'nope')
    await wrapper.vm.$nextTick()

    expect(wrapper.emitted('write')).toBeUndefined()
  })

  it('勾一个同级槽把它加进输入，取消勾选就移出去', async () => {
    const wrapper = mountEditor(
      binding({
        sourceKind: 'computed',
        computeJson: { op: 'sum', inputs: [] },
      }),
      'number',
      ['a', 'b'],
    )
    const boxes = wrapper.findAll('input[type="checkbox"]')

    await boxes[0]?.setValue(true)
    expect(written(wrapper).computeJson?.inputs).toEqual(['a'])

    await wrapper.setProps({
      binding: binding({
        sourceKind: 'computed',
        computeJson: { op: 'sum', inputs: ['a'] },
      }),
    })
    await wrapper.findAll('input[type="checkbox"]')[0]?.setValue(false)

    expect(written(wrapper).computeJson?.inputs).toEqual([])
  })
})

describe('历史序列', () => {
  it('改相对窗时把点位身份一起带上，不把它丢掉', async () => {
    const wrapper = mountEditor(
      binding({
        sourceKind: 'archive',
        detailJson: { nodeKey: 's1:temp', range: { lastWindow: '1h' } },
      }),
    )

    await wrapper.find('.dt-input__el').setValue('7d')

    expect(written(wrapper).detailJson).toEqual({
      nodeKey: 's1:temp',
      range: { lastWindow: '7d' },
    })
  })

  it('还没挑点时挑点键照样抛 pick', async () => {
    const wrapper = mountEditor(binding({ sourceKind: 'archive' }))

    expect(wrapper.text()).toContain('还没挑点位')
    await wrapper
      .findAll('button')
      .find((item) => item.text().includes('挑点位'))
      ?.trigger('click')

    expect(wrapper.emitted('pick')).toHaveLength(1)
  })
})
