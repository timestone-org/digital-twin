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
import { DtSelect, DtSlider } from '@dt/ui'
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
    props: { modelValue, nodeNames, picking, hierNodes, tintBound: false },
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

  it('节点很多时清单限制高度并在内部滚动', () => {
    const nodes = Array.from({ length: 20 }, (_, index) => `Node_${index}`)
    const wrapper = mountPart(makePart({ nodes }), nodes)
    const list = wrapper.find('ul[aria-label="已选择的名字"]')

    expect(list.classes()).toContain('max-h-56')
    expect(list.classes()).toContain('overflow-y-auto')
    expect(list.classes()).toContain('overscroll-contain')
    expect(list.findAll('li')).toHaveLength(20)
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

  it('一个钻取节点都没有时给行内空态：单行、不带图标', () => {
    const wrapper = mountPart()

    const empty = wrapper
      .findAll('.dt-empty--inline')
      .find((item) => item.text().includes('还没有钻取节点'))
    if (!empty) throw new Error('没有钻取节点的行内空态')
    expect(empty.find('svg').exists()).toBe(false)
  })
})

describe('从视口拾取', () => {
  it('提示 Shift 可以连续点选或框选当前部件的节点', () => {
    const wrapper = mountPart()

    expect(wrapper.text()).toContain('按住 Shift 可在视口连续点选或框选节点')
  })

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

describe('外观与状态染色', () => {
  it('两段都摆出来，且各用共用的字段件', () => {
    const wrapper = mountPart()

    expect(wrapper.text()).toContain('不透明度')
    expect(wrapper.text()).toContain('按点位取色')
  })

  it('改不透明度回的是整份部件，节点与显隐原样带上', async () => {
    const part = makePart({ nodes: ['Cube'], visible: false })
    const wrapper = mountPart(part)

    wrapper
      .findAllComponents(DtSlider)
      .find((item) => item.props('label') === '不透明度')
      ?.vm.$emit('update:modelValue', 0.25)
    await wrapper.vm.$nextTick()

    const next = lastPart(wrapper)
    expect(next.look.opacity).toBe(0.25)
    expect(next.nodes).toEqual(['Cube'])
    expect(next.visibility.visible).toBe(false)
    expect(part.look.opacity).toBe(1)
  })

  it('打开状态染色回的是整份部件，外观原样带上', async () => {
    const wrapper = mountPart(makePart({ look: { opacity: 0.5 } }))

    await wrapper
      .find('button[role="switch"][aria-label="按点位取色"]')
      .trigger('click')

    const next = lastPart(wrapper)
    expect(next.tint).not.toBeNull()
    expect(next.look.opacity).toBe(0.5)
  })

  // ⚠ 没绑点位时染色永远只会是回落色，而那与「点位没通」表现完全一样
  it('把「有没有挑点位」透传给染色面板', () => {
    const tinted = makePart({ tint: { mode: 'stops' } })

    expect(mountPart(tinted).text()).toContain('还没挑点位')
  })
})
