/**
 * @fileoverview 契约：助手面板的装配那一层。
 *
 * 三条：工作面**挂载时登记、卸载时撤掉**（不撤的话助手仍握着一份指向已经没了
 * 的页面的句柄）；探测失败一律读成「这套部署没有助手」而不是「暂时故障」；
 * 连点两下不许建出两个会话（第二个拿着一段空历史，用户看不出自己在跟哪一个说话）。
 */
import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'

import * as api from '@/api/assistant'
import { useAiPanel, type AiPanel } from '@/composables/useAiPanel'
import { __resetAiPorts, setAiPorts } from '@/features/ai/ports'
import {
  activeSurface,
  __resetSurfaces,
  type AiSurface,
} from '@/features/ai/surfaces'

function surface(): AiSurface {
  return {
    kind: 'dashboard-editor',
    label: '大屏编辑器',
    tools: [],
    snapshot: () => ({}),
    run: () => Promise.resolve(null),
  }
}

interface Harness {
  panel: AiPanel
  wrapper: ReturnType<typeof mount>
}

function setup(): Harness {
  let panel!: AiPanel
  const host = defineComponent({
    setup() {
      panel = useAiPanel({ surface: surface, refId: () => 'db1' })
      return () => h('div')
    },
  })
  const wrapper = mount(host)
  return { panel, wrapper }
}

let created: ReturnType<typeof vi.fn>

beforeEach(() => {
  __resetAiPorts()
  __resetSurfaces()
  created = vi.fn().mockResolvedValue({ id: 's1' })
  vi.spyOn(api, 'createSession').mockImplementation(created)
})

afterEach(() => {
  __resetAiPorts()
  __resetSurfaces()
  vi.restoreAllMocks()
})

describe('工作面的生命周期', () => {
  it('挂载即登记', () => {
    const ctx = setup()
    expect(activeSurface()?.kind).toBe('dashboard-editor')
    ctx.wrapper.unmount()
  })

  it('卸载就撤掉', () => {
    const ctx = setup()
    ctx.wrapper.unmount()
    // 不撤的话，下一次动手会改到一个已经不存在的页面上
    expect(activeSurface()).toBeNull()
  })
})

describe('能力探测', () => {
  it('没装适配器时不问，入口保持不出现', async () => {
    const ctx = setup()
    await ctx.wrapper.vm.$nextTick()
    expect(ctx.panel.isAvailable.value).toBe(false)
    ctx.wrapper.unmount()
  })

  it('探到「接了模型」才把入口亮出来', async () => {
    setAiPorts({
      probe: () =>
        Promise.resolve({
          is_model_enabled: true,
          is_vision_enabled: true,
          skills: [],
        }),
    })
    const ctx = setup()
    await ctx.wrapper.vm.$nextTick()
    await Promise.resolve()
    expect(ctx.panel.isAvailable.value).toBe(true)
    ctx.wrapper.unmount()
  })

  it('探不到就当作这套部署没有助手', async () => {
    setAiPorts({ probe: () => Promise.resolve(null) })
    const ctx = setup()
    await ctx.wrapper.vm.$nextTick()
    await Promise.resolve()
    // 不是「暂时故障」：某些现场根本不部署这套服务
    expect(ctx.panel.isAvailable.value).toBe(false)
    ctx.wrapper.unmount()
  })
})

describe('打开面板', () => {
  it('第一次打开时建会话，并把工作面标识带过去', async () => {
    const ctx = setup()
    await ctx.panel.open()
    expect(ctx.panel.isOpen.value).toBe(true)
    expect(ctx.panel.sessionId.value).toBe('s1')
    expect(created).toHaveBeenCalledWith('dashboard-editor', 'db1')
    ctx.wrapper.unmount()
  })

  it('已经有会话就直接开，不再建一个', async () => {
    const ctx = setup()
    await ctx.panel.open()
    ctx.panel.close()
    await ctx.panel.open()
    expect(created).toHaveBeenCalledTimes(1)
    expect(ctx.panel.isOpen.value).toBe(true)
    ctx.wrapper.unmount()
  })

  it('连点两下只建一个会话', async () => {
    const ctx = setup()
    // 第二个会拿着一段空历史，而用户看不出自己在跟哪一个说话
    await Promise.all([ctx.panel.open(), ctx.panel.open()])
    expect(created).toHaveBeenCalledTimes(1)
    ctx.wrapper.unmount()
  })

  it('建会话失败时不留下半开的面板', async () => {
    created.mockRejectedValue(new Error('502'))
    const ctx = setup()
    await expect(ctx.panel.open()).rejects.toThrow()
    expect(ctx.panel.isOpen.value).toBe(false)
    expect(ctx.panel.sessionId.value).toBeNull()
    ctx.wrapper.unmount()
  })
})
