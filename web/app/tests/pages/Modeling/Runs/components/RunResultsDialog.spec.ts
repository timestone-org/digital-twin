/** @fileoverview 历史结果只使用所选运行的摘要、节点详情与冻结参数。 */
import type {
  ModelingNodeRun,
  ModelingOperator,
  ModelingRun,
} from '@dt/contracts'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, expect, it, vi } from 'vitest'
import { DtSelect } from '@dt/ui'
import { BizError } from '@/api/client'
import * as modeling from '@/api/modeling'
import ResultView from '@/pages/Modeling/Canvas/components/ResultView.vue'
import RunResultsDialog from '@/pages/Modeling/Runs/components/RunResultsDialog.vue'
const STAMP = '2026-11-03T01:00:00Z'
function run(id: string, marker: string): ModelingRun {
  return {
    id,
    pipeline_id: 'workflow',
    status: 'succeeded',
    trigger: 'manual',
    started_at: STAMP,
    finished_at: STAMP,
    duration_ms: 1200,
    row_count: 120,
    is_source_truncated: false,
    is_keeping_frames: false,
    error_text: null,
    created_by_name: '分析员',
    created_at: STAMP,
    graph: {
      format_version: '1.0',
      nodes: [
        {
          id: 'evaluation',
          operator: 'regression_metrics',
          alias: '本次评估',
          config: { marker },
          position: { left: 0, top: 0 },
        },
      ],
      edges: [],
    },
    nodes: [
      {
        node_id: 'evaluation',
        operator: 'regression_metrics',
        alias: '本次评估',
        ordinal: 2,
        status: 'succeeded',
        duration_ms: 20,
        has_preview: true,
        error_text: null,
      },
    ],
  }
}
function node(metric: number): ModelingNodeRun {
  return {
    node_id: 'evaluation',
    operator: 'regression_metrics',
    alias: '本次评估',
    ordinal: 2,
    status: 'succeeded',
    duration_ms: 20,
    has_preview: true,
    error_text: null,
    preview: {
      metrics: {
        kind: 'metrics',
        task: 'regression',
        metrics: { mae: metric },
        pairs: [],
        pairs_truncated: false,
        residual_bins: [],
      },
    },
    is_preview_truncated: false,
    exported_ports: [],
    report: null,
    fitted: null,
  }
}
afterEach(() => vi.restoreAllMocks())
it('旧run1与run2分别展示100和200，参数严格来自各自冻结图', async () => {
  const first = run('old-run-1', 'frozen-one')
  const second = run('old-run-2', 'frozen-two')
  vi.spyOn(modeling, 'getModelingRun').mockImplementation((id) =>
    Promise.resolve(id === first.id ? first : second),
  )
  vi.spyOn(modeling, 'getModelingNodeRun').mockImplementation((id) =>
    Promise.resolve(node(id === first.id ? 100 : 200)),
  )
  vi.spyOn(modeling, 'listModelingOperators').mockResolvedValue([])
  const currentPipeline = vi.spyOn(modeling, 'getModelingPipeline')
  const wrapper = mount(RunResultsDialog, {
    props: { run: first, pipelineName: '能耗工作流' },
    global: { stubs: { teleport: true } },
  })
  await flushPromises()
  expect(wrapper.get('.dt-ml-metrics__list').text()).toContain('100')
  expect(wrapper.get('[aria-label="本次评估关键指标"]').text()).toContain('100')
  expect(wrapper.getComponent(ResultView).props('config')).toEqual({
    marker: 'frozen-one',
  })
  await wrapper.setProps({ run: second })
  await flushPromises()
  expect(wrapper.get('.dt-ml-metrics__list').text()).toContain('200')
  expect(wrapper.get('.dt-ml-metrics__list').text()).not.toContain('100')
  expect(wrapper.get('[aria-label="本次评估关键指标"]').text()).toContain('200')
  expect(wrapper.get('[aria-label="本次评估关键指标"]').text()).not.toContain(
    '100',
  )
  expect(wrapper.getComponent(ResultView).props('config')).toEqual({
    marker: 'frozen-two',
  })
  expect(currentPipeline).not.toHaveBeenCalled()
  expect(modeling.getModelingNodeRun).toHaveBeenLastCalledWith(
    'old-run-2',
    'evaluation',
    expect.any(AbortSignal),
  )
  wrapper.unmount()
})

