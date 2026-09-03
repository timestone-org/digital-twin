/**
 * @fileoverview 三个操作组合式：建改删要问一句、失败弹一次而不是把异常抛给调用方、
 * 换绑回执里的影响面要报出来、存图之后才算干净。
 */
import type { ModelingPipeline, ModelingPipelineSummary } from '@dt/contracts'
import * as ui from '@dt/ui'
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'

import * as modeling from '@/api/modeling'
import { usePipelineDoc } from '@/pages/Modeling/Canvas/scripts/usePipelineDoc'
import { useBindingOps } from '@/pages/Modeling/Models/scripts/useBindingOps'
import { usePipelineOps } from '@/pages/Modeling/Pipelines/scripts/usePipelineOps'

const STAMP = '2026-01-01T00:00:00.000Z'

function toaster() {
  const toast = {
    info: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    dismiss: vi.fn(),
    clear: vi.fn(),
    toasts: { value: [] },
  }
  vi.spyOn(ui, 'useToast').mockReturnValue(toast as never)
  return toast
}

/** 二次确认的问话，只取界面上真正给用户看的那两句。 */
interface Ask {
  title?: string
  message: string
}

function asker(answer: boolean) {
  const ask = vi
    .fn<(request: Ask) => Promise<boolean>>()
    .mockResolvedValue(answer)
  vi.spyOn(ui, 'useConfirm').mockReturnValue({
    ask,
    pending: { value: null },
    resolve: vi.fn(),
  } as never)
  return ask
}

function host<T>(make: () => T): T {
  let made!: T
  mount(
    defineComponent({
      setup() {
        made = make()
        return () => h('div')
      },
    }),
  )
  return made
}

function pipeline(): ModelingPipeline {
  return {
    id: 'p1',
    code: 'energy_fit',
    name: '能耗回归',
    description: null,
    node_count: 0,
    source_table_codes: [],
    created_by_name: null,
    created_at: STAMP,
    updated_at: STAMP,
    graph: { format_version: '1', nodes: [], edges: [] },
  }
}

