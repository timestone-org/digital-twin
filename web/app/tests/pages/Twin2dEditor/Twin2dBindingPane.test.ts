/**
 * @fileoverview 契约：2D 孪生的绑定页把行钉在实体上，把实体的名字与 id 一起摆出来，
 * 并默认只摆当前选中的那一个。
 *
 * ⚠ id 与大纲上显示的那一份逐字相同：两边显示不同的标识时，用户没有任何办法确认第
 * 7 行绑的到底是哪个节点。
 * ⚠ 行不许手工增删：行号就是文档序，手工删一行会让它后面的每一条绑定改喂前一个实体，
 * 而界面上看不出来。索引留空是常态——一张图四十个槽位只接三个点位。
 * ⚠ 选中标注或样式时退回全部而不是摆一片空白：它们本就没有绑定行，空白会让人以为
 * 绑定丢了。
 */
import type { BindingPayload } from '@dt/contracts'
import { normalizeTwin2dConfig } from '@dt/twin2d'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import BindingPanel from '@/components/binding/BindingPanel.vue'
import Twin2dBindingPane from '@/pages/Twin2dEditor/components/Twin2dBindingPane.vue'
import { TWIN_2D_SELECT_CANVAS } from '@/pages/Twin2dEditor/scripts/types'
import type { Twin2dSelection } from '@/pages/Twin2dEditor/scripts/types'

/**
 * 一个有两个有效槽位的水箱、一个一个槽位都没有的换热器，与一条把两者连起来的线。
 * 于是 `nodeValues` 两行、`nodeStatus` 两行、`edgeValues` 一行。
 */
const CONFIG = normalizeTwin2dConfig({
  nodes: [
    { id: 'n1', styleId: 'water-tank', x: 100, y: 100, label: '一号水箱' },
    { id: 'n2', styleId: 'heat-exchanger', x: 300, y: 100 },
  ],
  edges: [
    {
      id: 'e1',
      styleId: 'water',
      from: { nodeId: 'n1', portId: '' },
      to: { nodeId: 'n2', portId: '' },
    },
  ],
  marks: [{ id: 'm1', kind: 'text', x: 0, y: 0, text: '注' }],
})

function binding(fieldKey: string): BindingPayload {
  return {
    id: fieldKey,
    nodeId: 'host',
    fieldKey,
    sourceKind: 'opcua',
    nodeKey: null,
    staticValueJson: null,
    computeJson: null,
    transformJson: null,
    detailJson: null,
    createdAt: '2026-08-20T00:00:00Z',
    updatedAt: '2026-08-20T00:00:00Z',
  }
}

function mountPane(
  selection: Twin2dSelection = TWIN_2D_SELECT_CANVAS,
  bindings: BindingPayload[] = [],
  isDirty = false,
) {
  return mount(Twin2dBindingPane, {
    props: { config: CONFIG, bindings, isDirty, selection },
  })
}

/** 按文案找一枚按钮；找不到时交出 undefined，让断言自己说话。 */
function buttonOf(wrapper: ReturnType<typeof mountPane>, text: string) {
  return wrapper.findAll('button').find((item) => item.text().includes(text))
}

describe('行跟着实体走', () => {
  it('一条绑定都没有也把每个实体摆成一行', () => {
    const text = mountPane().text()

    expect(text).toContain('一号水箱 · 当前温度')
    expect(text).toContain('一号水箱 · 液位')
    expect(text).toContain('一号水箱 → n2')
  })

  it('每一行标着与大纲一致的 id', () => {
    const wrapper = mountPane()
    const ids = wrapper.findAll('.font-mono').map((item) => item.text())

    expect(ids).toContain('n1')
    expect(ids).toContain('e1')
  })

  it('不摆「新增一行」，也不摆正常行的删除键', () => {
    const wrapper = mountPane(TWIN_2D_SELECT_CANVAS, [
      binding('nodeValues[0].value'),
    ])

    expect(buttonOf(wrapper, '新增一行')).toBeUndefined()
    expect(
      wrapper
        .findAll('button')
        .some((item) => item.attributes('aria-label') === '删除这一行'),
    ).toBe(false)
  })

  // ⚠ 超出行数的存量绑定必须摆出来：藏起来的话它既看不见也删不掉，而它永远喂不到
  // 任何东西
  it('喂不到任何实体的那一行摆出来并且能删', async () => {
    const wrapper = mountPane(TWIN_2D_SELECT_CANVAS, [
      binding('nodeValues[2].value'),
    ])
    const remove = wrapper
      .findAll('button')
      .find((item) => item.attributes('aria-label') === '删除这一行')

    await remove?.trigger('click')

    expect(wrapper.text()).toContain('没有对应的实体')
    expect(wrapper.emitted('removeRow')?.[0]).toEqual(['nodeValues', 2])
  })
})

