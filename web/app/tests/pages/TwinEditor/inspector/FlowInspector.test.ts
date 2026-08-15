/**
 * @fileoverview 契约：能量流检查器的种类是「配色 token」不是枚举。
 *
 * 空串 = 缺省色要在下拉里有位置；落库里认不出的自定义种类必须原样留着，
 * 否则一改别的字段就把它抹成缺省色。路径交给 AnchorPathField，写回整份。
 */
import type { DtSelectOption } from '@dt/contracts'
import {
  ALWAYS_VISIBLE,
  type TwinAnchor,
  type TwinFlowLink,
} from '@dt/twin-config'
import { DtSelect, DtSwitch } from '@dt/ui'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import AnchorPathField from '@/pages/TwinEditor/components/fields/AnchorPathField.vue'
import FlowInspector from '@/pages/TwinEditor/components/inspector/FlowInspector.vue'

const ANCHORS: TwinAnchor[] = ['a1', 'a2'].map((id, index) => ({
  id,
  name: `锚点${index + 1}`,
  position: [0, 0, 0],
  label: '',
  unit: '',
  decimals: null,
  visibility: ALWAYS_VISIBLE,
}))

function flowOf(over: Partial<TwinFlowLink> = {}): TwinFlowLink {
  return {
    id: 'fl1',
    name: '冷冻水',
    kind: 'water',
    pathAnchors: ['a1', 'a2'],
    width: 1,
    reversible: false,
    visibility: ALWAYS_VISIBLE,
    ...over,
  }
}

function mountInspector(flow: TwinFlowLink) {
  return mount(FlowInspector, {
    props: { modelValue: flow, anchors: ANCHORS },
  })
}

type Wrapper = ReturnType<typeof mountInspector>

function written(wrapper: Wrapper): TwinFlowLink {
  const events = wrapper.emitted('update:modelValue')
  if (!events?.[0]) throw new Error('没有写回能量流')
  return events[0][0] as TwinFlowLink
}

function kindSelect(wrapper: Wrapper) {
  const found = wrapper
    .findAllComponents(DtSelect)
    .find((item) => item.props('ariaLabel') === '能源种类')
  if (!found) throw new Error('未找到能源种类下拉')
  return found
}

function kindValues(wrapper: Wrapper): string[] {
  // 标上类型再用：`.vue` 的 props 在 eslint 眼里是 any，链式调用会被判为不安全调用
  const options: readonly DtSelectOption[] =
    kindSelect(wrapper).props('options')
  return options.map((option) => option.value)
}

describe('能源种类', () => {
  it('空串是一档：不指定就用缺省色', () => {
    const wrapper = mountInspector(flowOf({ kind: '' }))

    expect(kindValues(wrapper)).toContain('')
    expect(wrapper.text()).toContain('缺省色')
  })

  it('渲染层认得的几种都列出来', () => {
    const values = kindValues(mountInspector(flowOf()))

    expect(values).toContain('water')
    expect(values).toContain('steam')
    expect(values).toContain('electricity')
  })

  it('认不出的自定义种类原样列出来，不被归成缺省色', () => {
    const wrapper = mountInspector(flowOf({ kind: 'brine' }))

    expect(kindValues(wrapper)).toContain('brine')
    expect(wrapper.text()).toContain('自定义：brine')
  })

  it('改种类只换 kind', async () => {
    const wrapper = mountInspector(flowOf())
    await kindSelect(wrapper).setValue('steam')

    const next = written(wrapper)
    expect(next.kind).toBe('steam')
    expect(next.pathAnchors).toEqual(['a1', 'a2'])
  })
})

describe('路径与反向', () => {
  it('路径交给 AnchorPathField，写回的是整份 pathAnchors', () => {
    const flow = flowOf()
    const wrapper = mountInspector(flow)
    wrapper
      .findComponent(AnchorPathField)
      .vm.$emit('update:modelValue', ['a2', 'a1'])

    expect(written(wrapper).pathAnchors).toEqual(['a2', 'a1'])
    expect(flow.pathAnchors).toEqual(['a1', 'a2'])
  })

  it('不足两点的提示由路径件给出，检查器里看得见', () => {
    const wrapper = mountInspector(flowOf({ pathAnchors: ['a1'] }))

    expect(wrapper.text()).toContain('画不出来')
  })

  it('反向开关写回布尔', async () => {
    const wrapper = mountInspector(flowOf())
    const toggle = wrapper
      .findAllComponents(DtSwitch)
      .find((item) => item.props('ariaLabel') === '允许负强度反向流动')
    if (!toggle) throw new Error('未找到反向开关')
    await toggle.setValue(true)

    expect(written(wrapper).reversible).toBe(true)
  })

  it('改名字不动原对象', async () => {
    const flow = flowOf()
    const wrapper = mountInspector(flow)
    await wrapper.find('input[aria-label="名称"]').setValue('冷却水')

    expect(written(wrapper).name).toBe('冷却水')
    expect(flow.name).toBe('冷冻水')
  })
})
