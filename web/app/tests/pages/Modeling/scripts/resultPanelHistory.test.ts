/** @fileoverview 历史结果端口标签必须按冻结的算子身份读取。 */
import type { ModelingGraph, ModelingOperator } from '@dt/contracts'
import { describe, expect, it } from 'vitest'
import { computed, ref } from 'vue'

import { useResultPanel } from '@/pages/Modeling/Canvas/scripts/useResultPanel'

function graph(operator: string): ModelingGraph {
  return {
    format_version: '1.0',
    nodes: [
      {
        id: 'node',
        operator,
        alias: '',
        config: {},
        position: { left: 0, top: 0 },
      },
    ],
    edges: [],
  }
}

function operator(code: string, label: string): ModelingOperator {
  return {
    code,
    name: code,
    description: '',
    category: 'model',
    spec_version: '1',
    icon: 'table',
    inputs: [],
    outputs: [
      {
        name: 'frame',
        contract: 'frame@v1',
        label,
        is_required: true,
        description: '',
      },
    ],
    config_schema: {},
    fit_required: false,
    serving_enabled: false,
    serving_window_required: false,
    serving_channel: 'json',
  }
}

describe('历史结果端口标签', () => {
  it('编辑图改过同一节点的算子后仍使用运行快照中的输出标签', async () => {
    const panel = useResultPanel({
      graph: ref(graph('new_operator')),
      runGraph: () => graph('old_operator'),
      operators: computed(
        () =>
          new Map([
            ['old_operator', operator('old_operator', '历史输出')],
            ['new_operator', operator('new_operator', '当前输出')],
          ]),
      ),
      nodeRunOf: () => undefined,
      loadPreview: () => Promise.resolve(),
    })
    await panel.open('node')
    expect(panel.labels.value).toEqual({ frame: '历史输出' })
  })
})
