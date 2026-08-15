/**
 * @fileoverview 契约：钻取面板点卡片往下钻、面包屑往回走、叶子层摊开全部字段、
 * 父层只显示摘要，以及 `hideChildList` 那一层不给卡片只给 3D 提示。
 * ⚠ 当前停在哪一层由宿主持有：面板只抛 `update:nodeId`，自己不留一份，
 * 否则宿主的取景与部件点击跳转会与它对不上。
 */
import { normalizeTwinConfig, type TwinHierNode } from '@dt/twin-config'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import TwinHierCard from '../src/TwinHierCard.vue'
import TwinHierDrill from '../src/TwinHierDrill.vue'

const TREE = [
  { id: 'plant', name: '厂区' },
  {
    id: 'shopA',
    parentId: 'plant',
    name: 'A 车间',
    fields: [
      { key: 'p', label: '功率', unit: 'kW' },
      { key: 'q', label: '流量' },
      { key: 'r', label: '温度' },
    ],
  },
  {
    id: 'pump',
    parentId: 'shopA',
    name: '泵组',
    fields: [
      { key: 'p', label: '功率', unit: 'kW', decimals: 1 },
      { key: 'note', label: '备注', staticText: '待接入' },
    ],
  },
]

function nodesOf(raw: unknown[] = TREE): TwinHierNode[] {
  return normalizeTwinConfig({ hierNodes: raw }).hierNodes
}

function render(
  nodeId: string,
  raw: unknown[] = TREE,
  values: Record<string, { value: unknown }> = {},
) {
  return mount(TwinHierDrill, {
    props: { nodes: nodesOf(raw), nodeId, values },
  })
}

type Wrapper = ReturnType<typeof render>

function cardIds(wrapper: Wrapper): (string | undefined)[] {
  return wrapper
    .findAll('[data-test="drill-card"]')
    .map((item) => item.attributes('data-id'))
}

describe('往下钻', () => {
  it('父层列出子项卡片', () => {
    expect(cardIds(render('plant'))).toEqual(['shopA'])
  })

  it('点卡片把新的一层抛给宿主，自己不留一份', async () => {
    const wrapper = render('plant')

    await wrapper.get('[data-test="drill-card"]').trigger('click')

    expect(wrapper.emitted('update:nodeId')?.[0]).toEqual(['shopA'])
    expect(cardIds(wrapper)).toEqual(['shopA'])
  })

  it('卡片上标出这一层还有几个下级', () => {
    expect(render('plant').get('[data-test="drill-card"]').text()).toContain(
      '1 项',
    )
  })
})

describe('面包屑', () => {
  it('画出根到当前的整条路径', () => {
    const crumbs = render('pump').findAll('[data-test="drill-crumb"]')

    expect(crumbs.map((item) => item.text())).toEqual([
      '厂区',
      'A 车间',
      '泵组',
    ])
  })

  it('点面包屑上的祖先直接跳回去', async () => {
    const wrapper = render('pump')

    await wrapper.findAll('[data-test="drill-crumb"]')[0]?.trigger('click')

    expect(wrapper.emitted('update:nodeId')?.[0]).toEqual(['plant'])
  })

  it('当前这一节点不动，点它不抛事件', async () => {
    const wrapper = render('pump')

    await wrapper.findAll('[data-test="drill-crumb"]')[2]?.trigger('click')

    expect(wrapper.emitted('update:nodeId')).toBeUndefined()
  })

  it('返回键退到上一层', async () => {
    const wrapper = render('pump')

    await wrapper.get('[data-test="drill-back"]').trigger('click')

    expect(wrapper.emitted('update:nodeId')?.[0]).toEqual(['shopA'])
  })

  it('已经在根上时返回键关掉整个面板', async () => {
    const wrapper = render('plant')

    await wrapper.get('[data-test="drill-back"]').trigger('click')

    expect(wrapper.emitted('close')).toHaveLength(1)
    expect(wrapper.emitted('update:nodeId')).toBeUndefined()
  })

  it('关闭键抛关闭', async () => {
    const wrapper = render('plant')

    await wrapper.get('[data-test="drill-close"]').trigger('click')

    expect(wrapper.emitted('close')).toHaveLength(1)
  })
})

