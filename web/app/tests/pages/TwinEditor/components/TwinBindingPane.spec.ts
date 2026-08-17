/**
 * @fileoverview 契约：孪生的绑定页把行钉在实体上，并把实体的 id 与名字一起摆出来。
 *
 * ⚠ id 与信息牌字段列表上显示的那一份逐字相同（`<牌 id>::<字段 key>`）：
 * 两边显示不同的标识时，用户没有任何办法确认第 7 行绑的到底是哪个字段。
 * ⚠ 行不许手工增删：行号就是文档序，手工删一行会让它后面的每一条绑定改喂
 * 前一个实体，而界面上看不出来。
 */
import type { BindingPayload } from '@dt/contracts'
import { normalizeTwinConfig } from '@dt/twin-config'
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'

import TwinBindingPane from '@/pages/TwinEditor/components/TwinBindingPane.vue'
import { TWIN_SELECT_MODEL, type TwinSelection } from '@/pages/TwinEditor/types'

const CONFIG = normalizeTwinConfig({
  anchors: [{ id: 'a1', name: '进口' }],
  panels: [
    {
      id: 'p1',
      name: '泵组',
      fields: [
        { key: 'temp', label: '温度' },
        { key: 'flow', label: '流量' },
      ],
    },
  ],
})

function binding(fieldKey: string): BindingPayload {
  return {
    id: fieldKey,
    nodeId: 'n1',
    fieldKey,
    sourceKind: 'opcua',
    nodeKey: null,
    staticValueJson: null,
    computeJson: null,
    transformJson: null,
    detailJson: null,
    createdAt: '',
    updatedAt: '',
  }
}

function mountPane(
  bindings: BindingPayload[] = [],
  isDirty = false,
  selection: TwinSelection = TWIN_SELECT_MODEL,
) {
  return mount(TwinBindingPane, {
    props: { config: CONFIG, bindings, isDirty, selection },
  })
}

describe('行跟着实体走', () => {
  it('一条绑定都没有也把每个实体摆成一行', () => {
    const wrapper = mountPane()

    expect(wrapper.text()).toContain('进口')
    expect(wrapper.text()).toContain('泵组 · 温度')
    expect(wrapper.text()).toContain('泵组 · 流量')
  })

  it('每一行标着与信息牌字段列表一致的 id', () => {
    const wrapper = mountPane()

    expect(wrapper.text()).toContain('p1::temp')
    expect(wrapper.text()).toContain('p1::flow')
  })

  it('不摆「新增一行」，也不摆正常行的删除键', () => {
    const wrapper = mountPane([binding('panelValues[0].value')])
    const buttons = wrapper.findAll('button')

    expect(buttons.some((item) => item.text().includes('新增一行'))).toBe(false)
    expect(
      buttons.some((item) => item.attributes('aria-label') === '删除这一行'),
    ).toBe(false)
  })
})

describe('转发', () => {
  it('点「绑定」抛出这一行的槽键', async () => {
    const wrapper = mountPane()
    const bind = wrapper
      .findAll('button')
      .find((item) => item.text().includes('绑定'))

    await bind?.trigger('click')

    expect(wrapper.emitted('bind')?.[0]).toEqual(['anchorValues[0].value'])
  })

  it('点「挑点位」抛出这一行的槽键', async () => {
    const wrapper = mountPane([binding('anchorValues[0].value')])
    const pick = wrapper
      .findAll('button')
      .find((item) => item.text().includes('挑点位'))

    await pick?.trigger('click')

    expect(wrapper.emitted('pick')?.[0]).toEqual(['anchorValues[0].value'])
  })
})

describe('没保存的提醒', () => {
  // ⚠ 推送方读的是已落库的绑定；不提醒的话表现成「绑完了但一直是占位符」
  it('有未保存改动时说明推送要等保存', () => {
    expect(mountPane([], true).text()).toContain('保存之后才会开始推送')
  })

  it('干净时不摆这条提醒', () => {
    expect(mountPane([], false).text()).not.toContain('保存之后才会开始推送')
  })
})

/**
 * ⚠ 这一组守的是「点谁就是谁」。一段孪生上百行绑定是常态（信息牌按字段摊平），
 * 全摆出来时「这一行是谁的」只能靠行名一行行认。
 */
describe('只看选中的那一个', () => {
  it('⚠ 选中一张信息牌，只摆这张牌的字段，别的实体一个都不摆', () => {
    const wrapper = mountPane([], false, { kind: 'panels', id: 'p1' })

    expect(wrapper.text()).toContain('泵组 · 温度')
    expect(wrapper.text()).toContain('泵组 · 流量')
    expect(wrapper.text()).not.toContain('进口')
  })

  it('⚠ 收窄了要说出来，否则一个短短的绑定页看着像别的绑定丢了', () => {
    const wrapper = mountPane([], false, { kind: 'panels', id: 'p1' })

    expect(wrapper.text()).toContain('只看选中的信息牌')
  })

  it('点「显示全部」切回整段孪生', async () => {
    const wrapper = mountPane([], false, { kind: 'panels', id: 'p1' })
    const all = wrapper
      .findAll('button')
      .find((item) => item.text().includes('显示全部'))

    await all?.trigger('click')

    expect(wrapper.text()).toContain('进口')
  })

  it('⚠ 换选中要复位回收窄：收窄才是默认，不是一次性的', async () => {
    const wrapper = mountPane([], false, { kind: 'panels', id: 'p1' })
    await wrapper
      .findAll('button')
      .find((item) => item.text().includes('显示全部'))
      ?.trigger('click')

    await wrapper.setProps({ selection: { kind: 'anchors', id: 'a1' } })

    expect(wrapper.text()).toContain('进口')
    expect(wrapper.text()).not.toContain('泵组 · 温度')
  })

  it('⚠ 选中不取数的东西时退回全部，不是空白一片', () => {
    // 部件与视点没有绑定行；收窄成空会让人以为绑定丢了
    const wrapper = mountPane([], false, { kind: 'parts', id: 'whatever' })

    expect(wrapper.text()).toContain('进口')
    expect(wrapper.text()).toContain('泵组 · 温度')
    expect(wrapper.text()).not.toContain('只看选中的')
  })

  it('选中的信息牌一个字段都没有时，老实说它没有可绑的数据', () => {
    const wrapper = mount(TwinBindingPane, {
      props: {
        config: normalizeTwinConfig({
          panels: [{ id: 'p9', name: '空牌', fields: [] }],
        }),
        bindings: [],
        isDirty: false,
        selection: { kind: 'panels', id: 'p9' },
      },
    })

    expect(wrapper.text()).toContain('没有可绑的数据')
  })
})
