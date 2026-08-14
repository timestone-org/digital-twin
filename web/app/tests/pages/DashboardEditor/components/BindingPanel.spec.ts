/**
 * @fileoverview 契约：绑点面板读清单的 `bindings` 自动摆槽位，数组槽摆成 N 行，
 * 换来源时把上一种来源的取值一起清掉——留着的话服务端看到的是
 * 「opcua 绑定却带着 compute_json」，那是一条它无从判断该信哪个的记录。
 */
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import type {
  BindingPayload,
  DashboardNodePayload,
  ModuleManifest,
} from '@dt/contracts'
import { DtSelect } from '@dt/ui'

import BindingPanel from '@/pages/DashboardEditor/components/BindingPanel.vue'

const MANIFEST: ModuleManifest = {
  type: 'demo',
  displayName: '演示',
  category: '演示',
  defaultSize: { width: 100, height: 100 },
  configSchema: [],
  bindings: [
    { key: 'title', label: '标题', dataType: 'string', isRequired: true },
    {
      key: 'rows',
      label: '多行',
      dataType: 'number',
      isArray: true,
      arrayFields: [{ key: 'value', label: '数值', dataType: 'number' }],
    },
  ],
  component: () => Promise.resolve({ default: {} }),
}

const BARE: ModuleManifest = { ...MANIFEST, bindings: [] }

function binding(over: Partial<BindingPayload> = {}): BindingPayload {
  return {
    id: 'b1',
    nodeId: 'n1',
    fieldKey: 'title',
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

function node(bindings: BindingPayload[] = []): DashboardNodePayload {
  return {
    id: 'n1',
    dashboardId: 'd1',
    parentId: null,
    clientKey: null,
    moduleType: 'demo',
    x: 0,
    y: 0,
    w: 10,
    h: 10,
    zIndex: 0,
    isVisible: true,
    configJson: {},
    createdAt: '',
    updatedAt: '',
    bindings,
  }
}

describe('空态', () => {
  it('没选中节点时说清楚', () => {
    const wrapper = mount(BindingPanel, {
      props: { node: null, manifest: MANIFEST },
    })

    expect(wrapper.text()).toContain('没有选中节点')
  })

  it('模块没声明绑定槽时说它不取数，而不是留白', () => {
    const wrapper = mount(BindingPanel, {
      props: { node: node(), manifest: BARE },
    })

    expect(wrapper.text()).toContain('这个模块不取数')
  })
})

describe('槽位由清单摆出', () => {
  it('每个槽一段，必绑的标出来', () => {
    const wrapper = mount(BindingPanel, {
      props: { node: node(), manifest: MANIFEST },
    })

    expect(wrapper.text()).toContain('标题')
    expect(wrapper.text()).toContain('多行')
    expect(wrapper.text()).toContain('必绑')
  })

  it('数组槽按已有绑定的行数摆行，行键是 `槽[行].子槽`', () => {
    const wrapper = mount(BindingPanel, {
      props: {
        node: node([binding({ id: 'b2', fieldKey: 'rows[0].value' })]),
        manifest: MANIFEST,
      },
    })

    expect(wrapper.text()).toContain('rows[0].value')
    expect(wrapper.text()).toContain('第 1 行')
  })

  it('还没绑的槽给「绑定」按钮，点它抛出槽键', async () => {
    const wrapper = mount(BindingPanel, {
      props: { node: node(), manifest: MANIFEST },
    })
    const buttons = wrapper.findAll('button')
    const bind = buttons.find((item) => item.text().includes('绑定'))

    await bind?.trigger('click')

    expect(wrapper.emitted('bind')?.[0]).toEqual(['title'])
  })

  it('已绑的槽给来源下拉与解绑键', async () => {
    const wrapper = mount(BindingPanel, {
      props: { node: node([binding()]), manifest: MANIFEST },
    })
    const drop = wrapper
      .findAll('button')
      .find((item) => item.attributes('aria-label') === '解除绑定')

    await drop?.trigger('click')

    expect(wrapper.emitted('drop')?.[0]).toEqual(['title'])
  })
})

describe('数组槽的行', () => {
  it('加一行抛 addRow', async () => {
    const wrapper = mount(BindingPanel, {
      props: { node: node(), manifest: MANIFEST },
    })
    const add = wrapper
      .findAll('button')
      .find((item) => item.text().includes('新增一行'))

    await add?.trigger('click')

    expect(wrapper.emitted('addRow')?.[0]).toEqual(['rows'])
  })

  it('删一行抛 removeRow，带槽键与行号', async () => {
    const wrapper = mount(BindingPanel, {
      props: {
        node: node([binding({ id: 'b2', fieldKey: 'rows[0].value' })]),
        manifest: MANIFEST,
      },
    })
    const remove = wrapper
      .findAll('button')
      .find((item) => item.attributes('aria-label') === '删除这一行')

    await remove?.trigger('click')

    expect(wrapper.emitted('removeRow')?.[0]).toEqual(['rows', 0])
  })
})

describe('换来源', () => {
  it('把上一种来源的取值一起清掉', async () => {
    const wrapper = mount(BindingPanel, {
      props: {
        node: node([binding({ sourceKind: 'opcua', nodeKey: 's1:temp' })]),
        manifest: MANIFEST,
      },
    })
    // 直接驱动来源下拉：菜单是 teleport 出去的，选项点不到，
    // 而这条用例要守的是「换来源之后写回去的是什么」
    wrapper.findComponent(DtSelect).vm.$emit('update:modelValue', 'static')
    await wrapper.vm.$nextTick()

    expect(wrapper.emitted('write')?.[0]?.[0]).toMatchObject({
      id: 'b1',
      sourceKind: 'static',
      nodeKey: null,
      computeJson: null,
      detailJson: null,
    })
  })
})
