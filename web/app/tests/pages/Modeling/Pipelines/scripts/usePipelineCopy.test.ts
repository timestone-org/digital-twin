/** @fileoverview 流水线副本完整保留保存图，创建失败和离开页面不会误改来源或重复提交。 */
import type { ModelingPipeline } from '@dt/contracts'
import * as ui from '@dt/ui'
import { mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'

import * as modeling from '@/api/modeling'
import * as workflow from '@/api/modelingWorkflow'
import * as idempotency from '@/api/idempotency'
import { usePipelineOps } from '@/pages/Modeling/Pipelines/scripts/usePipelineOps'

const STAMP = '2026-10-30T00:00:00Z'
const source: ModelingPipeline = {
  id: 'original',
  code: 'energy',
  name: '能耗分析',
  description: '原说明',
  node_count: 2,
  source_table_codes: ['energy_log'],
  created_by_name: '分析员',
  created_at: STAMP,
  updated_at: STAMP,
  graph: {
    format_version: '1.0',
    nodes: [
      {
        id: 'source',
        operator: 'ledger_source',
        alias: '台账',
        config: { table_code: 'energy_log', columns: ['temp', 'power'] },
        position: { left: 40, top: 80 },
      },
      {
        id: 'fit',
        operator: 'linear_regression',
        alias: '回归',
        config: { target_key: 'power', use_intercept: false },
        position: { left: 420, top: 100 },
      },
    ],
    edges: [
      {
        id: 'edge',
        from_node: 'source',
        from_port: 'frame',
        to_node: 'fit',
        to_port: 'frame',
      },
    ],
  },
}
const wrappers: VueWrapper[] = []
const done = vi.fn()
const error = vi.fn()

function openCopy() {
  const wrapper = mount(
    defineComponent({
      setup: () => ({ ops: usePipelineOps(done) }),
      template: '<div />',
    }),
  )
  wrappers.push(wrapper)
  wrapper.vm.ops.openCopy(source)
  const draft = wrapper.vm.ops.draft.value
  if (!draft) throw new Error('复制表单未打开')
  return { wrapper, ops: wrapper.vm.ops, draft }
}

beforeEach(() => {
  done.mockClear()
  error.mockClear()
  const toast = ui.useToast()
  vi.spyOn(ui, 'useToast').mockReturnValue({
    ...toast,
    error,
    success: vi.fn(),
  })
  vi.spyOn(idempotency, 'newClientUuid').mockReturnValue(
    '12345678-abcd-4abc-9abc-123456789abc',
  )
})
afterEach(() => {
  for (const wrapper of wrappers) wrapper.unmount()
  wrappers.length = 0
  vi.restoreAllMocks()
})

it('预填原说明，长名称保留副本后缀，并生成新编码', () => {
  const { ops } = openCopy()
  ops.openCopy({ ...source, name: '名'.repeat(128) })
  expect(ops.draft.value).toEqual({
    id: null,
    sourcePipelineId: 'original',
    code: 'model_12345678abcd4abc9abc123456789abc',
    name: `${'名'.repeat(125)} 副本`,
    description: '原说明',
  })
})

it('复制名称截断保持完整的 Unicode 字符', () => {
  const { ops } = openCopy()
  ops.openCopy({ ...source, name: '🧪'.repeat(128) })
  expect(ops.draft.value?.name).toBe(`${'🧪'.repeat(125)} 副本`)
})

it('复制完整保存图并隔离对象，创建请求不携带来源身份或历史', async () => {
  const original = structuredClone(source)
  const read = vi
    .spyOn(modeling, 'getModelingPipeline')
    .mockResolvedValue(original)
  const create = vi
    .spyOn(modeling, 'createModelingPipeline')
    .mockResolvedValue({ ...source, id: 'copy' })
  const update = vi.spyOn(modeling, 'updateModelingPipeline')
  const { ops, draft } = openCopy()
  expect(
    await ops.save({
      ...draft,
      name: '新的分析',
      code: 'new_energy',
      description: '新说明',
    }),
  ).toBe('copy')
  expect(read).toHaveBeenCalledWith('original', expect.any(AbortSignal))
  expect(create).toHaveBeenCalledWith({
    code: 'new_energy',
    name: '新的分析',
    description: '新说明',
    graph: source.graph,
  })
  const sent = create.mock.calls[0]?.[0].graph
  if (!sent) throw new Error('副本缺少图')
  expect(sent).not.toBe(original.graph)
  const node = sent.nodes[0]
  if (!node) throw new Error('副本缺少节点')
  node.config['table_code'] = 'other'
  node.position.left = 999
  expect(original.graph).toEqual(source.graph)
  expect(update).not.toHaveBeenCalled()
  expect(done).toHaveBeenCalledOnce()
  expect(ops.draft.value).toBeNull()
})

it('来源读取失败不创建空白副本，保留表单以便重试', async () => {
  vi.spyOn(modeling, 'getModelingPipeline').mockRejectedValue(
    new Error('source missing'),
  )
  const create = vi.spyOn(modeling, 'createModelingPipeline')
  const { ops, draft } = openCopy()
  expect(await ops.save(draft)).toBeNull()
  expect(create).not.toHaveBeenCalled()
  expect(ops.draft.value).toEqual(draft)
  expect(ops.isSaving.value).toBe(false)
  expect(error).toHaveBeenCalledOnce()
  expect(done).not.toHaveBeenCalled()
})

it('创建失败保留修改的元数据和来源，重试仍从同一来源复制', async () => {
  const read = vi
    .spyOn(modeling, 'getModelingPipeline')
    .mockResolvedValue(source)
  const create = vi
    .spyOn(modeling, 'createModelingPipeline')
    .mockRejectedValueOnce(new Error('duplicate code'))
    .mockResolvedValueOnce({ ...source, id: 'copy' })
  const { ops, draft } = openCopy()
  const changed = { ...draft, code: 'new_code', name: '新的分析' }
  expect(await ops.save(changed)).toBeNull()
  expect(ops.draft.value?.sourcePipelineId).toBe('original')
  expect(error).toHaveBeenCalledOnce()
  expect(await ops.save(changed)).toBe('copy')
  expect(read).toHaveBeenCalledTimes(2)
  expect(create).toHaveBeenLastCalledWith(
    expect.objectContaining({
      code: 'new_code',
      name: '新的分析',
      graph: source.graph,
    }),
  )
})

it('复制进行中阻止重复提交、切换来源与关闭表单', async () => {
  let finish: ((value: ModelingPipeline) => void) | undefined
  const read = vi.spyOn(modeling, 'getModelingPipeline').mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  const create = vi
    .spyOn(modeling, 'createModelingPipeline')
    .mockResolvedValue({ ...source, id: 'copy' })
  const { ops, draft } = openCopy()
  const pending = ops.save(draft)
  expect(await ops.save(draft)).toBeNull()
  ops.openCopy({ ...source, id: 'other' })
  ops.openCreate()
  ops.openEdit(source)
  ops.close()
  expect(ops.draft.value).toEqual(draft)
  expect(read).toHaveBeenCalledOnce()
  if (!finish) throw new Error('来源读取未发起')
  finish(source)
  expect(await pending).toBe('copy')
  expect(create).toHaveBeenCalledOnce()
})

it('取消复制表单不读取也不创建，并在重新打开时恢复来源', () => {
  const read = vi.spyOn(modeling, 'getModelingPipeline')
  const create = vi.spyOn(modeling, 'createModelingPipeline')
  const { ops } = openCopy()
  ops.close()
  expect(ops.draft.value).toBeNull()
  expect(read).not.toHaveBeenCalled()
  expect(create).not.toHaveBeenCalled()
  ops.openCopy({ ...source, id: 'another' })
  expect(ops.draft.value?.sourcePipelineId).toBe('another')
})

it('来源读取期间离开页面会中止读取，返回后不再创建', async () => {
  let finish: ((value: ModelingPipeline) => void) | undefined
  let requestSignal: AbortSignal | undefined
  vi.spyOn(modeling, 'getModelingPipeline').mockImplementation(
    (_id, signal) => {
      requestSignal = signal
      return new Promise((resolve) => {
        finish = resolve
      })
    },
  )
  const create = vi.spyOn(modeling, 'createModelingPipeline')
  const { ops, draft, wrapper } = openCopy()
  const pending = ops.save(draft)
  wrapper.unmount()
  expect(requestSignal?.aborted).toBe(true)
  if (!finish) throw new Error('来源读取未发起')
  finish(source)
  expect(await pending).toBeNull()
  expect(create).not.toHaveBeenCalled()
  expect(done).not.toHaveBeenCalled()
})

it('创建已经发出后离开页面，完成时不再触发导航回调', async () => {
  vi.spyOn(modeling, 'getModelingPipeline').mockResolvedValue(source)
  let finish: ((value: ModelingPipeline) => void) | undefined
  const create = vi
    .spyOn(modeling, 'createModelingPipeline')
    .mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
  const { ops, draft, wrapper } = openCopy()
  const pending = ops.save(draft)
  await vi.waitFor(() => expect(create).toHaveBeenCalledOnce())
  wrapper.unmount()
  if (!finish) throw new Error('创建未发起')
  finish({ ...source, id: 'copy' })
  expect(await pending).toBeNull()
  expect(done).not.toHaveBeenCalled()
})

it('已保存模板通过模板快照接口创建，保留模板名称和用户说明', async () => {
  const create = vi
    .spyOn(workflow, 'createWorkflowFromTemplate')
    .mockResolvedValue({ ...source, id: 'from-template' })
  const plain = vi.spyOn(modeling, 'createModelingPipeline')
  const { ops } = openCopy()
  ops.openCreate()
  const draft = {
    id: null,
    code: 'new_energy',
    name: '  冷机预测  ',
    description: '生产机组',
  }
  expect(await ops.save(draft, 'saved:template-1')).toBe('from-template')
  expect(create).toHaveBeenCalledWith('template-1', {
    code: 'new_energy',
    name: '冷机预测',
    description: '生产机组',
  })
  expect(plain).not.toHaveBeenCalled()
  expect(done).toHaveBeenCalledOnce()
})

it('命名模板创建失败保留新建表单，重试仍选用同一模板', async () => {
  const create = vi
    .spyOn(workflow, 'createWorkflowFromTemplate')
    .mockRejectedValueOnce(new Error('unavailable'))
    .mockResolvedValueOnce({ ...source, id: 'retried-template' })
  const { ops } = openCopy()
  ops.openCreate()
  const draft = {
    id: null,
    code: 'new_energy',
    name: '冷机预测',
    description: '',
  }
  expect(await ops.save(draft, 'saved:template-1')).toBeNull()
  expect(ops.draft.value).not.toBeNull()
  expect(error).toHaveBeenCalledOnce()
  expect(done).not.toHaveBeenCalled()
  expect(await ops.save(draft, 'saved:template-1')).toBe('retried-template')
  expect(create).toHaveBeenCalledTimes(2)
  expect(create).toHaveBeenLastCalledWith('template-1', {
    code: 'new_energy',
    name: '冷机预测',
    description: null,
  })
})
