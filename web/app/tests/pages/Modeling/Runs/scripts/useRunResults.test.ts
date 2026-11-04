/** @fileoverview 历史训练结果的冻结来源、步骤选择及关闭/切换竞态。 */
import type {
  ModelingNodeRun,
  ModelingNodeRunSummary,
  ModelingOperator,
  ModelingRun,
} from '@dt/contracts'
import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { defineComponent, h, ref } from 'vue'
import * as api from '@/api/modeling'
import { BizError } from '@/api/client'
import { useRunResults } from '@/pages/Modeling/Runs/scripts/useRunResults'

const STAMP = '2026-11-03T00:00:00Z'
const wrappers: VueWrapper[] = []
const OPERATOR: ModelingOperator = {
  code: 'regression_metrics',
  name: '回归评估',
  description: '',
  category: 'model',
  spec_version: '1.0',
  icon: 'activity',
  inputs: [],
  outputs: [],
  config_schema: {},
  fit_required: false,
  serving_enabled: false,
  serving_window_required: false,
  serving_channel: 'json',
}
function summary(nodeId: string, ordinal: number): ModelingNodeRunSummary {
  return {
    node_id: nodeId,
    operator: 'regression_metrics',
    alias: nodeId,
    ordinal,
    status: 'succeeded',
    duration_ms: 10,
    has_preview: true,
    error_text: null,
  }
}
function run(runId: string): ModelingRun {
  const ratio = runId === 'run1' ? 0.2 : 0.8
  return {
    id: runId,
    pipeline_id: 'same-workflow',
    instance_id: null,
    published_version_id: null,
    auto_publish: false,
    publication_status: 'not_requested',
    publication_error: null,
    status: 'succeeded',
    trigger: 'manual',
    started_at: STAMP,
    finished_at: STAMP,
    duration_ms: 20,
    row_count: 7,
    is_source_truncated: false,
    is_keeping_frames: false,
    error_text: null,
    created_by_name: null,
    created_at: STAMP,
    nodes: [summary('evaluate', 1), summary('baseline', 0)],
    graph: {
      format_version: '1.0',
      edges: [],
      nodes: ['baseline', 'evaluate'].map((nodeId) => ({
        id: nodeId,
        operator: 'regression_metrics',
        alias: `${runId}-${nodeId}`,
        position: { left: 0, top: 0 },
        config: { marker: `${runId}-${nodeId}`, test_ratio: ratio },
      })),
    },
  }
}
function detail(runId: string, nodeId = 'evaluate'): ModelingNodeRun {
  const metric = runId === 'run1' ? 100 : 200
  return {
    ...summary(nodeId, nodeId === 'evaluate' ? 1 : 0),
    preview: {
      metrics: {
        kind: 'metrics',
        task: 'regression',
        metrics: { mae: metric },
      },
    },
    is_preview_truncated: false,
    exported_ports: [],
    report: null,
    fitted: null,
  }
}
function deferred<TResult>() {
  let resolve: ((value: TResult) => void) | undefined
  const promise = new Promise<TResult>((finish) => {
    resolve = finish
  })
  return {
    promise,
    resolve(value: TResult): void {
      if (!resolve) throw new Error('未创建异步结果')
      resolve(value)
    },
  }
}
function open(initialId: string | null = 'run1') {
  const runId = ref(initialId)
  const wrapper = mount(
    defineComponent({
      setup() {
        return { results: useRunResults(() => runId.value) }
      },
      render: () => h('div'),
    }),
  )
  wrappers.push(wrapper)
  return {
    runId,
    results: wrapper.vm.results,
    unmount() {
      wrapper.unmount()
      wrappers.splice(wrappers.indexOf(wrapper), 1)
    },
  }
}
beforeEach(() => {
  vi.spyOn(api, 'getModelingRun').mockImplementation((id) =>
    Promise.resolve(run(id)),
  )
  vi.spyOn(api, 'getModelingNodeRun').mockImplementation((id, nodeId) =>
    Promise.resolve(detail(id, nodeId)),
  )
  vi.spyOn(api, 'listModelingOperators').mockResolvedValue([OPERATOR])
  vi.spyOn(api, 'getModelingPipeline').mockRejectedValue(
    new Error('禁止读取当前工作流'),
  )
})
afterEach(() => {
  for (const wrapper of wrappers) wrapper.unmount()
  wrappers.length = 0
  vi.restoreAllMocks()
})