describe('读数', () => {
  it('叶子层摊开全部字段', () => {
    const wrapper = render('pump', TREE, { 'pump::p': { value: 12.34 } })

    expect(wrapper.findAll('[data-test="drill-field"]')).toHaveLength(2)
    expect(wrapper.text()).toContain('12.3 kW')
  })

  it('没有实时值就退回静态文本', () => {
    expect(render('pump').text()).toContain('待接入')
  })

  it('实时值与静态文本都没有时给占位符，不留一片空白', () => {
    const wrapper = render('pump', [
      { id: 'pump', name: '泵组', fields: [{ key: 'p', label: '功率' }] },
    ])

    expect(wrapper.get('[data-test="drill-field"]').text()).toContain('—')
  })

  it('父层卡片上没勾摘要时只摊前两个字段', () => {
    const wrapper = render('plant', TREE, {
      'shopA::p': { value: 1 },
      'shopA::q': { value: 2 },
      'shopA::r': { value: 3 },
    })

    expect(wrapper.get('[data-test="drill-card"]').text()).not.toContain('温度')
  })

  it('勾了摘要就按勾的来', () => {
    const wrapper = render(
      'plant',
      [TREE[0], { ...TREE[1], summaryFieldKeys: ['r'] }],
      { 'shopA::r': { value: 3 } },
    )

    const text = wrapper.get('[data-test="drill-card"]').text()
    expect(text).toContain('温度')
    expect(text).not.toContain('功率')
  })

  it('父层自己不摊开字段——那是叶子层的事', () => {
    expect(render('shopA').findAll('[data-test="drill-field"]')).toHaveLength(0)
  })
})

describe('名字、图标与标签的回落', () => {
  it('名字空着时卡片上退回节点 id', () => {
    const wrapper = render('plant', [
      { id: 'plant', name: '厂区' },
      { id: 'shopA', parentId: 'plant', name: '' },
    ])

    expect(wrapper.get('[data-test="drill-card"]').text()).toContain('shopA')
  })

  it('配了图标就用配的那个，不被缺省图标顶掉', () => {
    const wrapper = render('plant', [
      { id: 'plant', name: '厂区' },
      { id: 'shopA', parentId: 'plant', name: 'A 车间', icon: 'building' },
    ])

    expect(wrapper.getComponent(TwinHierCard).props('icon')).toBe('building')
  })

  it('字段标签空着时退回字段 key', () => {
    const wrapper = render('pump', [
      { id: 'pump', name: '泵组', fields: [{ key: 'p', staticText: '—' }] },
    ])

    expect(wrapper.get('[data-test="drill-field"]').text()).toContain('p')
  })
})

describe('标题', () => {
  it('没配标题时用整条钻取路径', () => {
    expect(render('pump').get('[data-test="drill-title"]').text()).toBe(
      '厂区 / A 车间 / 泵组',
    )
  })

  it('配了标题就用它', () => {
    const wrapper = render('plant', [
      { id: 'plant', name: '厂区', title: '全厂总览' },
    ])

    expect(wrapper.get('[data-test="drill-title"]').text()).toBe('全厂总览')
  })
})

describe('隐藏子项列表', () => {
  it('开了之后不给卡片，只提示去点 3D', () => {
    const wrapper = render('plant', [
      { id: 'plant', name: '厂区', hideChildList: true },
      { id: 'shopA', parentId: 'plant', name: 'A 车间' },
    ])

    expect(cardIds(wrapper)).toEqual([])
    expect(wrapper.get('[data-test="drill-pick-only"]').text()).toContain(
      '点模型上的部件',
    )
  })

  it('叶子层开了它也不会误显示提示', () => {
    const wrapper = render('pump', [
      { id: 'pump', name: '泵组', hideChildList: true },
    ])

    expect(wrapper.find('[data-test="drill-pick-only"]').exists()).toBe(false)
  })
})

describe('落不到任何一层', () => {
  it('当前 id 找不到时整块不画，不留一个空壳', () => {
    expect(render('gone').find('[data-test="twin-drill"]').exists()).toBe(false)
  })

  it('既没有字段也没有下级时说出来', () => {
    const wrapper = render('plant', [{ id: 'plant', name: '厂区' }])

    expect(wrapper.get('[data-test="drill-empty"]').text()).toContain(
      '还没有配字段',
    )
  })
})