function summary(): ModelingPipelineSummary {
  const full = pipeline()
  return { ...full, graph: undefined } as unknown as ModelingPipelineSummary
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('流水线列表上的动作', () => {
  it('新建走 create，改走 update——编码不进补丁', async () => {
    toaster()
    const create = vi
      .spyOn(modeling, 'createModelingPipeline')
      .mockResolvedValue(pipeline())
    const update = vi
      .spyOn(modeling, 'updateModelingPipeline')
      .mockResolvedValue(pipeline())
    const done = vi.fn()
    const ops = host(() => usePipelineOps(done))

    await ops.save({ id: null, code: 'c', name: 'n', description: '' })
    await ops.save({ id: 'p1', code: 'c', name: '改过的', description: '' })

    expect(create).toHaveBeenCalledOnce()
    expect(update).toHaveBeenCalledWith('p1', {
      name: '改过的',
      description: null,
    })
    expect(done).toHaveBeenCalledTimes(2)
  })

  it('存失败时弹一次并保住表单，不把异常抛给调用方', async () => {
    const toast = toaster()
    vi.spyOn(modeling, 'createModelingPipeline').mockRejectedValue(
      new Error('编码重了'),
    )
    const done = vi.fn()
    const ops = host(() => usePipelineOps(done))
    ops.openCreate()

    await ops.save({ id: null, code: 'c', name: 'n', description: '' })

    expect(toast.error).toHaveBeenCalledOnce()
    expect(ops.draft.value).not.toBeNull()
    expect(done).not.toHaveBeenCalled()
    expect(ops.isSaving.value).toBe(false)
  })

  it('删除前问一句，答不删就真的不删', async () => {
    toaster()
    asker(false)
    const remove = vi.spyOn(modeling, 'deleteModelingPipeline')
    const ops = host(() => usePipelineOps(vi.fn()))

    await ops.remove(summary())

    expect(remove).not.toHaveBeenCalled()
  })

  it('问话里要说清运行记录跟着删、已发布的版本不跟着删', async () => {
    toaster()
    const ask = asker(true)
    vi.spyOn(modeling, 'deleteModelingPipeline').mockResolvedValue()
    const ops = host(() => usePipelineOps(vi.fn()))

    await ops.remove(summary())

    const message = ask.mock.calls[0]?.[0].message ?? ''
    expect(message).toContain('运行记录')
    expect(message).toContain('模型版本不受影响')
  })

  it('改名时把现有值填进表单，编码原样带着但界面上不给改', () => {
    toaster()
    const ops = host(() => usePipelineOps(vi.fn()))

    ops.openEdit(summary())

    expect(ops.draft.value).toEqual({
      id: 'p1',
      code: 'energy_fit',
      name: '能耗回归',
      description: '',
    })
  })
})

describe('画布上的文档', () => {
  it('载图失败时留下一句人话，而不是一张空画布', async () => {
    toaster()
    vi.spyOn(modeling, 'getModelingPipeline').mockRejectedValue(
      new Error('库里没有这条'),
    )
    const doc = host(() => usePipelineDoc())

    const loaded = await doc.load('p1')

    expect(loaded).toBeNull()
    expect(doc.error.value).toBeTruthy()
    expect(doc.isLoading.value).toBe(false)
  })

  it('存图成功才回 true，调用方据此清「有未保存改动」', async () => {
    toaster()
    vi.spyOn(modeling, 'getModelingPipeline').mockResolvedValue(pipeline())
    vi.spyOn(modeling, 'updateModelingPipeline').mockResolvedValue(pipeline())
    const doc = host(() => usePipelineDoc())
    await doc.load('p1')

    expect(await doc.save({ format_version: '1', nodes: [], edges: [] })).toBe(
      true,
    )
  })

  it('还没载图就存，直接回 false 而不是打一条没有 id 的请求', async () => {
    toaster()
    const update = vi.spyOn(modeling, 'updateModelingPipeline')
    const doc = host(() => usePipelineDoc())

    expect(await doc.save({ format_version: '1', nodes: [], edges: [] })).toBe(
      false,
    )
    expect(update).not.toHaveBeenCalled()
  })

  it('校验把后端的问题清单留下来给界面显示', async () => {
    toaster()
    vi.spyOn(modeling, 'getModelingPipeline').mockResolvedValue(pipeline())
    vi.spyOn(modeling, 'validateModelingGraph').mockResolvedValue({
      is_valid: false,
      issues: [{ message: '有一个入口没接线', node_id: 'n1', edge_id: '' }],
      known_columns: {},
    })
    const doc = host(() => usePipelineDoc())
    await doc.load('p1')

    const ok = await doc.validate({ format_version: '1', nodes: [], edges: [] })

    expect(ok).toBe(false)
    expect(doc.issues.value[0]?.message).toContain('没接线')
  })

  it('校验这一条自己失败时不谎报「图没问题」', async () => {
    toaster()
    vi.spyOn(modeling, 'getModelingPipeline').mockResolvedValue(pipeline())
    vi.spyOn(modeling, 'validateModelingGraph').mockRejectedValue(
      new Error('后端挂了'),
    )
    const doc = host(() => usePipelineDoc())
    await doc.load('p1')

    expect(
      await doc.validate({ format_version: '1', nodes: [], edges: [] }),
    ).toBe(false)
  })
})

describe('模型库上的动作', () => {
  function version() {
    return {
      id: 'v1',
      pipeline_id: 'p1',
      run_id: 'r1',
      version: 3,
      name: '能耗回归',
      algo: 'linear',
      task: 'regression' as const,
      is_servable: true,
      serving_channel: 'json' as const,
      unservable_reason: null,
      feature_keys: ['temp'],
      target_key: 'power',
      created_by_name: null,
      created_at: STAMP,
    }
  }

  function impact() {
    return {
      id: 'b1',
      fx_code: 'fx',
      model_version_id: 'v1',
      param_map: [],
      is_enabled: true,
      is_orphaned: false,
      created_by_name: null,
      created_at: STAMP,
      updated_at: STAMP,
      usages: [{ table_code: 'energy_log', column_key: 'pred' }],
    }
  }

  it('下线前问一句，并说清绑在它上面的公式会立刻取不到数', async () => {
    toaster()
    const ask = asker(true)
    vi.spyOn(modeling, 'retireModelingVersion').mockResolvedValue({
      ...version(),
      signature: {},
      metrics: {},
      fingerprint: {},
      description: null,
    })
    const ops = host(() => useBindingOps(vi.fn()))

    await ops.retire(version())

    expect(String(ask.mock.calls[0]?.[0]?.['message'])).toContain('模型不可用')
  })

  it('绑定成功后把「哪些台账列跟着变」报出来', async () => {
    const toast = toaster()
    vi.spyOn(modeling, 'createModelingBinding').mockResolvedValue(impact())
    const done = vi.fn()
    const ops = host(() => useBindingOps(done))

    await ops.bind('fx', 'v1')

    expect(toast.success.mock.calls[0]?.[0]).toContain('energy_log.pred')
    expect(done).toHaveBeenCalledOnce()
  })

  it('启停也走同一条回执，同样报影响面', async () => {
    const toast = toaster()
    vi.spyOn(modeling, 'updateModelingBinding').mockResolvedValue(impact())
    const ops = host(() => useBindingOps(vi.fn()))

    await ops.update('b1', { is_enabled: false })

    expect(toast.success.mock.calls[0]?.[0]).toContain('energy_log.pred')
  })

  it('接口失败时弹一次，并且不去刷新列表', async () => {
    const toast = toaster()
    vi.spyOn(modeling, 'deleteModelingBinding').mockRejectedValue(
      new Error('没权限'),
    )
    const done = vi.fn()
    const ops = host(() => useBindingOps(done))

    await ops.unbind('b1')

    expect(toast.error).toHaveBeenCalledOnce()
    expect(done).not.toHaveBeenCalled()
    expect(ops.isBusy.value).toBe(false)
  })
})
