/**
 * @fileoverview 契约：属性面板完全由 `configSchema` 泛型渲染——面板里没有一行
 * 针对具体模块的表单代码，换一份清单就换一套表单，且缺省会铺进控件的当前值。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import type { DashboardNodePayload, ModuleManifest } from '@dt/contracts'
import { __resetConfigControls } from '@dt/modules'

import { installConfigControls } from '@/features/dashboard/configControls'
import PropertyPanel from '@/pages/DashboardEditor/components/PropertyPanel.vue'

const MANIFEST: ModuleManifest = {
  type: 'demo',
  displayName: '演示',
  category: '演示',
  defaultSize: { width: 100, height: 100 },
  configSchema: [
    {
      key: 'title',
      label: '标题',
      type: 'string',
      group: '标题',
      default: '缺省标题',
    },
    { key: 'showBar', label: '显示条', type: 'boolean', group: '标题' },
    {
      key: 'note',
      label: '备注',
      type: 'string',
      group: '标题',
      when: { key: 'showBar', in: [true] },
    },
    { key: 'accent', label: '强调色', type: 'color', group: '外观' },
  ],
  bindings: [],
  component: () => Promise.resolve({ default: {} }),
}

const NODE: DashboardNodePayload = {
  id: 'n1',
  dashboardId: 'd1',
  parentId: null,
  clientKey: null,
  moduleType: 'demo',
  x: 12,
  y: 34,
  w: 56,
  h: 78,
  zIndex: 0,
  isVisible: true,
  configJson: {},
  createdAt: '',
  updatedAt: '',
  bindings: [],
}

beforeEach(() => {
  __resetConfigControls()
  installConfigControls()
})

describe('没有选中节点', () => {
  it('给一句能看的空态，而不是一片空白', () => {
    const wrapper = mount(PropertyPanel, {
      props: { node: null, manifest: undefined },
    })

    expect(wrapper.text()).toContain('没有选中节点')
  })
})

describe('泛型渲染', () => {
  it('按清单声明摆出分段与字段标签', () => {
    const wrapper = mount(PropertyPanel, {
      props: { node: NODE, manifest: MANIFEST },
    })

    expect(wrapper.text()).toContain('标题')
    expect(wrapper.text()).toContain('外观')
    expect(wrapper.text()).toContain('强调色')
  })

  it('条件不满足的字段不出现，满足了才出现', () => {
    const off = mount(PropertyPanel, {
      props: { node: NODE, manifest: MANIFEST },
    })
    expect(off.text()).not.toContain('备注')

    const on = mount(PropertyPanel, {
      props: {
        node: { ...NODE, configJson: { showBar: true } },
        manifest: MANIFEST,
      },
    })
    expect(on.text()).toContain('备注')
  })

  it('清单缺省铺进控件的当前值', () => {
    const wrapper = mount(PropertyPanel, {
      props: { node: NODE, manifest: MANIFEST },
    })
    const input = wrapper.find('.dt-input__el')

    expect((input.element as HTMLInputElement).value).toBe('缺省标题')
  })

  it('几何四项按节点当前坐标显示', () => {
    const wrapper = mount(PropertyPanel, {
      props: { node: NODE, manifest: MANIFEST },
    })
    const numbers = wrapper
      .findAll('.dt-number__el')
      .map((input) => (input.element as HTMLInputElement).value)

    expect(numbers).toContain('12')
    expect(numbers).toContain('78')
  })

  it('没有清单时只剩几何与显隐，不崩', () => {
    const wrapper = mount(PropertyPanel, {
      props: { node: NODE, manifest: undefined },
    })

    expect(wrapper.text()).toContain('初始可见')
  })
})

describe('抛出的改动', () => {
  it('改配置抛 config，带路径与「是不是连续输入」', async () => {
    const wrapper = mount(PropertyPanel, {
      props: { node: NODE, manifest: MANIFEST },
    })

    await wrapper.find('.dt-input__el').setValue('新标题')

    expect(wrapper.emitted('config')?.[0]).toEqual([['title'], '新标题', true])
  })

  it('改几何抛 geometry，且是连续输入', async () => {
    const wrapper = mount(PropertyPanel, {
      props: { node: NODE, manifest: MANIFEST },
    })
    const numberInput = wrapper.findAll('.dt-number__el')[0]

    await numberInput?.setValue('99')

    expect(wrapper.emitted('geometry')?.[0]).toEqual([
      { x: 99, y: 34, w: 56, h: 78 },
      true,
    ])
  })

  it('改显隐抛 visible', async () => {
    const wrapper = mount(PropertyPanel, {
      props: { node: NODE, manifest: MANIFEST },
    })
    const toggles = wrapper.findAll('button[role="switch"]')

    await toggles[0]?.trigger('click')

    expect(wrapper.emitted('visible')?.[0]).toEqual([false])
  })
})
