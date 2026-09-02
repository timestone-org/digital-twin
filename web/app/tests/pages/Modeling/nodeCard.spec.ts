/**
 * @fileoverview 节点卡片：每个端口一个具名接点、错误摘要、卡片上那行结果数字，
 * 以及拉线时兼容端口要看得出来。
 */
import type { ModelingGraphNode, ModelingOperator } from '@dt/contracts'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import ModelingNode from '@/pages/Modeling/Canvas/components/ModelingNode.vue'
import {
  PORT_NAME_ATTR,
  PORT_SIDE_ATTR,
} from '@/pages/Modeling/Canvas/scripts/portHits'
import type { NodeRunState } from '@/pages/Modeling/Canvas/scripts/nodeState'

function spec(): ModelingOperator {
  const port = (name: string) => ({
    name,
    contract: 'frame',
    label: name,
    is_required: true,
    description: '',
  })
  return {
    code: 'join',
    name: '两表相接',
    description: '',
    category: 'preprocess',
    spec_version: '1',
    icon: 'workflow',
    inputs: [port('left'), port('right')],
    outputs: [port('out')],
    config_schema: {},
    fit_required: false,
    serving_enabled: false,
    serving_window_required: false,
    serving_channel: 'json',
  }
}

const NODE: ModelingGraphNode = {
  id: 'n1',
  operator: 'join',
  alias: '',
  position: { left: 0, top: 0 },
  config: {},
}

interface Over {
  spec?: ModelingOperator | undefined
  state?: NodeRunState
  errorText?: string
  headline?: string
  hasResult?: boolean
  openPorts?: ReadonlySet<string> | null
  node?: ModelingGraphNode
}

function open(over: Over = {}) {
  return mount(ModelingNode, {
    props: {
      node: over.node ?? NODE,
      spec: 'spec' in over ? over.spec : spec(),
      state: over.state ?? 'idle',
      isSelected: false,
      isReadonly: false,
      errorText: over.errorText ?? '',
      headline: over.headline ?? '',
      hasResult: over.hasResult ?? false,
      openPorts: over.openPorts ?? null,
    },
  })
}

describe('节点卡片', () => {
  it('每个端口一个具名接点，多输入算子分得清主副', () => {
    const names = open()
      .findAll(`[${PORT_NAME_ATTR}]`)
      .map((el) => el.attributes(PORT_NAME_ATTR))

    expect(names).toEqual(['left', 'right', 'out'])
  })

  it('入口与出口分得开，命中测试才认得出方向', () => {
    const sides = open()
      .findAll(`[${PORT_SIDE_ATTR}]`)
      .map((el) => el.attributes(PORT_SIDE_ATTR))

    expect(sides).toEqual(['in', 'in', 'out'])
  })

  it('失败时把后端那句错误显示在卡片上', () => {
    const wrapper = open({
      state: 'failed',
      errorText: '台账 energy_log 不存在',
    })

    expect(wrapper.text()).toContain('台账 energy_log 不存在')
    expect(wrapper.classes()).toContain('dt-ml-node--failed')
  })

  it('没有结果时不给「结果」那颗键', () => {
    expect(open({ state: 'succeeded' }).text()).not.toContain('结果')
  })

  it('认不出算子时用节点自己的 operator 顶上，不显示成空标题', () => {
    expect(open({ spec: undefined }).text()).toContain('join')
  })

  it('改过名就显示改的那个名字', () => {
    const wrapper = open({ node: { ...NODE, alias: '剔除异常行' } })

    expect(wrapper.text()).toContain('剔除异常行')
    expect(wrapper.text()).not.toContain('两表相接')
  })

  it('跑完之后那行数字直接印在卡片上，不用点开弹窗', () => {
    expect(
      open({ state: 'succeeded', headline: '1,200 行 × 8 列' }).text(),
    ).toContain('1,200 行 × 8 列')
  })

  it('有错误时错误优先，不与结果数字挤在一起', () => {
    const wrapper = open({
      state: 'failed',
      errorText: '目标列必须是数值列',
      headline: '1,200 行 × 8 列',
    })

    expect(wrapper.text()).toContain('目标列必须是数值列')
    expect(wrapper.text()).not.toContain('1,200 行')
  })

  it('双击卡片就是看参数——最常用的那一下不该只能点小按钮', async () => {
    const wrapper = open()

    await wrapper.trigger('dblclick')

    expect(wrapper.emitted('openConfig')).toHaveLength(1)
  })

  it('拉线时接得住的口高亮、接不住的口变淡', () => {
    const wrapper = open({ openPorts: new Set(['in:left']) })

    const ports = wrapper.findAll(`[${PORT_NAME_ATTR}]`)
    expect(ports[0]?.classes()).toContain('dt-ml-node__port--open')
    expect(ports[1]?.classes()).toContain('dt-ml-node__port--shut')
    expect(ports[2]?.classes()).toContain('dt-ml-node__port--shut')
  })

  it('没在拉线时所有口都是常态，不平白变淡', () => {
    const ports = open().findAll(`[${PORT_NAME_ATTR}]`)

    expect(ports[0]?.classes()).not.toContain('dt-ml-node__port--shut')
    expect(ports[0]?.classes()).not.toContain('dt-ml-node__port--open')
  })
})