function summary(
  nodeId: string,
  ordinal: number,
  hasPreview = true,
): ModelingRun['nodes'][number] {
  return {
    node_id: nodeId,
    operator: 'regression_metrics',
    alias: nodeId,
    ordinal,
    status: 'succeeded',
    duration_ms: 20,
    has_preview: hasPreview,
    error_text: null,
  }
}
function withNodes(
  history: ModelingRun,
  nodes: ModelingRun['nodes'],
): ModelingRun {
  return {
    ...history,
    nodes,
    graph: {
      ...history.graph,
      nodes: nodes.map((step) => ({
        id: step.node_id,
        operator: step.operator,
        alias: step.alias ?? '',
        config: { marker: history.id, step: step.node_id },
        position: { left: 0, top: 0 },
      })),
    },
  }
}
function open(history: ModelingRun) {
  return mount(RunResultsDialog, {
    props: { run: history, pipelineName: '能耗工作流' },
    global: { stubs: { teleport: true } },
  })
}
function mockReads(history: ModelingRun) {
  vi.spyOn(modeling, 'getModelingRun').mockResolvedValue(history)
  vi.spyOn(modeling, 'getModelingNodeRun').mockResolvedValue(node(100))
  vi.spyOn(modeling, 'listModelingOperators').mockResolvedValue([])
}
it('历史节点全部重合时仍按ordinal选择最后有摘要的评估步骤', async () => {
  const history = withNodes(run('overlap', 'original'), [
    summary('evaluation', 2),
    summary('tail', 3, false),
    summary('source', 0),
    summary('model', 1),
  ])
  mockReads(history)
  const wrapper = open(history)
  await flushPromises()
  const selector = wrapper.getComponent(DtSelect)
  expect(selector.props('modelValue')).toBe('evaluation')
  expect(selector.props('options')).toMatchObject([
    { value: 'source' },
    { value: 'model' },
    { value: 'evaluation' },
    { value: 'tail' },
  ])
  expect(modeling.getModelingNodeRun).toHaveBeenCalledWith(
    'overlap',
    'evaluation',
    expect.any(AbortSignal),
  )
  expect(wrapper.get('.dt-ml-metrics__list').text()).toContain('100')
  expect(wrapper.text()).toContain('未另存全量')
  expect(wrapper.text()).not.toContain('已清理')
  wrapper.unmount()
})
it('算子目录失败只影响说明，历史指标与冻结参数仍可读取', async () => {
  const history = run('catalog-failure', 'frozen')
  mockReads(history)
  vi.mocked(modeling.listModelingOperators).mockRejectedValue(
    new Error('offline'),
  )
  const wrapper = open(history)
  await flushPromises()
  expect(wrapper.text()).toContain('算子说明暂时无法加载')
  expect(wrapper.get('.dt-ml-metrics__list').text()).toContain('100')
  expect(wrapper.getComponent(ResultView).props('config')).toEqual({
    marker: 'frozen',
  })
  wrapper.unmount()
})
it('缺失节点明确显示404错误并允许重试，不推断结果已清理', async () => {
  const history = run('node-error', 'frozen')
  mockReads(history)
  vi.mocked(modeling.getModelingNodeRun)
    .mockRejectedValueOnce(
      new BizError(41408, '找不到本次训练的节点结果', 404, 'trace'),
    )
    .mockResolvedValue(node(100))
  const wrapper = open(history)
  await flushPromises()
  expect(wrapper.text()).toContain('找不到本次训练的节点结果')
  expect(wrapper.text()).not.toContain('已清理')
  await wrapper.get('button[aria-label="重新读取步骤结果"]').trigger('click')
  await flushPromises()
  expect(wrapper.get('.dt-ml-metrics__list').text()).toContain('100')
  wrapper.unmount()
})
it('本次训练没有节点时说明事实且可手动刷新', async () => {
  const history = withNodes(run('empty', 'frozen'), [])
  mockReads(history)
  const wrapper = open(history)
  await flushPromises()
  expect(wrapper.text()).toContain('本次训练没有可读取的节点结果')
  expect(wrapper.text()).not.toContain('已清理')
  expect(modeling.getModelingNodeRun).not.toHaveBeenCalled()
  await wrapper.get('button[aria-label="刷新本次训练结果"]').trigger('click')
  await flushPromises()
  expect(modeling.getModelingRun).toHaveBeenCalledTimes(2)
  wrapper.unmount()
})
it('失败且has_preview=false的步骤也读取详情并呈现错误及空摘要', async () => {
  const failed = {
    ...summary('failure', 0, false),
    status: 'failed' as const,
    error_text: '取数来源不可达',
  }
  const history = {
    ...withNodes(run('failed', 'frozen'), [failed]),
    status: 'failed' as const,
    error_text: '本次训练因取数失败',
  }
  mockReads(history)
  vi.mocked(modeling.getModelingNodeRun).mockResolvedValue({
    ...node(100),
    ...failed,
    preview: {},
    report: null,
  })
  const wrapper = open(history)
  await flushPromises()
  expect(modeling.getModelingNodeRun).toHaveBeenCalledWith(
    'failed',
    'failure',
    expect.any(AbortSignal),
  )
  expect(wrapper.text()).toContain('取数来源不可达')
  expect(wrapper.text()).toContain('本次训练因取数失败')
  expect(wrapper.text()).toContain('此步骤没有可展示的摘要或报告')
  expect(wrapper.find('button[aria-label="重新读取步骤结果"]').exists()).toBe(
    true,
  )
  wrapper.unmount()
})
it('摘要为空但仍有报告时继续呈现报告', async () => {
  const history = run('report-only', 'frozen')
  mockReads(history)
  vi.mocked(modeling.getModelingNodeRun).mockResolvedValue({
    ...node(100),
    preview: {},
    report: {
      blocks: [
        {
          kind: 'rows',
          zone: 'step',
          port: '',
          title: '本次取数概况',
          tier: 0,
          payload: { before: 120, after: 118 },
        },
      ],
      dropped: [],
      note: '',
    },
  })
  const wrapper = open(history)
  await flushPromises()
  expect(wrapper.text()).toContain('本次取数概况')
  expect(wrapper.findComponent(ResultView).exists()).toBe(false)
  expect(wrapper.text()).not.toContain('此步骤没有可展示')
  wrapper.unmount()
})
it('步骤切换复用真实FrameView和ModelView，不要求已保存CSV', async () => {
  const history = withNodes(run('all-kinds', 'frozen'), [
    summary('source', 0),
    summary('model', 1),
    summary('evaluation', 2),
  ])
  mockReads(history)
  vi.mocked(modeling.getModelingNodeRun).mockImplementation((_runId, id) => {
    const base = { ...node(100), node_id: id }
    if (id === 'source')
      return Promise.resolve({
        ...base,
        preview: {
          frame: {
            kind: 'frame',
            shape: { rows: 120, cols: 1 },
            columns: [
              {
                key: 'temperature',
                name: '温度',
                dtype: 'number',
                role: 'feature',
                unit: '℃',
                null_ratio: 0,
                n_unique: 2,
                min: 20,
                max: 30,
                mean: 25,
                p50: 25,
              },
            ],
            index_name: '时刻',
            index_head: [1793667600000],
            head: [[20]],
            rows_truncated: false,
            cols_truncated: false,
            provenance: {
              table_codes: ['energy'],
              since: STAMP,
              until: STAMP,
              is_truncated: false,
            },
          },
        },
      })
    if (id === 'model')
      return Promise.resolve({
        ...base,
        operator: 'linear_regression',
        preview: {
          model: {
            kind: 'model',
            algo: 'linear',
            task: 'regression',
            feature_keys: ['temperature'],
            target_key: 'power',
            hyper_params: {},
            fitted: { coef: { temperature: 3.5 }, intercept: 9 },
            serving_channel: 'json',
          },
        },
      })
    return Promise.resolve(base)
  })
  const wrapper = open(history)
  await flushPromises()
  wrapper.getComponent(DtSelect).vm.$emit('update:modelValue', 'source')
  await flushPromises()
  expect(wrapper.find('.dt-ml-frame').exists()).toBe(true)
  expect(wrapper.find('.run-result-content__metrics').exists()).toBe(false)
  expect(wrapper.text()).toContain('温度')
  wrapper.getComponent(DtSelect).vm.$emit('update:modelValue', 'model')
  await flushPromises()
  expect(wrapper.find('.dt-ml-model').exists()).toBe(true)
  expect(wrapper.find('.run-result-content__metrics').exists()).toBe(false)
  expect(wrapper.text()).toContain('3.5')
  expect(
    wrapper
      .findAll('button')
      .some((button) => button.text() === '下载全量结果'),
  ).toBe(false)
  wrapper.unmount()
})

