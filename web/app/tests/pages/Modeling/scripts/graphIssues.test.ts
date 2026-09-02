/**
 * @fileoverview 问题清单的显示口径，以及顶栏那句进度。
 */
import type {
  ModelingGraph,
  ModelingOperator,
  ModelingRun,
} from '@dt/contracts'
import { describe, expect, it } from 'vitest'

import { issueViewsOf } from '@/pages/Modeling/Canvas/scripts/graphIssues'
import { progressOf } from '@/pages/Modeling/Canvas/scripts/runProgress'

const GRAPH: ModelingGraph = {
  format_version: '1',
  nodes: [
    {
      id: 'n1',
      operator: 'ledger_source',
      alias: '',
      position: { left: 0, top: 0 },
      config: {},
    },
    {
      id: 'n2',
      operator: 'ledger_source',
      alias: '起个名',
      position: { left: 0, top: 0 },
      config: {},
    },
  ],
  edges: [],
}

const OPERATORS = new Map<string, ModelingOperator>([
  [
    'ledger_source',
    {
      code: 'ledger_source',
      name: '台账取数',
      description: '',
      category: 'source',
      spec_version: '1',
      icon: 'table',
      inputs: [],
      outputs: [],
      config_schema: {},
      fit_required: false,
      serving_enabled: false,
      serving_window_required: false,
      serving_channel: '',
    },
  ],
])

function issue(over: Partial<{ message: string; node_id: string }> = {}) {
  return { message: '这一步有问题', node_id: '', edge_id: '', ...over }
}

describe('问题清单落在哪张卡片上', () => {
  it('点名的是卡片的显示名，没起名就用算子名', () => {
    const views = issueViewsOf(
      [issue({ node_id: 'n1' }), issue({ node_id: 'n2' })],
      GRAPH,
      OPERATORS,
    )

    expect(views.map((item) => item.where)).toEqual(['台账取数', '起个名'])
  })

  it('整图级问题没有落点，不给一个点不动的卡片名', () => {
    expect(issueViewsOf([issue()], GRAPH, OPERATORS)[0]?.where).toBe('')
  })

  it('已经不在图里的节点不硬凑一个名字', () => {
    const views = issueViewsOf([issue({ node_id: 'gone' })], GRAPH, OPERATORS)

    expect(views[0]?.where).toBe('')
  })

  // ⚠ key 不能用下标：删中间一条会让其余整体错位
  it('同一张卡片上的两条同样的问题，key 仍然各不相同', () => {
    const views = issueViewsOf(
      [issue({ node_id: 'n1' }), issue({ node_id: 'n1' })],
      GRAPH,
      OPERATORS,
    )

    expect(views[0]?.key).not.toBe(views[1]?.key)
  })
})

function run(over: Partial<ModelingRun>): ModelingRun {
  return {
    id: 'r1',
    pipeline_id: 'p1',
    status: 'running',
    trigger: 'manual',
    graph: GRAPH,
    row_count: null,
    is_source_truncated: false,
    error_text: null,
    duration_ms: null,
    created_by_name: null,
    created_at: '2026-01-01T00:00:00.000Z',
    started_at: null,
    finished_at: null,
    nodes: [],
    ...over,
  }
}

describe('顶栏的运行进度', () => {
  it('不在跑时不占位', () => {
    expect(progressOf(null, new Date())).toBe('')
    expect(progressOf(run({ status: 'succeeded' }), new Date())).toBe('')
  })

  it('还没开跑时只报第几个节点，不报一个假的耗时', () => {
    const nodes = [
      {
        node_id: 'n1',
        operator: 'ledger_source',
        alias: null,
        ordinal: 0,
        status: 'succeeded' as const,
        duration_ms: 10,
        has_preview: true,
        error_text: null,
      },
      {
        node_id: 'n2',
        operator: 'ledger_source',
        alias: null,
        ordinal: 1,
        status: 'running' as const,
        duration_ms: null,
        has_preview: false,
        error_text: null,
      },
    ]

    expect(progressOf(run({ nodes }), new Date())).toBe('第 2/2 个节点')
  })
})
