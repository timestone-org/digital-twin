/**
 * @fileoverview 运行轮询：终态停表、失败也接着试、换一次运行看时旧回包不覆盖
 * 新的、节点结果拉过就缓存。
 */
import type { ModelingNodeRun, ModelingRun } from '@dt/contracts'
import * as ui from '@dt/ui'
import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'

import { BizError } from '@/api/client'
import * as modeling from '@/api/modeling'
import { useRunPolling } from '@/pages/Modeling/Canvas/scripts/useRunPolling'

const STAMP = '2026-01-01T00:00:00.000Z'

function run(over: Partial<ModelingRun> = {}): ModelingRun {
  return {
    id: 'r1',
    pipeline_id: 'p1',
    status: 'running',
    trigger: 'manual',
    started_at: STAMP,
    finished_at: null,
    duration_ms: null,
    row_count: null,
    is_source_truncated: false,
    is_keeping_frames: false,
    error_text: null,
    created_by_name: null,
    created_at: STAMP,
    graph: { format_version: '1', nodes: [], edges: [] },
    nodes: [],
    ...over,
  }
}

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

function setup() {
  let runner!: ReturnType<typeof useRunPolling>
  const wrapper = mount(
    defineComponent({
      setup() {
        runner = useRunPolling()
        return () => h('div')
      },
    }),
  )
  return { runner, wrapper }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('盯着一次运行', () => {
  it('停表后同一运行的迟到成功回包不能恢复状态或轮询', async () => {
    let finish: ((value: ModelingRun) => void) | undefined
    const get = vi.spyOn(modeling, 'getModelingRun').mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const { runner, wrapper } = setup()
    runner.watchRun(run())
    await vi.advanceTimersByTimeAsync(1000)
    runner.stop()
    runner.run.value = null
    finish?.(run())
    await vi.advanceTimersByTimeAsync(5000)
    expect(runner.run.value).toBeNull()
    expect(get).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('切换运行后迟到取消回执不替换当前运行', async () => {
    let finish: ((value: ModelingRun) => void) | undefined
    vi.spyOn(modeling, 'cancelModelingRun').mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const { runner, wrapper } = setup()
    runner.watchRun(run())
    const cancelling = runner.cancel()
    runner.watchRun(run({ id: 'r2', status: 'succeeded' }))
    finish?.(run({ status: 'cancelled' }))
    await cancelling
    expect(runner.run.value?.id).toBe('r2')
    wrapper.unmount()
  })

  it('训练成功但自动发布仍在进行时继续轮询，发布完成后停止', async () => {
    const get = vi
      .spyOn(modeling, 'getModelingRun')
      .mockResolvedValueOnce(
        run({ status: 'succeeded', publication_status: 'pending' }),
      )
      .mockResolvedValue(
        run({ status: 'succeeded', publication_status: 'published' }),
      )
    const { runner, wrapper } = setup()
    runner.watchRun(run({ status: 'succeeded', publication_status: 'pending' }))
    await vi.advanceTimersByTimeAsync(3000)
    expect(get).toHaveBeenCalledTimes(2)
    expect(runner.run.value?.publication_status).toBe('published')
    wrapper.unmount()
  })

  it('训练并发布将自动发布意图提交给服务端', async () => {
    const start = vi
      .spyOn(modeling, 'startModelingRun')
      .mockResolvedValue(run())
    const { runner, wrapper } = setup()
    await runner.start('p1', false, true)
    expect(start).toHaveBeenCalledWith('p1', 'manual', false, true)
    wrapper.unmount()
  })

  it('还在跑就一拍一拍地问', async () => {
    const get = vi
      .spyOn(modeling, 'getModelingRun')
      .mockResolvedValue(run({ status: 'running' }))
    const { runner } = setup()

    runner.watchRun(run({ status: 'running' }))
    await vi.advanceTimersByTimeAsync(1000)
    await vi.advanceTimersByTimeAsync(1000)

    expect(get).toHaveBeenCalledTimes(2)
  })

  it('跑完了就停表——不然一个开着的画布能整夜打请求', async () => {
    const get = vi
      .spyOn(modeling, 'getModelingRun')
      .mockResolvedValue(run({ status: 'succeeded' }))
    const { runner } = setup()

    runner.watchRun(run({ status: 'running' }))
    await vi.advanceTimersByTimeAsync(1000)
    await vi.advanceTimersByTimeAsync(5000)

    expect(get).toHaveBeenCalledTimes(1)
    expect(runner.run.value?.status).toBe('succeeded')
  })

  it('已经是终态的运行根本不开表', async () => {
    const get = vi.spyOn(modeling, 'getModelingRun')
    const { runner } = setup()

    runner.watchRun(run({ status: 'failed' }))
    await vi.advanceTimersByTimeAsync(5000)

    expect(get).not.toHaveBeenCalled()
  })

  it('一次问失败不打断用户，下一拍接着试', async () => {
    const get = vi
      .spyOn(modeling, 'getModelingRun')
      .mockRejectedValueOnce(new Error('网络抖了一下'))
      .mockResolvedValue(run({ status: 'running' }))
    const { runner } = setup()

    runner.watchRun(run({ status: 'running' }))
    await vi.advanceTimersByTimeAsync(1000)
    await vi.advanceTimersByTimeAsync(1000)

    expect(get).toHaveBeenCalledTimes(2)
  })

  it('换一次运行看之后，上一轮晚到的回包不许盖回去', async () => {
    const settles: ((value: ModelingRun) => void)[] = []
    vi.spyOn(modeling, 'getModelingRun').mockImplementation(
      () =>
        new Promise<ModelingRun>((done) => {
          settles.push(done)
        }),
    )
    const { runner } = setup()

    runner.watchRun(run({ id: 'r1', status: 'running' }))
    await vi.advanceTimersByTimeAsync(1000)
    runner.watchRun(run({ id: 'r2', status: 'failed' }))
    settles[0]?.(run({ id: 'r1', status: 'succeeded' }))
    await vi.advanceTimersByTimeAsync(0)

    expect(runner.run.value?.id).toBe('r2')
    expect(runner.run.value?.status).toBe('failed')
  })

  it('卸载时那一拍还在飞，它落地之后也不许再排下一拍', async () => {
    const fails: ((reason: Error) => void)[] = []
    const get = vi.spyOn(modeling, 'getModelingRun').mockImplementation(
      () =>
        new Promise<ModelingRun>((_ok, fail) => {
          fails.push(fail)
        }),
    )
    const { runner, wrapper } = setup()

    runner.watchRun(run({ status: 'running' }))
    await vi.advanceTimersByTimeAsync(1000)
    wrapper.unmount()
    // 卸载把在飞的那次 abort 掉，于是它以 reject 落地
    fails[0]?.(new Error('已取消'))
    await vi.advanceTimersByTimeAsync(10_000)

    expect(get).toHaveBeenCalledTimes(1)
  })

  it('组件卸下时停表，卸载之后不再打请求', async () => {
    const get = vi
      .spyOn(modeling, 'getModelingRun')
      .mockResolvedValue(run({ status: 'running' }))
    const { runner, wrapper } = setup()

    runner.watchRun(run({ status: 'running' }))
    wrapper.unmount()
    await vi.advanceTimersByTimeAsync(5000)

    expect(get).not.toHaveBeenCalled()
  })
})

describe('节点结果', () => {
  function nodeRun(): ModelingNodeRun {
    return {
      node_id: 'n1',
      operator: 'src',
      alias: '',
      ordinal: 0,
      status: 'succeeded',
      duration_ms: 12,
      has_preview: true,
      error_text: null,
      preview: { kind: 'frame' },
      is_preview_truncated: false,
      exported_ports: [],
      report: null,
      fitted: null,
    }
  }

  it('拉过一次就缓存，同一个节点不重复拉', async () => {
    const get = vi
      .spyOn(modeling, 'getModelingNodeRun')
      .mockResolvedValue(nodeRun())
    const { runner } = setup()
    runner.watchRun(run({ status: 'succeeded' }))

    await runner.loadPreview('n1')
    await runner.loadPreview('n1')

    expect(get).toHaveBeenCalledTimes(1)
    expect(runner.previews.value.get('n1')?.preview).toEqual({ kind: 'frame' })
  })

  it('还没有在看任何一次运行时，拉结果是个空操作', async () => {
    const get = vi.spyOn(modeling, 'getModelingNodeRun')
    const { runner } = setup()

    await runner.loadPreview('n1')

    expect(get).not.toHaveBeenCalled()
  })

  it('切换运行后迟到节点预览不写入新运行缓存', async () => {
    let finish: ((value: ModelingNodeRun) => void) | undefined
    vi.spyOn(modeling, 'getModelingNodeRun').mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const { runner, wrapper } = setup()
    runner.watchRun(run({ status: 'succeeded' }))
    const loading = runner.loadPreview('n1')
    runner.watchRun(run({ id: 'r2', status: 'succeeded' }))
    finish?.(nodeRun())
    await loading
    expect(runner.previews.value.size).toBe(0)
    wrapper.unmount()
  })

  it('不同节点预览并发读取，取消时逐一中止且不回填', async () => {
    const finishes: ((value: ModelingNodeRun) => void)[] = []
    const get = vi.spyOn(modeling, 'getModelingNodeRun').mockImplementation(
      () =>
        new Promise((resolve) => {
          finishes.push(resolve)
        }),
    )
    const { runner, wrapper } = setup()
    runner.watchRun(run({ status: 'succeeded' }))
    const first = runner.loadPreview('n1')
    const second = runner.loadPreview('n2')
    const signals = get.mock.calls.map((call) => call[2])
    expect(signals.map((signal) => signal?.aborted)).toEqual([false, false])
    runner.watchRun(run({ id: 'r2', status: 'succeeded' }))
    expect(signals.map((signal) => signal?.aborted)).toEqual([true, true])
    finishes[0]?.(nodeRun())
    finishes[1]?.({ ...nodeRun(), node_id: 'n2' })
    await Promise.all([first, second])
    expect(runner.previews.value.size).toBe(0)
    wrapper.unmount()
  })

  it('换一次运行看，缓存跟着清掉', async () => {
    vi.spyOn(modeling, 'getModelingNodeRun').mockResolvedValue(nodeRun())
    const { runner } = setup()
    runner.watchRun(run({ id: 'r1', status: 'succeeded' }))
    await runner.loadPreview('n1')

    runner.watchRun(run({ id: 'r2', status: 'succeeded' }))

    expect(runner.previews.value.size).toBe(0)
  })
})

describe('运行轮询的边角', () => {
  it('发布收尾那一拍不吞掉在飞的新一次训练', async () => {
    let finishStart: ((value: ModelingRun) => void) | undefined
    vi.spyOn(modeling, 'startModelingRun').mockImplementation(
      () =>
        new Promise((resolve) => {
          finishStart = resolve
        }),
    )
    vi.spyOn(modeling, 'getModelingRun').mockResolvedValue(
      run({ status: 'succeeded', publication_status: 'published' }),
    )
    const { runner, wrapper } = setup()
    runner.watchRun(run({ status: 'succeeded', publication_status: 'pending' }))
    const starting = runner.start('p1')
    await vi.advanceTimersByTimeAsync(1000)
    finishStart?.(run({ id: 'r2', status: 'running' }))
    await starting

    expect(runner.isStarting.value).toBe(false)
    expect(runner.run.value?.id).toBe('r2')
    wrapper.unmount()
  })

  it('运行刚跑完时在飞的节点结果照样落进缓存', async () => {
    let finish: ((value: ModelingNodeRun) => void) | undefined
    vi.spyOn(modeling, 'getModelingRun').mockResolvedValue(
      run({ status: 'succeeded' }),
    )
    vi.spyOn(modeling, 'getModelingNodeRun').mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const { runner, wrapper } = setup()
    runner.watchRun(run({ status: 'running' }))
    const loading = runner.loadPreview('n1')
    await vi.advanceTimersByTimeAsync(1000)
    finish?.(nodeRunOf('n1'))
    await loading

    expect(runner.previews.value.has('n1')).toBe(true)
    wrapper.unmount()
  })

  it('运行没了（4xx）就停表并标出界面停在旧状态', async () => {
    const get = vi
      .spyOn(modeling, 'getModelingRun')
      .mockRejectedValue(new BizError(40401, '运行不存在', 404, 't'))
    const { runner, wrapper } = setup()
    runner.watchRun(run({ status: 'running' }))
    await vi.advanceTimersByTimeAsync(1000)
    await vi.advanceTimersByTimeAsync(20_000)

    expect(get).toHaveBeenCalledTimes(1)
    expect(runner.staleReason.value).toContain('运行不存在')
    wrapper.unmount()
  })

  it('连着失败就逐次放慢，不是一秒一次打到天亮', async () => {
    const get = vi
      .spyOn(modeling, 'getModelingRun')
      .mockRejectedValue(new Error('网关超时'))
    const { runner, wrapper } = setup()
    runner.watchRun(run({ status: 'running' }))
    await vi.advanceTimersByTimeAsync(1000)
    await vi.advanceTimersByTimeAsync(1000)
    await vi.advanceTimersByTimeAsync(1000)

    expect(get).toHaveBeenCalledTimes(2)
    wrapper.unmount()
  })
})

describe('节点结果的后台预取', () => {
  it('预取失败不弹红条，记下原因，也不跟着每拍重拉', async () => {
    const toast = toaster()
    const get = vi
      .spyOn(modeling, 'getModelingNodeRun')
      .mockRejectedValue(new BizError(50300, '对象存储抖了', 503, 't'))
    const { runner, wrapper } = setup()
    runner.watchRun(run({ status: 'succeeded' }))

    await runner.loadPreview('n1', true)
    await runner.loadPreview('n1', true)

    expect(get).toHaveBeenCalledTimes(1)
    expect(toast.error).not.toHaveBeenCalled()
    expect(runner.previewErrors.value.get('n1')).toContain('对象存储抖了')
    wrapper.unmount()
  })

  it('用户亲手点开时不受预取失败影响，照样重拉', async () => {
    const toast = toaster()
    const get = vi
      .spyOn(modeling, 'getModelingNodeRun')
      .mockRejectedValueOnce(new Error('对象存储抖了'))
      .mockResolvedValue(nodeRunOf('n1'))
    const { runner, wrapper } = setup()
    runner.watchRun(run({ status: 'succeeded' }))

    await runner.loadPreview('n1', true)
    await runner.loadPreview('n1')

    expect(get).toHaveBeenCalledTimes(2)
    expect(runner.previews.value.has('n1')).toBe(true)
    expect(runner.previewErrors.value.has('n1')).toBe(false)
    expect(toast.error).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})

function nodeRunOf(nodeId: string): ModelingNodeRun {
  return {
    node_id: nodeId,
    operator: 'src',
    alias: '',
    ordinal: 0,
    status: 'succeeded',
    duration_ms: 12,
    has_preview: true,
    error_text: null,
    preview: { kind: 'frame' },
    is_preview_truncated: false,
    exported_ports: [],
    report: null,
    fitted: null,
  }
}
