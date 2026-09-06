/**
 * @fileoverview 结果弹窗那一摊：开在哪个节点、详情从哪来、每一路叫什么。
 *
 * ⚠ 详情整份往下传：结果面还要讲解、拟合参数、留没留全量结果与摘要削没削过，
 * 一样一样拆开传就会漏掉其中一样，而漏了的表现是那一块安静地不出现。
 */
import type {
  ModelingGraph,
  ModelingNodeRun,
  ModelingOperator,
} from '@dt/contracts'
import { describe, expect, it } from 'vitest'
import { computed, ref } from 'vue'

import { useResultPanel } from '@/pages/Modeling/Canvas/scripts/useResultPanel'

const GRAPH: ModelingGraph = {
  format_version: '1',
  nodes: [
    {
      id: 'n1',
      operator: 'split_dataset',
      alias: '',
      position: { left: 0, top: 0 },
      config: { test_ratio: 0.4 },
    },
  ],
  edges: [],
}

/** 运行时冻结的那份图：同一个节点上的参数与画布上那份**不一样**。 */
const FROZEN: ModelingGraph = {
  ...GRAPH,
  nodes: GRAPH.nodes.map((one) => ({ ...one, config: { test_ratio: 0.2 } })),
}

const SPLIT: ModelingOperator = {
  code: 'split_dataset',
  name: '切分',
  description: '',
  category: 'model',
  spec_version: '1',
  icon: 'table',
  inputs: [],
  outputs: [
    {
      name: 'train',
      contract: 'frame',
      label: '训练集',
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

const DETAIL: ModelingNodeRun = {
  node_id: 'n1',
  operator: 'split_dataset',
  alias: null,
  ordinal: 1,
  status: 'succeeded',
  duration_ms: 3,
  has_preview: true,
  error_text: null,
  preview: { train: { kind: 'frame' } },
  is_preview_truncated: true,
  exported_ports: ['train'],
  report: { blocks: [] },
  fitted: { coef: {} },
}

function panelOf(
  detail: ModelingNodeRun | undefined,
  runGraph: ModelingGraph | null = FROZEN,
) {
  const loaded: string[] = []
  const panel = useResultPanel({
    graph: ref(GRAPH),
    runGraph: () => runGraph,
    operators: computed(() => new Map([['split_dataset', SPLIT]])),
    nodeRunOf: () => detail,
    loadPreview: (id: string) => {
      loaded.push(id)
      return Promise.resolve()
    },
  })
  return { panel, loaded }
}

describe('结果弹窗那一摊', () => {
  it('没开在任何节点上时详情是空的', () => {
    const { panel } = panelOf(DETAIL)

    expect(panel.nodeId.value).toBeNull()
    expect(panel.detail.value).toBeNull()
  })

  it('开一个节点会去拉它的详情', async () => {
    const { panel, loaded } = panelOf(DETAIL)

    await panel.open('n1')

    expect(loaded).toEqual(['n1'])
    expect(panel.detail.value).toBe(DETAIL)
  })

  // ⚠ 讲解、拟合参数、留没留全量、摘要削没削，一样都不能在这一层丢掉
  it('详情整份交出去，不是只交摘要', async () => {
    const { panel } = panelOf(DETAIL)

    await panel.open('n1')

    expect(panel.detail.value?.report).toEqual({ blocks: [] })
    expect(panel.detail.value?.fitted).toEqual({ coef: {} })
    expect(panel.detail.value?.exported_ports).toEqual(['train'])
    expect(panel.detail.value?.is_preview_truncated).toBe(true)
  })

  it('还没拉回来时是 null，不是一份空详情', async () => {
    const { panel } = panelOf(undefined)

    await panel.open('n1')

    expect(panel.detail.value).toBeNull()
  })

  // ⚠ 印裸端口名的话，「train」「scored」读不出那是什么
  it('端口标签取算子声明的中文名', async () => {
    const { panel } = panelOf(DETAIL)

    await panel.open('n1')

    expect(panel.labels.value).toEqual({ train: '训练集' })
  })

  it('关掉之后不再指着任何节点', async () => {
    const { panel } = panelOf(DETAIL)

    await panel.open('n1')
    panel.close()

    expect(panel.nodeId.value).toBeNull()
    expect(panel.labels.value).toEqual({})
  })
})

describe('公式代实参用的那份参数', () => {
  // ⚠ 取的是运行时冻结的那张图：拿画布上现在这份的话，改过参数再回看历史，
  // 公式会照新参数印出一串看着完全正常的假账（规格 §6）
  it('取的是这次运行冻结的那份，不是画布上现在那份', async () => {
    const { panel } = panelOf(DETAIL)
    await panel.open('n1')

    expect(panel.config.value).toEqual({ test_ratio: 0.2 })
  })

  it('没开在任何节点上时是空的', () => {
    expect(panelOf(DETAIL).panel.config.value).toEqual({})
  })

  it('还没跑过（没有冻结图）时是空的，不退回画布那份', async () => {
    const { panel } = panelOf(DETAIL, null)
    await panel.open('n1')

    expect(panel.config.value).toEqual({})
  })

  it('冻结图里没有这个节点时是空的', async () => {
    const { panel } = panelOf(DETAIL)
    await panel.open('n2')

    expect(panel.config.value).toEqual({})
  })
})