it('按本次运行读取最后有摘要步骤，步骤排序和配置只来自冻结图', async () => {
  const host = open()
  await flushPromises()
  expect(api.getModelingRun).toHaveBeenCalledWith(
    'run1',
    expect.any(AbortSignal),
  )
  expect(api.getModelingNodeRun).toHaveBeenCalledWith(
    'run1',
    'evaluate',
    expect.any(AbortSignal),
  )
  expect(host.results.nodes.value.map((node) => node.node_id)).toEqual([
    'baseline',
    'evaluate',
  ])
  expect(host.results.nodeId.value).toBe('evaluate')
  expect(host.results.node.value?.preview).toEqual(detail('run1').preview)
  expect(host.results.config.value).toEqual({
    marker: 'run1-evaluate',
    test_ratio: 0.2,
  })
  expect(host.results.operator.value?.name).toBe('回归评估')
  expect(api.getModelingPipeline).not.toHaveBeenCalled()
})
it('快速切换运行时迟到的旧RunOut不能恢复旧记录或启动其节点读取', async () => {
  const older = deferred<ModelingRun>()
  let oldSignal: AbortSignal | undefined
  vi.mocked(api.getModelingRun).mockImplementationOnce((_id, signal) => {
    oldSignal = signal
    return older.promise
  })
  const host = open()
  host.runId.value = 'run2'
  await flushPromises()
  older.resolve(run('run1'))
  await flushPromises()
  expect(oldSignal?.aborted).toBe(true)
  expect(host.results.run.value?.id).toBe('run2')
  expect(host.results.config.value).toEqual({
    marker: 'run2-evaluate',
    test_ratio: 0.8,
  })
  expect(api.getModelingNodeRun).not.toHaveBeenCalledWith(
    'run1',
    expect.any(String),
    expect.any(AbortSignal),
  )
})
it('旧运行节点100迟到时不能覆盖新运行200或其配置', async () => {
  const older = deferred<ModelingNodeRun>()
  let oldSignal: AbortSignal | undefined
  vi.mocked(api.getModelingNodeRun).mockImplementationOnce(
    (_id, _node, signal) => {
      oldSignal = signal
      return older.promise
    },
  )
  const host = open()
  await flushPromises()
  host.runId.value = 'run2'
  await flushPromises()
  expect(host.results.node.value?.preview).toEqual(detail('run2').preview)
  older.resolve(detail('run1'))
  await flushPromises()
  expect(oldSignal?.aborted).toBe(true)
  expect(host.results.node.value?.preview).toEqual(detail('run2').preview)
  expect(host.results.config.value).toEqual({
    marker: 'run2-evaluate',
    test_ratio: 0.8,
  })
})
it('快速切换步骤时丢弃旧详情，当前步骤与冻结参数保持一致', async () => {
  const older = deferred<ModelingNodeRun>()
  let oldSignal: AbortSignal | undefined
  vi.mocked(api.getModelingNodeRun).mockImplementationOnce(
    (_id, _node, signal) => {
      oldSignal = signal
      return older.promise
    },
  )
  const host = open()
  await flushPromises()
  await host.results.selectNode('baseline')
  older.resolve(detail('run1'))
  await flushPromises()
  expect(oldSignal?.aborted).toBe(true)
  expect(host.results.nodeId.value).toBe('baseline')
  expect(host.results.node.value?.node_id).toBe('baseline')
  expect(host.results.config.value).toEqual({
    marker: 'run1-baseline',
    test_ratio: 0.2,
  })
})
it('关闭为空运行时取消节点与目录在途请求，并清除所有迟到结果', async () => {
  const node = deferred<ModelingNodeRun>()
  const catalog = deferred<ModelingOperator[]>()
  let nodeSignal: AbortSignal | undefined
  let catalogSignal: AbortSignal | undefined
  vi.mocked(api.getModelingNodeRun).mockImplementationOnce(
    (_id, _node, signal) => {
      nodeSignal = signal
      return node.promise
    },
  )
  vi.mocked(api.listModelingOperators).mockImplementationOnce((signal) => {
    catalogSignal = signal
    return catalog.promise
  })
  const host = open()
  await flushPromises()
  host.runId.value = null
  await flushPromises()
  node.resolve(detail('run1'))
  catalog.resolve([OPERATOR])
  await flushPromises()
  expect(nodeSignal?.aborted).toBe(true)
  expect(catalogSignal?.aborted).toBe(true)
  expect(host.results.run.value).toBeNull()
  expect(host.results.node.value).toBeNull()
  expect(host.results.operators.value).toEqual([])
  expect(host.results.config.value).toEqual({})
})
it('卸载会取消运行和目录读取，迟到运行不得继续读取节点', async () => {
  const older = deferred<ModelingRun>()
  const catalog = deferred<ModelingOperator[]>()
  let runSignal: AbortSignal | undefined
  let catalogSignal: AbortSignal | undefined
  vi.mocked(api.getModelingRun).mockImplementationOnce((_id, signal) => {
    runSignal = signal
    return older.promise
  })
  vi.mocked(api.listModelingOperators).mockImplementationOnce((signal) => {
    catalogSignal = signal
    return catalog.promise
  })
  const host = open()
  host.unmount()
  older.resolve(run('run1'))
  catalog.resolve([OPERATOR])
  await flushPromises()
  expect(runSignal?.aborted).toBe(true)
  expect(catalogSignal?.aborted).toBe(true)
  expect(host.results.run.value).toBeNull()
  expect(host.results.operators.value).toEqual([])
  expect(api.getModelingNodeRun).not.toHaveBeenCalled()
})
it('失败且无摘要步骤仍读取详情，404明确报错且重试不受has_preview阻断', async () => {
  const failed: ModelingNodeRunSummary = {
    ...summary('evaluate', 0),
    status: 'failed',
    has_preview: false,
    error_text: '参数无效',
  }
  vi.mocked(api.getModelingRun).mockResolvedValueOnce({
    ...run('run1'),
    nodes: [failed],
  })
  vi.mocked(api.getModelingNodeRun).mockRejectedValueOnce(
    new BizError(41408, '节点结果不存在', 404, 'trace'),
  )
  const host = open()
  await flushPromises()
  expect(api.getModelingNodeRun).toHaveBeenCalledWith(
    'run1',
    'evaluate',
    expect.any(AbortSignal),
  )
  expect(host.results.nodeError.value).toBe('节点结果不存在')
  expect(host.results.nodeLoading.value).toBe(false)
  const failedDetail: ModelingNodeRun = {
    ...detail('run1'),
    ...failed,
    preview: {},
  }
  vi.mocked(api.getModelingNodeRun).mockResolvedValueOnce(failedDetail)
  await host.results.refreshNode()
  expect(host.results.node.value).toEqual(failedDetail)
  expect(host.results.nodeError.value).toBe('')
})
it('算子目录独立失败不阻断运行、节点与冻结配置', async () => {
  vi.mocked(api.listModelingOperators).mockRejectedValueOnce(
    new Error('catalog offline'),
  )
  const host = open()
  await flushPromises()
  expect(host.results.catalogError.value).not.toBe('')
  expect(host.results.error.value).toBe('')
  expect(host.results.run.value?.id).toBe('run1')
  expect(host.results.node.value?.preview).toEqual(detail('run1').preview)
  expect(host.results.config.value).toEqual({
    marker: 'run1-evaluate',
    test_ratio: 0.2,
  })
  expect(host.results.operator.value).toBeUndefined()
})
