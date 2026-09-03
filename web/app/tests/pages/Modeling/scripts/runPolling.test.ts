/**
 * @fileoverview 运行轮询：终态停表、失败也接着试、换一次运行看时旧回包不覆盖
 * 新的、节点结果拉过就缓存。
 */
import type { ModelingNodeRun, ModelingRun } from '@dt/contracts'
import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'

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

  it('换一次运行看，缓存跟着清掉', async () => {
    vi.spyOn(modeling, 'getModelingNodeRun').mockResolvedValue(nodeRun())
    const { runner } = setup()
    runner.watchRun(run({ id: 'r1', status: 'succeeded' }))
    await runner.loadPreview('n1')

    runner.watchRun(run({ id: 'r2', status: 'succeeded' }))

    expect(runner.previews.value.size).toBe(0)
  })
})
