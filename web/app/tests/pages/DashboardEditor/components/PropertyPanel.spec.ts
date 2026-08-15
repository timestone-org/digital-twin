/**
 * @fileoverview 契约：「专属配置」页完全由 `configSchema` 泛型渲染——面板里没有一行
 * 针对具体模块的表单代码，换一份清单就换一套表单，且缺省会铺进控件的当前值。
 * 几何 / 显隐 / 卡片外观归「通用配置」页，见 NodeCommonPanel.spec.ts。
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

describe('没有专属配置的模块', () => {
  it('给一句能看的空态，而不是一片空白', () => {
    const wrapper = mount(PropertyPanel, {
      props: { node: NODE, manifest: undefined },
    })

    expect(wrapper.text()).toContain('这个模块没有专属配置')
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

  it('清单声明了预设就摆出预设按钮，点一下整套抛上去', async () => {
    const preset = { id: 'p1', label: '极简', config: { title: 'x' } }
    const wrapper = mount(PropertyPanel, {
      props: {
        node: NODE,
        manifest: { ...MANIFEST, configPresets: [preset] },
      },
    })

    await wrapper.get('.dt-prop__preset').trigger('click')

    expect(wrapper.emitted('preset')?.[0]).toEqual([preset])
  })

  // 几何与显隐搬去「通用配置」页了，这里再出现就是两页各画一份
  it('不再画几何与显隐', () => {
    const wrapper = mount(PropertyPanel, {
      props: { node: NODE, manifest: MANIFEST },
    })

    expect(wrapper.text()).not.toContain('初始可见')
    expect(wrapper.findAll('.dt-number__el')).toHaveLength(0)
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

})
