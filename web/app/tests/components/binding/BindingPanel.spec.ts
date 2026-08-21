/**
 * @fileoverview 契约：绑点面板按传进来的槽声明自动摆槽位，数组槽摆成 N 行，
 * 换来源时把上一种来源的取值一起清掉——留着的话服务端看到的是
 * 「opcua 绑定却带着 compute_json」，那是一条它无从判断该信哪个的记录。
 *
 * 面板不认识「大屏节点」，入参只有槽声明与绑定：孪生子编辑器与大屏右栏共用它。
 */
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import type { BindingPayload, BindingSpec } from '@dt/contracts'
import { DtSelect } from '@dt/ui'

import BindingPanel from '@/components/binding/BindingPanel.vue'

const SPECS: readonly BindingSpec[] = [
  { key: 'title', label: '标题', dataType: 'string', isRequired: true },
  {
    key: 'rows',
    label: '多行',
    dataType: 'number',
    isArray: true,
    arrayFields: [{ key: 'value', label: '数值', dataType: 'number' }],
  },
]

/** 一行两个子槽，用来钉死「行名的键是这一行第一个子槽」。 */
const PAIR_SPECS: readonly BindingSpec[] = [
  {
    key: 'rows',
    label: '多行',
    dataType: 'number',
    isArray: true,
    arrayFields: [
      { key: 'value', label: '数值', dataType: 'number' },
      { key: 'unit', label: '单位', dataType: 'string' },
    ],
  },
]

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

/** 第 index 行的一条绑定。 */
function row(index: number): BindingPayload {
  return binding({ id: `b${index + 2}`, fieldKey: `rows[${index}].value` })
}

describe('空态', () => {
  it('一个槽都没声明时说它不取数，而不是留白', () => {
    const wrapper = mount(BindingPanel, { props: { specs: [], bindings: [] } })

    expect(wrapper.text()).toContain('这个面不取数')
  })
})

describe('槽位由声明摆出', () => {
  it('每个槽一段，必绑的标出来', () => {
    const wrapper = mount(BindingPanel, {
      props: { specs: SPECS, bindings: [] },
    })

    expect(wrapper.text()).toContain('标题')
    expect(wrapper.text()).toContain('多行')
    expect(wrapper.text()).toContain('必绑')
  })

  it('数组槽按已有绑定的行数摆行，行键是 `槽[行].子槽`', () => {
    const wrapper = mount(BindingPanel, {
      props: { specs: SPECS, bindings: [row(0)] },
    })

    expect(wrapper.text()).toContain('rows[0].value')
    expect(wrapper.text()).toContain('第 1 行')
  })

  it('还没绑的槽给「绑定」按钮，点它抛出槽键', async () => {
    const wrapper = mount(BindingPanel, {
      props: { specs: SPECS, bindings: [] },
    })
    const buttons = wrapper.findAll('button')
    const bind = buttons.find((item) => item.text().includes('绑定'))

    await bind?.trigger('click')

    expect(wrapper.emitted('bind')?.[0]).toEqual(['title'])
  })

  it('已绑的槽给来源下拉与解绑键', async () => {
    const wrapper = mount(BindingPanel, {
      props: { specs: SPECS, bindings: [binding()] },
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
      props: { specs: SPECS, bindings: [] },
    })
    const add = wrapper
      .findAll('button')
      .find((item) => item.text().includes('新增一行'))

    await add?.trigger('click')

    expect(wrapper.emitted('addRow')?.[0]).toEqual(['rows'])
  })

  it('删一行抛 removeRow，带槽键与行号', async () => {
    const wrapper = mount(BindingPanel, {
      props: { specs: SPECS, bindings: [row(0)] },
    })
    const remove = wrapper
      .findAll('button')
      .find((item) => item.attributes('aria-label') === '删除这一行')

    await remove?.trigger('click')

    expect(wrapper.emitted('removeRow')?.[0]).toEqual(['rows', 0])
  })
})

