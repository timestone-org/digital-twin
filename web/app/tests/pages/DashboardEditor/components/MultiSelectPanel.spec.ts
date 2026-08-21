/**
 * @fileoverview 契约：多选面板报出已选数量与按类型清单，对齐 / 分布 / 显隐 /
 * 统一尺寸 / 批量删除各抛各的事件；同类型才出批量表单，混合类型给「只选这一类」；
 * 条件不满足的那几档**渲染但禁用**，藏起来会让人以为功能不存在。
 */
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent } from 'vue'
import type { DashboardNodePayload, ModuleManifest } from '@dt/contracts'

import MultiSelectPanel from '@/pages/DashboardEditor/components/MultiSelectPanel.vue'

// 批量表单的行为在 BatchConfigForm.spec 里守，这里用带 emits 的桩验转发
const BatchFormStub = defineComponent({
  name: 'BatchConfigForm',
  emits: ['config', 'preset'],
  template: '<div data-test="batch-form" />',
})

const DEMO: ModuleManifest = {
  type: 'demo',
  displayName: '演示模块',
  category: '演示',
  defaultSize: { width: 100, height: 80 },
  configSchema: [],
  bindings: [],
  component: () => Promise.resolve({ default: {} }),
}

/** 面板只读 id / moduleType，其余字段给占位值让载荷成型。 */
function fakeNode(index: number, moduleType = 'demo'): DashboardNodePayload {
  return {
    id: `n${index + 1}`,
    dashboardId: 'd1',
    parentId: null,
    clientKey: null,
    moduleType,
    x: 0,
    y: 0,
    w: 100,
    h: 80,
    zIndex: index,
    isVisible: true,
    configJson: {},
    createdAt: '',
    updatedAt: '',
    bindings: [],
  }
}

function mountPanel(
  over: Partial<{
    count: number
    nodes: DashboardNodePayload[]
    alignReady: boolean
    distributeReady: boolean
  }> = {},
) {
  const nodes =
    over.nodes ??
    Array.from({ length: over.count ?? 3 }, (_none, index) => fakeNode(index))
  return mount(MultiSelectPanel, {
    props: {
      selectedNodes: nodes,
      primary: nodes[nodes.length - 1] ?? null,
      getManifest: (type: string) => (type === 'demo' ? DEMO : undefined),
      alignReady: over.alignReady ?? true,
      distributeReady: over.distributeReady ?? true,
    },
    global: { stubs: { BatchConfigForm: BatchFormStub } },
  })
}

describe('多选面板', () => {
  it('报出已选数量', () => {
    expect(
      mountPanel({ count: 5 }).find('[data-test="multi-count"]').text(),
    ).toContain('5')
  })

  it('六个方向各抛自己的那一档', async () => {
    const wrapper = mountPanel()
    const kinds = ['left', 'hcenter', 'right', 'top', 'vcenter', 'bottom']

    for (const kind of kinds) {
      await wrapper.find(`[data-test="multi-align-${kind}"]`).trigger('click')
    }

    expect(wrapper.emitted('align')?.map(([kind]) => kind)).toEqual(kinds)
  })

  it('两个轴各抛自己的那一档', async () => {
    const wrapper = mountPanel()

    await wrapper.find('[data-test="multi-distribute-x"]').trigger('click')
    await wrapper.find('[data-test="multi-distribute-y"]').trigger('click')

    expect(wrapper.emitted('distribute')).toEqual([['x'], ['y']])
  })

  it('不同层级时对齐与分布禁用但仍在', async () => {
    const wrapper = mountPanel({ alignReady: false, distributeReady: false })

    expect(
      wrapper.find('[data-test="multi-align-left"]').attributes('disabled'),
    ).toBe('')
    expect(
      wrapper.find('[data-test="multi-distribute-x"]').attributes('disabled'),
    ).toBe('')

    await wrapper.find('[data-test="multi-align-left"]').trigger('click')
    expect(wrapper.emitted('align')).toBeUndefined()
  })

  it('分布单独不够数时只禁分布，不连坐对齐', () => {
    const wrapper = mountPanel({ alignReady: true, distributeReady: false })

    expect(
      wrapper.find('[data-test="multi-align-left"]').attributes('disabled'),
    ).toBeUndefined()
    expect(
      wrapper.find('[data-test="multi-distribute-y"]').attributes('disabled'),
    ).toBe('')
  })

  it('删除所选抛 remove-all', async () => {
    const wrapper = mountPanel()

    await wrapper.find('[data-test="multi-remove"]').trigger('click')

    expect(wrapper.emitted('remove-all')).toHaveLength(1)
  })

  it('全部显示 / 全部隐藏各抛自己的显隐档', async () => {
    const wrapper = mountPanel()

    await wrapper.find('[data-test="multi-visible-on"]').trigger('click')
    await wrapper.find('[data-test="multi-visible-off"]').trigger('click')

    expect(wrapper.emitted('visible-batch')).toEqual([[true], [false]])
  })

  it('统一尺寸三档各抛自己的模式', async () => {
    const wrapper = mountPanel()

    await wrapper.find('[data-test="multi-size-width"]').trigger('click')
    await wrapper.find('[data-test="multi-size-height"]').trigger('click')
    await wrapper.find('[data-test="multi-size-both"]').trigger('click')

    expect(wrapper.emitted('size-batch')).toEqual([
      ['width'],
      ['height'],
      ['both'],
    ])
  })
})

describe('已选清单与类型', () => {
  it('按类型报数；清单缺失的类型显示 moduleType 原文', () => {
    const wrapper = mountPanel({
      nodes: [fakeNode(0), fakeNode(1), fakeNode(2, 'gone-type')],
    })

    expect(wrapper.find('[data-test="multi-type-demo"]').text()).toContain(
      '2 × 演示模块',
    )
    expect(wrapper.find('[data-test="multi-type-gone-type"]').text()).toContain(
      '1 × gone-type',
    )
  })

  it('全同类型出批量表单，不出「只选这一类」', () => {
    const wrapper = mountPanel()

    expect(wrapper.find('[data-test="batch-form"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="multi-select-type-demo"]').exists()).toBe(
      false,
    )
  })

  it('混合类型没有批量表单，只有清单与「只选这一类」，点了抛该类的 id 集', async () => {
    const wrapper = mountPanel({
      nodes: [fakeNode(0), fakeNode(1), fakeNode(2, 'other')],
    })

    expect(wrapper.find('[data-test="batch-form"]').exists()).toBe(false)

    await wrapper.find('[data-test="multi-select-type-demo"]').trigger('click')

    expect(wrapper.emitted('select-type')).toEqual([[['n1', 'n2']]])
  })

  it('批量表单的 config 与 preset 原样转出', () => {
    const wrapper = mountPanel()
    const form = wrapper.findComponent(BatchFormStub)

    form.vm.$emit('config', ['title'], '值', true)
    form.vm.$emit('preset', { id: 'p', label: '预', config: {} })

    expect(wrapper.emitted('config')).toEqual([[['title'], '值', true]])
    expect(wrapper.emitted('preset')).toEqual([
      [{ id: 'p', label: '预', config: {} }],
    ])
  })
})