describe('转发', () => {
  it('点「绑定」抛出这一行的槽键', async () => {
    const wrapper = mountPane()

    await buttonOf(wrapper, '绑定')?.trigger('click')

    expect(wrapper.emitted('bind')?.[0]).toEqual(['nodeValues[0].value'])
  })

  it('点「挑点位」抛出这一行的槽键', async () => {
    const wrapper = mountPane(TWIN_2D_SELECT_CANVAS, [
      binding('nodeValues[0].value'),
    ])

    await buttonOf(wrapper, '挑点位')?.trigger('click')

    expect(wrapper.emitted('pick')?.[0]).toEqual(['nodeValues[0].value'])
  })

  it('点解绑抛出这一行的槽键', async () => {
    const wrapper = mountPane(TWIN_2D_SELECT_CANVAS, [
      binding('nodeValues[0].value'),
    ])
    const drop = wrapper
      .findAll('button')
      .find((item) => item.attributes('aria-label') === '解除绑定')

    await drop?.trigger('click')

    expect(wrapper.emitted('drop')?.[0]).toEqual(['nodeValues[0].value'])
  })

  it('面板写回一条绑定就原样上抛', () => {
    const wrapper = mountPane()
    const written = binding('nodeValues[0].value')

    wrapper.findComponent(BindingPanel).vm.$emit('write', written)

    expect(wrapper.emitted('write')?.[0]).toEqual([written])
  })
})

describe('没保存的提醒', () => {
  // ⚠ 推送方读的是已落库的绑定；不提醒的话表现成「绑完了但一直是占位符」
  it('有未保存改动时说明推送要等保存', () => {
    expect(mountPane(TWIN_2D_SELECT_CANVAS, [], true).text()).toContain(
      '保存之后才会开始推送',
    )
  })

  it('干净时不摆这条提醒', () => {
    expect(mountPane().text()).not.toContain('保存之后才会开始推送')
  })
})

/**
 * ⚠ 这一组守的是「点谁就是谁」。一张图上百行绑定是常态，全摆出来时「这一行是谁的」
 * 只能靠行名一行行认。
 */
describe('只看选中的那一个', () => {
  it('选中一个节点，只摆这个节点的读数行与状态行', () => {
    const text = mountPane({ kind: 'nodes', id: 'n1' }).text()

    expect(text).toContain('一号水箱 · 当前温度')
    expect(text).toContain('节点状态')
    expect(text).not.toContain('连线读数')
  })

  it('选中一条连线，只摆连线那一段', () => {
    const text = mountPane({ kind: 'edges', id: 'e1' }).text()

    expect(text).toContain('一号水箱 → n2')
    expect(text).not.toContain('节点读数')
  })

  it('收窄了要说出来，否则一个短短的绑定页看着像别的绑定丢了', () => {
    expect(mountPane({ kind: 'nodes', id: 'n1' }).text()).toContain(
      '只看选中的节点',
    )
  })

  it('点「显示全部」切回整张图', async () => {
    const wrapper = mountPane({ kind: 'nodes', id: 'n1' })

    await buttonOf(wrapper, '显示全部')?.trigger('click')

    expect(wrapper.text()).toContain('一号水箱 → n2')
  })

  it('换选中要复位回收窄：收窄才是默认，不是一次性的', async () => {
    const wrapper = mountPane({ kind: 'nodes', id: 'n1' })
    await buttonOf(wrapper, '显示全部')?.trigger('click')

    await wrapper.setProps({ selection: { kind: 'edges', id: 'e1' } })

    expect(wrapper.text()).toContain('一号水箱 → n2')
    expect(wrapper.text()).not.toContain('节点读数')
  })

  it('选中标注这类不取数的东西时退回全部，不是空白一片', () => {
    const text = mountPane({ kind: 'marks', id: 'm1' }).text()

    expect(text).toContain('一号水箱 · 当前温度')
    expect(text).toContain('一号水箱 → n2')
    expect(text).not.toContain('只看选中的')
  })

  it('选中画布时摆的是整张图的绑定', () => {
    expect(mountPane().text()).not.toContain('只看选中的')
  })

  // 选中态摘悬空 id 要等配置变了那一拍；这中间老实说它没有可绑的数据
  it('选中一个已经不在图上的节点时说它没有可绑的数据', () => {
    expect(mountPane({ kind: 'nodes', id: 'gone' }).text()).toContain(
      '没有可绑的数据',
    )
  })
})