it('顶层关键指标保留null且按输出端口区分，原有报告仍完整传给ResultView', async () => {
  const history = run('metric-summary', 'frozen')
  mockReads(history)
  const report = {
    blocks: [
      {
        kind: 'rows',
        zone: 'step',
        port: '',
        title: '本次评估说明',
        tier: 0,
        payload: { before: 120, after: 120 },
      },
    ],
    dropped: [],
    note: '',
  }
  const metrics = {
    kind: 'metrics',
    task: 'regression',
    pairs: [],
    pairs_truncated: false,
    residual_bins: [],
  }
  vi.mocked(modeling.getModelingNodeRun).mockResolvedValue({
    ...node(100),
    preview: {
      training: { ...metrics, metrics: { r2: null, mae: 100 } },
      testing: { ...metrics, metrics: { mae: 200 } },
    },
    report,
  })
  const wrapper = open(history)
  await flushPromises()
  const sections = wrapper.findAll('.run-result-content__metrics')
  expect(sections).toHaveLength(2)
  expect(sections[0]?.get('h3').text()).toContain('training')
  expect(
    sections[0]
      ?.findAll('.dt-ml-stats__value .dt-digits__text')
      .map((item) => item.text()),
  ).toEqual(['无定义', '100'])
  expect(sections[1]?.get('h3').text()).toContain('testing')
  expect(
    sections[1]
      ?.findAll('.dt-ml-stats__value .dt-digits__text')
      .map((item) => item.text()),
  ).toEqual(['200'])
  expect(wrapper.getComponent(ResultView).props('report')).toEqual(report)
  expect(wrapper.text()).toContain('本次评估说明')
  wrapper.unmount()
})

