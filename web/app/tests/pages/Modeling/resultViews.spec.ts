/**
 * @fileoverview 结果视图与节点卡片：按 kind 派发、截断要说出来、空值不显示成
 * 空白，以及节点上每个端口一个具名接点。
 */
import type { ModelingGraphNode, ModelingOperator } from '@dt/contracts'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import ModelingNode from '@/pages/Modeling/Canvas/components/ModelingNode.vue'
import ResultView from '@/pages/Modeling/Canvas/components/ResultView.vue'
import {
  PORT_NAME_ATTR,
  PORT_SIDE_ATTR,
} from '@/pages/Modeling/Canvas/scripts/useCanvasWiring'

const FRAME = {
  kind: 'frame',
  shape: { rows: 500, cols: 2 },
  columns: [
    {
      key: 'power',
      name: '功率',
      dtype: 'number',
      role: 'feature',
      unit: 'kW',
      null_ratio: 0.5,
      n_unique: 3,
      min: 1,
      max: 9,
      mean: 5,
      p50: 4,
    },
  ],
  index_name: '时刻',
  index_head: ['2026-01-01T00:00:00Z'],
  head: [[null]],
  rows_truncated: true,
  cols_truncated: false,
}

describe('结果视图按 kind 派发', () => {
  it('帧：形状与截断都写在页面上', () => {
    const wrapper = mount(ResultView, { props: { payload: FRAME } })

    expect(wrapper.text()).toContain('500 行 × 2 列')
    expect(wrapper.text()).toContain('只显示了开头这几行')
  })

  it('帧：空值显示成「—」而不是一格空白', () => {
    const wrapper = mount(ResultView, { props: { payload: FRAME } })

    expect(wrapper.text()).toContain('—')
  })

  it('模型：没训练出来的要明说下游用不了', () => {
    const wrapper = mount(ResultView, {
      props: {
        payload: {
          kind: 'model',
          algo: 'linear',
          task: 'regression',
          hyper_params: {},
          feature_keys: [],
          target_key: '',
          serving_channel: 'json',
          fitted: false,
        },
      },
    })

    expect(wrapper.text()).toContain('还没有训练出模型')
  })

  it('评估：指标名换成中文口径，散点也画出来', () => {
    const wrapper = mount(ResultView, {
      props: {
        payload: {
          kind: 'metrics',
          task: 'regression',
          metrics: { r2: 0.9 },
          pairs: [
            [1, 1.1],
            [2, 1.9],
          ],
          pairs_truncated: false,
        },
      },
    })

    expect(wrapper.text()).toContain('R²')
    expect(wrapper.findAll('circle')).toHaveLength(2)
  })

  it('评估：真值全都一样时不会因为除以 0 画出 NaN', () => {
    const wrapper = mount(ResultView, {
      props: {
        payload: {
          kind: 'metrics',
          task: 'regression',
          metrics: {},
          pairs: [
            [5, 5],
            [5, 5],
          ],
          pairs_truncated: false,
        },
      },
    })

    const cx = wrapper.findAll('circle').map((c) => c.attributes('cx'))
    expect(
      cx.every((value) => value !== undefined && !value.includes('NaN')),
    ).toBe(true)
  })

  it('认不出的 kind 给一句照实的说明，不是一片空白', () => {
    const wrapper = mount(ResultView, {
      props: { payload: { kind: '将来某种', note: '这一步没有摘要' } },
    })

    expect(wrapper.text()).toContain('这一步没有摘要')
  })
})

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

describe('节点卡片', () => {
  it('每个端口一个具名接点，多输入算子分得清主副', () => {
    const wrapper = mount(ModelingNode, {
      props: {
        node: NODE,
        spec: spec(),
        state: 'idle',
        isSelected: false,
        isReadonly: false,
        errorText: '',
        hasResult: false,
      },
    })

    const names = wrapper
      .findAll(`[${PORT_NAME_ATTR}]`)
      .map((el) => el.attributes(PORT_NAME_ATTR))
    expect(names).toEqual(['left', 'right', 'out'])
  })

  it('入口与出口分得开，命中测试才认得出方向', () => {
    const wrapper = mount(ModelingNode, {
      props: {
        node: NODE,
        spec: spec(),
        state: 'idle',
        isSelected: false,
        isReadonly: false,
        errorText: '',
        hasResult: false,
      },
    })

    const sides = wrapper
      .findAll(`[${PORT_SIDE_ATTR}]`)
      .map((el) => el.attributes(PORT_SIDE_ATTR))
    expect(sides).toEqual(['in', 'in', 'out'])
  })

  it('失败时把后端那句错误显示在卡片上', () => {
    const wrapper = mount(ModelingNode, {
      props: {
        node: NODE,
        spec: spec(),
        state: 'failed',
        isSelected: false,
        isReadonly: false,
        errorText: '台账 energy_log 不存在',
        hasResult: false,
      },
    })

    expect(wrapper.text()).toContain('台账 energy_log 不存在')
    expect(wrapper.classes()).toContain('dt-ml-node--failed')
  })

  it('没有结果时不给「结果」那颗键', () => {
    const wrapper = mount(ModelingNode, {
      props: {
        node: NODE,
        spec: spec(),
        state: 'succeeded',
        isSelected: false,
        isReadonly: false,
        errorText: '',
        hasResult: false,
      },
    })

    expect(wrapper.text()).not.toContain('结果')
  })

  it('认不出算子时用节点自己的 operator 顶上，不显示成空标题', () => {
    const wrapper = mount(ModelingNode, {
      props: {
        node: NODE,
        spec: undefined,
        state: 'idle',
        isSelected: false,
        isReadonly: false,
        errorText: '',
        hasResult: false,
      },
    })

    expect(wrapper.text()).toContain('join')
  })
})
