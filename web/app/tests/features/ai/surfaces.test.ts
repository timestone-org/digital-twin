/**
 * @fileoverview 守「做不到就响亮地说做不到」。
 *
 * 静默成功会让模型以为改好了、接着往下走，最后给用户一个「已完成」而画面
 * 纹丝不动——那是这套东西最难查的一类故障。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AssistantToolCall } from '@dt/contracts'
import {
  __resetSurfaces,
  activeSurface,
  clearSurface,
  runClientTool,
  setSurface,
  UnsupportedTool,
  type AiSurface,
} from '@/features/ai/surfaces'

function call(name: string): AssistantToolCall {
  return { call_id: 'c1', name, arguments: {} }
}

function surface(overrides: Partial<AiSurface> = {}): AiSurface {
  return {
    kind: 'dashboard-editor',
    label: '大屏编辑器',
    snapshot: () => ({ nodes: 3 }),
    tools: ['dashboard.read_canvas'],
    run: vi.fn().mockResolvedValue({ ok: true }),
    ...overrides,
  }
}

afterEach(() => {
  __resetSurfaces()
})

describe('工作面注册', () => {
  it('没登记时没有工作面', () => {
    expect(activeSurface()).toBeNull()
  })

  it('登记之后读得到', () => {
    setSurface(surface())
    expect(activeSurface()?.label).toBe('大屏编辑器')
  })

  it('后登记的顶掉先前那个', () => {
    setSurface(surface())
    setSurface(surface({ kind: 'twin-editor', label: '孪生编辑器' }))
    expect(activeSurface()?.kind).toBe('twin-editor')
  })

  it('撤掉自己那一个', () => {
    setSurface(surface())
    clearSurface('dashboard-editor')
    expect(activeSurface()).toBeNull()
  })

  it('撤别人的那一个不动当前的', () => {
    // 两页快速切换时，后挂载的先跑、先卸载的后跑——撤错了会把新页面的工作面清掉
    setSurface(surface({ kind: 'twin-editor' }))
    clearSurface('dashboard-editor')
    expect(activeSurface()?.kind).toBe('twin-editor')
  })
})

describe('客户端工具的执行', () => {
  it('这一页实现了就跑', async () => {
    const run = vi.fn().mockResolvedValue({ done: true })
    setSurface(surface({ run }))
    await expect(runClientTool(call('dashboard.read_canvas'))).resolves.toEqual(
      { done: true },
    )
    expect(run).toHaveBeenCalledOnce()
  })

  it('没有工作面时抛', async () => {
    await expect(runClientTool(call('dashboard.read_canvas'))).rejects.toThrow(
      UnsupportedTool,
    )
  })

  it('这一页没实现的工具抛，而不是静默成功', async () => {
    const run = vi.fn()
    setSurface(surface({ run }))
    await expect(
      runClientTool(call('dashboard.write_binding')),
    ).rejects.toThrow(UnsupportedTool)
    expect(run).not.toHaveBeenCalled()
  })

  it('抛出来的话里带着工具名，模型才知道换哪一条路', async () => {
    setSurface(surface())
    await expect(
      runClientTool(call('dashboard.write_binding')),
    ).rejects.toThrow(/dashboard\.write_binding/)
  })
})