function catalogOperator(): ModelingOperator {
  return {
    code: 'regression_metrics',
    name: '回归评估说明',
    description: '评估本次预测',
    category: 'evaluate',
    spec_version: '1',
    icon: 'activity',
    inputs: [],
    outputs: [
      {
        name: 'metrics',
        contract: 'metrics@v1',
        label: '本次指标',
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

it('点击关闭按钮通知父层关闭当前结果面', async () => {
  const history = run('close-action', 'frozen')
  mockReads(history)
  const wrapper = open(history)
  await flushPromises()
  await wrapper.get('button[aria-label="关闭"]').trigger('click')
  expect(wrapper.emitted('close')).toEqual([[]])
  await wrapper.setProps({ run: null })
  await flushPromises()
  expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
  wrapper.unmount()
})

it('实际选择步骤后刷新保留所选步骤并展示新读取结果', async () => {
  const history = withNodes(run('refresh-step', 'frozen'), [
    { ...summary('source', 0), alias: null },
    { ...summary('evaluation', 1), alias: null },
  ])
  mockReads(history)
  vi.mocked(modeling.listModelingOperators).mockResolvedValue([
    catalogOperator(),
  ])
  vi.mocked(modeling.getModelingNodeRun).mockImplementation((_id, nodeId) =>
    Promise.resolve({ ...node(100), node_id: nodeId }),
  )
  const wrapper = open(history)
  await flushPromises()
  await wrapper.get('button[role="combobox"]').trigger('click')
  const option = wrapper
    .findAll('[role="option"]')
    .find((item) => item.text().startsWith('1.'))
  if (!option) throw new Error('缺少第一步选项')
  expect(option.text()).toContain('回归评估说明')
  await option.trigger('click')
  await flushPromises()
  expect(modeling.getModelingNodeRun).toHaveBeenLastCalledWith(
    'refresh-step',
    'source',
    expect.any(AbortSignal),
  )
  vi.mocked(modeling.getModelingRun).mockResolvedValue({
    ...history,
    row_count: 240,
  })
  vi.mocked(modeling.getModelingNodeRun).mockResolvedValue({
    ...node(200),
    node_id: 'source',
  })
  await wrapper.get('button[aria-label="刷新本次训练结果"]').trigger('click')
  await flushPromises()
  expect(wrapper.getComponent(DtSelect).props('modelValue')).toBe('source')
  expect(wrapper.get('.run-results__summary').text()).toContain('240')
  expect(wrapper.get('[aria-label="本次评估关键指标"]').text()).toContain('200')
  expect(wrapper.getComponent(ResultView).props('labels')).toEqual({
    metrics: '本次指标',
  })
  expect(wrapper.getComponent(ResultView).props('operator')).toEqual(
    catalogOperator(),
  )
  wrapper.unmount()
})

it('运行读取失败时实际点击重试重新读取该次训练', async () => {
  const history = run('retry-run', 'frozen')
  mockReads(history)
  vi.mocked(modeling.getModelingRun)
    .mockRejectedValueOnce(
      new BizError(41407, '暂时无法读取这次训练', 503, 'trace'),
    )
    .mockResolvedValue(history)
  const wrapper = open(history)
  await flushPromises()
  expect(wrapper.text()).toContain('暂时无法读取这次训练')
  expect(modeling.getModelingNodeRun).not.toHaveBeenCalled()
  const retry = wrapper
    .findAll('button')
    .find((button) => button.text() === '重试')
  if (!retry) throw new Error('缺少运行重试入口')
  await retry.trigger('click')
  await flushPromises()
  expect(modeling.getModelingRun).toHaveBeenCalledTimes(2)
  expect(wrapper.get('.dt-ml-metrics__list').text()).toContain('100')
  wrapper.unmount()
})

it('实际重试算子目录后补齐说明，不改变本次训练参数或指标', async () => {
  const history = run('retry-catalog', 'frozen')
  mockReads(history)
  vi.mocked(modeling.listModelingOperators)
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValue([catalogOperator()])
  const wrapper = open(history)
  await flushPromises()
  await wrapper.get('button[aria-label="重新加载算子说明"]').trigger('click')
  await flushPromises()
  expect(modeling.listModelingOperators).toHaveBeenCalledTimes(2)
  expect(wrapper.text()).not.toContain('算子说明暂时无法加载')
  expect(wrapper.getComponent(ResultView).props('labels')).toEqual({
    metrics: '本次指标',
  })
  expect(wrapper.getComponent(ResultView).props('config')).toEqual({
    marker: 'frozen',
  })
  expect(wrapper.get('.dt-ml-metrics__list').text()).toContain('100')
  wrapper.unmount()
})

it('空节点的刷新入口能读取后续生成的步骤结果', async () => {
  const pending = {
    ...withNodes(run('pending-empty', 'frozen'), []),
    status: 'pending' as const,
    row_count: null,
  }
  mockReads(pending)
  const wrapper = open(pending)
  await flushPromises()
  expect(wrapper.text()).toContain('本次训练没有可读取的节点结果')
  expect(wrapper.get('.run-results__summary').text()).toContain('未记录')
  vi.mocked(modeling.getModelingRun).mockResolvedValue(
    run('pending-empty', 'frozen'),
  )
  await wrapper.get('button[aria-label="刷新本次训练结果"]').trigger('click')
  await flushPromises()
  expect(wrapper.text()).not.toContain('本次训练没有可读取的节点结果')
  expect(wrapper.get('.dt-ml-metrics__list').text()).toContain('100')
  wrapper.unmount()
})

it('空摘要步骤的重试入口真正重新读取结果', async () => {
  const history = run('empty-step-retry', 'frozen')
  mockReads(history)
  vi.mocked(modeling.getModelingNodeRun)
    .mockResolvedValueOnce({ ...node(100), preview: {}, report: null })
    .mockResolvedValue(node(200))
  const wrapper = open(history)
  await flushPromises()
  expect(wrapper.text()).toContain('此步骤没有可展示的摘要或报告')
  await wrapper.get('button[aria-label="重新读取步骤结果"]').trigger('click')
  await flushPromises()
  expect(modeling.getModelingNodeRun).toHaveBeenCalledTimes(2)
  expect(wrapper.get('[aria-label="本次评估关键指标"]').text()).toContain('200')
  wrapper.unmount()
})

it('只在本次训练真实标记取数截断时显示数据范围说明', async () => {
  const truncated = {
    ...run('truncated', 'frozen'),
    is_source_truncated: true,
  }
  const complete = run('complete', 'frozen')
  mockReads(truncated)
  vi.mocked(modeling.getModelingRun).mockImplementation((id) =>
    Promise.resolve(id === truncated.id ? truncated : complete),
  )
  const wrapper = open(truncated)
  await flushPromises()
  expect(wrapper.text()).toContain(
    '本次训练取数达到上限，结果仅基于实际取回的数据。',
  )
  await wrapper.setProps({ run: complete })
  await flushPromises()
  expect(wrapper.text()).not.toContain('本次训练取数达到上限')
  wrapper.unmount()
})
