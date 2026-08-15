/**
 * @fileoverview 契约：部件检查器把「这个节点名在当前模型里找不到」当场说出来。
 *
 * ⚠ 本包看不见模型：模型换了或节点改了名，部件就静默地什么都不再命中，
 * 界面上不标出来的话，用户看到的只是「配了但没反应」。
 * 另锁住：候选拿不到时不许把手填的名字判成缺失（那是「还不知道」不是「不存在」），
 * 以及两段式点击的语义必须写在旁边。
 */
import { normalizeTwinConfig } from '@dt/twin-config'
import type { TwinHierNode, TwinPart } from '@dt/twin-config'
import { DtSelect } from '@dt/ui'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import PartInspector from '@/pages/TwinEditor/components/inspector/PartInspector.vue'

function makePart(over: Record<string, unknown> = {}): TwinPart {
  const part = normalizeTwinConfig({
    parts: [{ id: 'p1', name: '主机', ...over }],
  }).parts[0]
  if (part === undefined) throw new Error('造不出部件')
  return part
}

function mountPart(
  modelValue: TwinPart = makePart(),
  nodeNames: readonly string[] = ['Cube', 'Pump_01'],
  picking = false,
  hierNodes: readonly TwinHierNode[] = [],
) {
  return mount(PartInspector, {
    props: { modelValue, nodeNames, picking, hierNodes },
  })
}

type Wrapper = ReturnType<typeof mountPart>

function lastPart(wrapper: Wrapper): TwinPart {
  const events = wrapper.emitted('update:modelValue')
  if (!events?.length) throw new Error('没有整份写回部件')
  return events[events.length - 1]?.[0] as TwinPart
}

function buttonByText(wrapper: Wrapper, text: string) {
  const found = wrapper.findAll('button').find((item) => item.text() === text)
  if (!found) throw new Error(`没有文案为「${text}」的按钮`)
  return found
}

async function typeNode(wrapper: Wrapper, name: string): Promise<void> {
  await wrapper.find('input[aria-label="手填名字"]').setValue(name)
  await wrapper.find('button[aria-label="添加名字"]').trigger('click')
}

describe('关联节点', () => {
  it('手填一个名字就追加进去', async () => {
    const wrapper = mountPart()

    await typeNode(wrapper, 'Pump_01')

    expect(lastPart(wrapper).nodes).toEqual(['Pump_01'])
  })

  it('已经有的名字不重复追加', async () => {
    const wrapper = mountPart(makePart({ nodes: ['Cube'] }))

    await typeNode(wrapper, 'Cube')

    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })

  it('从候选下拉里挑也能追加', async () => {
    const wrapper = mountPart()

    // 候选下拉的选项是运行时开合的浮层，这里直接从组件口子上给值
    wrapper.findComponent(DtSelect).vm.$emit('update:modelValue', 'Cube')
    await wrapper.vm.$nextTick()

    expect(lastPart(wrapper).nodes).toEqual(['Cube'])
  })

  it('删掉一条只删它自己', async () => {
    const wrapper = mountPart(makePart({ nodes: ['Cube', 'Pump_01'] }))

    await wrapper.find('button[aria-label="移除 Cube"]').trigger('click')

    expect(lastPart(wrapper).nodes).toEqual(['Pump_01'])
  })

  it('模型里没有的名字当场标出来', () => {
    const wrapper = mountPart(makePart({ nodes: ['Cube', 'Ghost'] }))

    expect(wrapper.text()).toContain('在当前模型里没找到')
  })

  it('模型还没加载时不判缺失——那是「还不知道」不是「不存在」', () => {
    const wrapper = mountPart(makePart({ nodes: ['Ghost'] }), [])

    expect(wrapper.text()).not.toContain('在当前模型里没找到')
    expect(wrapper.text()).toContain('模型还没加载')
  })
})

describe('从视口拾取', () => {
  it('点一下请求进入拾取模式', async () => {
    const wrapper = mountPart()

    await buttonByText(wrapper, '从视口拾取').trigger('click')

    expect(wrapper.emitted('requestPickNode')).toHaveLength(1)
  })

  it('拾取中再点是取消，不会重复请求', async () => {
    const wrapper = mountPart(makePart(), ['Cube'], true)

    await buttonByText(wrapper, '点视口里的模型…（取消）').trigger('click')

    expect(wrapper.emitted('cancelPick')).toHaveLength(1)
    expect(wrapper.emitted('requestPickNode')).toBeUndefined()
  })
})

describe('点击距离', () => {
  it('把两段式点击的语义写在旁边', () => {
    const wrapper = mountPart()

    expect(wrapper.text()).toContain('第一次点击只是把镜头拉近')
  })

  it('三条阈值各自可以整条不配', () => {
    const wrapper = mountPart()

    for (const label of [
      '近于此距离不响应',
      '远于此距离不响应',
      '两段式点击分界',
    ]) {
      expect(
        wrapper.find(`button[role="switch"][aria-label="${label}"]`).exists(),
      ).toBe(true)
    }
  })

  it('开一条阈值只动它自己，另外两条仍是「没配」', async () => {
    const wrapper = mountPart()

    await wrapper
      .find('button[role="switch"][aria-label="两段式点击分界"]')
      .trigger('click')

    const next = lastPart(wrapper)
    expect(next.clickDistance.farThreshold).not.toBeNull()
    expect(next.clickDistance.min).toBeNull()
    expect(next.clickDistance.max).toBeNull()
  })
})

describe('显隐', () => {
  it('用共用的显隐件，不自己再画一套', () => {
    const wrapper = mountPart()

    expect(wrapper.text()).toContain('初始可见')
    expect(wrapper.text()).toContain('距离规则只在大屏运行时生效')
  })

  it('改显隐回的是整份部件，节点原样带上', async () => {
    const part = makePart({ nodes: ['Cube'] })
    const wrapper = mountPart(part)

    await wrapper
      .find('button[role="switch"][aria-label="初始可见"]')
      .trigger('click')

    const next = lastPart(wrapper)
    expect(next.visibility.visible).toBe(false)
    expect(next.nodes).toEqual(['Cube'])
    expect(part.visibility.visible).toBe(true)
  })
})
