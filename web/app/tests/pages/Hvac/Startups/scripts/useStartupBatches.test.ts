/**
 * @fileoverview 锁住批次取数：换到没选房间要清干净、重算只入队、
 * 没有当前批次时点不出重算。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import type { StartupBatch, StartupBatches } from '@dt/contracts'

import * as hvac from '@/api/hvac'
import { useStartupBatches } from '@/pages/Hvac/Startups/scripts/useStartupBatches'

const STAMP = '2026-08-12T02:00:00.000Z'

const WINDOW = {
  window_start: '2023-01-01T00:00:00.000Z',
  window_end: '2026-08-01T00:00:00.000Z',
}

function batch(over: Partial<StartupBatch> = {}): StartupBatch {
  return {
    id: 'b1',
    status: 'ready',
    is_current: true,
    params_fingerprint: 'abc',
    logic_version: 3,
    window_start: '2026-01-01T00:00:00.000Z',
    window_end: '2026-08-01T00:00:00.000Z',
    shard_total: 8,
    shard_done: 8,
    episode_count: 120,
    unmatched_exclusion_count: 0,
    created_at: STAMP,
    updated_at: STAMP,
    ...over,
  }
}

function batches(over: Partial<StartupBatches> = {}): StartupBatches {
  return {
    items: [batch()],
    current: batch(),
    coverage: [{ running_set: ['K01'], usable_count: 42 }],
    expected_fingerprint: 'abc',
    is_stale: false,
    source_range: { start: '2023-01-01T00:00:00.000Z', end: WINDOW.window_end },
    ...over,
  }
}

beforeEach(() => {
  vi.spyOn(hvac, 'getStartupBatches').mockResolvedValue(batches())
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useStartupBatches', () => {
  it('没选房间时不发请求，并把上一个房间的数据清干净', async () => {
    const roomId = ref('r1')
    const view = useStartupBatches(() => roomId.value)
    await view.load()
    expect(view.current.value).not.toBeNull()

    roomId.value = ''
    await view.load()
    expect(hvac.getStartupBatches).toHaveBeenCalledTimes(1)
    expect(view.current.value).toBeNull()
    expect(view.coverage.value).toEqual([])
    expect(view.isStale.value).toBe(false)
  })

  it('running 状态由当前批次推导', async () => {
    vi.mocked(hvac.getStartupBatches).mockResolvedValue(
      batches({ current: batch({ status: 'running' }) }),
    )
    const view = useStartupBatches(() => 'r1')
    await view.load()
    expect(view.isRunning.value).toBe(true)
    expect(view.hasBatch.value).toBe(true)
  })

  it('取不回来时说出原因', async () => {
    vi.mocked(hvac.getStartupBatches).mockRejectedValue(new Error('boom'))
    const view = useStartupBatches(() => 'r1')
    await view.load()
    expect(view.error.value).toContain('请求失败')
  })

  it('抽取用调用方给的时间窗，不再拿上一批次的窗口顶上', async () => {
    const rebuild = vi.spyOn(hvac, 'rebuildStartupBatches').mockResolvedValue({
      batch_id: 'b2',
      status: 'running',
      shard_total: 44,
      window_start: WINDOW.window_start,
      window_end: WINDOW.window_end,
      is_clamped: false,
    })
    const view = useStartupBatches(() => 'r1')
    await view.load()
    expect(await view.rebuild(WINDOW)).not.toBeNull()
    expect(rebuild).toHaveBeenCalledWith('r1', WINDOW)
    // 上一批次的窗口是 2026-01-01 起，绝不能出现在载荷里
    expect(rebuild).not.toHaveBeenCalledWith('r1', {
      window_start: '2026-01-01T00:00:00.000Z',
      window_end: '2026-08-01T00:00:00.000Z',
    })
    expect(hvac.getStartupBatches).toHaveBeenCalledTimes(2)
  })

  it('还没抽取过的房间照样发得出请求——那正是第一次抽取', async () => {
    vi.mocked(hvac.getStartupBatches).mockResolvedValue(
      batches({ current: null }),
    )
    const rebuild = vi.spyOn(hvac, 'rebuildStartupBatches').mockResolvedValue({
      batch_id: 'b2',
      status: 'running',
      shard_total: 44,
      window_start: WINDOW.window_start,
      window_end: WINDOW.window_end,
      is_clamped: false,
    })
    const view = useStartupBatches(() => 'r1')
    await view.load()
    expect(await view.rebuild(WINDOW)).not.toBeNull()
    expect(rebuild).toHaveBeenCalledWith('r1', WINDOW)
  })

  it('已经有一次在跑时后端拒绝，原因要显示出来', async () => {
    vi.spyOn(hvac, 'rebuildStartupBatches').mockRejectedValue(new Error('boom'))
    const view = useStartupBatches(() => 'r1')
    await view.load()
    expect(await view.rebuild(WINDOW)).toBeNull()
    expect(view.error.value).toContain('请求失败')
    expect(view.rebuilding.value).toBe(false)
  })
})