describe('行数跟着实体走（rowCounts）', () => {
  it('一条绑定都没有也照样摆出实体那么多行', () => {
    const wrapper = mount(BindingPanel, {
      props: { specs: SPECS, bindings: [], rowCounts: { rows: 2 } },
    })

    expect(wrapper.text()).toContain('rows[0].value')
    expect(wrapper.text()).toContain('rows[1].value')
  })

  it('不摆「新增一行」，正常行也不摆删除键', () => {
    const wrapper = mount(BindingPanel, {
      props: { specs: SPECS, bindings: [row(0)], rowCounts: { rows: 1 } },
    })
    const buttons = wrapper.findAll('button')

    expect(buttons.some((item) => item.text().includes('新增一行'))).toBe(false)
    expect(
      buttons.some((item) => item.attributes('aria-label') === '删除这一行'),
    ).toBe(false)
  })

  it('超出实体数的存量行照样摆出来，标成孤行且能删', async () => {
    const wrapper = mount(BindingPanel, {
      props: {
        specs: SPECS,
        bindings: [row(0), row(1)],
        rowCounts: { rows: 1 },
      },
    })

    expect(wrapper.text()).toContain('没有对应的实体')
    const remove = wrapper
      .findAll('button')
      .find((item) => item.attributes('aria-label') === '删除这一行')
    await remove?.trigger('click')

    // 能删的只有孤行，所以第一个删除键落在第 2 行上
    expect(wrapper.emitted('removeRow')?.[0]).toEqual(['rows', 1])
  })

  it('实体数为 0 的槽仍算「跟着实体走」，不摆新增键', () => {
    const wrapper = mount(BindingPanel, {
      props: { specs: SPECS, bindings: [], rowCounts: { rows: 0 } },
    })

    expect(
      wrapper
        .findAll('button')
        .some((item) => item.text().includes('新增一行')),
    ).toBe(false)
    // 槽内空行走行内空态：单行、不带图标，不把整个槽撑成一张空卡片
    const empty = wrapper.get('.dt-empty--inline')
    expect(empty.text()).toContain('还没有可绑的行')
    expect(empty.find('svg').exists()).toBe(false)
  })
})

describe('数组槽的行名与行 id', () => {
  it('给了 rowLabels 就拿它当组标题，并把 id 一起摆出来', () => {
    const wrapper = mount(BindingPanel, {
      props: {
        specs: SPECS,
        bindings: [row(0)],
        rowLabels: { 'rows[0].value': { title: '一号锚点', id: 'p1::temp' } },
      },
    })

    expect(wrapper.text()).toContain('一号锚点')
    // id 与实体清单上显示的那一份逐字相同，绑的时候靠它核对
    expect(wrapper.text()).toContain('p1::temp')
    expect(wrapper.text()).not.toContain('第 1 行')
  })

  it('id 给成空串时只摆名字，不留一行空标识', () => {
    const wrapper = mount(BindingPanel, {
      props: {
        specs: SPECS,
        bindings: [row(0)],
        rowLabels: { 'rows[0].value': { title: '一号锚点', id: '' } },
      },
    })

    expect(wrapper.findAll('.font-mono')).toHaveLength(0)
  })

  it('不给 rowLabels 时还是「第 N 行」', () => {
    const wrapper = mount(BindingPanel, {
      props: { specs: SPECS, bindings: [row(0)] },
    })

    expect(wrapper.text()).toContain('第 1 行')
  })

  it('只给了一部分行时，逐行各自回落', () => {
    const wrapper = mount(BindingPanel, {
      props: {
        specs: SPECS,
        bindings: [row(0), row(1)],
        rowLabels: { 'rows[0].value': { title: '一号锚点', id: 'a1' } },
      },
    })

    expect(wrapper.text()).toContain('一号锚点')
    expect(wrapper.text()).toContain('第 2 行')
    expect(wrapper.text()).not.toContain('第 1 行')
  })

  it('行名的键是这一行第一个子槽，认错键就回落', () => {
    const wrapper = mount(BindingPanel, {
      props: {
        specs: PAIR_SPECS,
        bindings: [row(0)],
        rowLabels: { 'rows[0].unit': { title: '一号锚点', id: 'a1' } },
      },
    })

    expect(wrapper.text()).toContain('第 1 行')
    expect(wrapper.text()).not.toContain('一号锚点')
  })
})

describe('换来源', () => {
  it('把上一种来源的取值一起清掉', async () => {
    const wrapper = mount(BindingPanel, {
      props: {
        specs: SPECS,
        bindings: [binding({ sourceKind: 'opcua', nodeKey: 's1:temp' })],
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
