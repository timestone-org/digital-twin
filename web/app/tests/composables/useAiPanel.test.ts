/**
 * @fileoverview 契约：助手面板的装配那一层。
 *
 * 五条：工作面**挂载时登记、卸载时撤掉**（不撤的话助手仍握着一份指向已经没了
 * 的页面的句柄）；探测失败一律读成「这套部署没有助手」而不是「暂时故障」；
 * 连点两下不许建出两个会话（第二个拿着一段空历史，用户看不出自己在跟哪一个说话）；
 * 建不出会话时要**说得出一句**（不说的话表现是「点了图标没反应」）；
 * 打开面板要把库里的历史回放出来，且回放失败不挡打开、已有内容不重复灌。
 */
import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import type {
  AssistantMessage,
  AssistantSession,
  AssistantSessionDetail,
} from '@dt/contracts'
import { useToast } from '@dt/ui'

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

/** 库里的一条消息。 */
function said(role: string, text: string, seq: number): AssistantMessage {
  return {
    id: `m${seq}`,
    session_id: 's1',
    seq,
    role,
    content_json: { text },
    usage_json: null,
    steps: [],
    created_at: '',
  }
}

/**
 * 库里的一行会话。
 * ⚠ 造件要**摊全**：少一格的假件会让「下拉显示的是行上那一路」这条契约
 * 在用例里恒真，而线上少的正是那一格。
 */
function rowOf(overrides: Partial<AssistantSession> = {}): AssistantSession {
  return {
    id: 's1',
    user_id: 'u1',
    title: '',
    surface_kind: 'dashboard-editor',
    surface_ref: 'db1',
    is_archived: false,
    row_version: 1,
    last_error: null,
    model_profile: 'default',
    reasoning_effort: null,
    created_at: '',
    updated_at: '',
    ...overrides,
  }
}

/** 库里的一份会话详情。 */
function detailOf(
  messages: AssistantMessage[],
  plan: AssistantSessionDetail['plan_json'] = null,
): AssistantSessionDetail {
  return {
    id: 's1',
    user_id: 'u1',
    title: '',
    surface_kind: 'dashboard-editor',
    surface_ref: 'db1',
    is_archived: false,
    row_version: 1,
    last_error: null,
    model_profile: null,
    reasoning_effort: null,
    created_at: '',
    updated_at: '',
    messages,
    plan_json: plan,
  }
}

let created: ReturnType<typeof vi.fn>
let readBack: ReturnType<typeof vi.fn>
let patched: ReturnType<typeof vi.fn>

beforeEach(() => {
  __resetAiPorts()
  __resetSurfaces()
  created = vi.fn().mockResolvedValue(rowOf())
  readBack = vi.fn().mockResolvedValue(null)
  patched = vi.fn().mockResolvedValue(rowOf())
  vi.spyOn(api, 'createSession').mockImplementation(created)
  vi.spyOn(api, 'readSession').mockImplementation(readBack)
  vi.spyOn(api, 'patchSession').mockImplementation(patched)
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
          skills: [],
          models: [],
          default_model_id: '',
          default_effort: '',
          attachment_suffixes: [],
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

  it('建会话失败时不留下半开的面板，并且说得出一句', async () => {
    created.mockRejectedValue(new Error('这一路模型不可用'))
    const toast = useToast()
    toast.clear()
    const ctx = setup()

    await ctx.panel.open()

    // ⚠ 抛出去等于没说：两个调用方都是 `void ai.open()`，异常只会落进控制台，
    // 而界面上是「点了助手图标没有任何反应」——这一类表现与「按钮坏了」
    // 「权限不够」「服务没部署」长得一模一样，查起来最贵
    expect(
      toast.toasts.value.some((one) =>
        one.message.includes('这一路模型不可用'),
      ),
    ).toBe(true)
    expect(ctx.panel.isOpen.value).toBe(false)
    expect(ctx.panel.sessionId.value).toBeNull()
    ctx.wrapper.unmount()
  })
})

describe('回放历史', () => {
  it('打开面板时把库里的历史与计划灌回时间线', async () => {
    const plan = {
      title: '绑三个点',
      state: 'active' as const,
      items: [{ title: '查点位', status: 'done' as const, note: '' }],
    }
    readBack.mockResolvedValue(
      detailOf(
        [said('user', '帮我绑点', 1), said('assistant', '好的', 2)],
        plan,
      ),
    )
    const ctx = setup()
    await ctx.panel.open()
    expect(ctx.panel.chat.entries.value.map((one) => one.text)).toEqual([
      '帮我绑点',
      '好的',
    ])
    expect(ctx.panel.chat.plan.value).toEqual(plan)
    ctx.wrapper.unmount()
  })

  it('读不回历史不挡打开面板，只在时间线上说一句', async () => {
    readBack.mockRejectedValue(new Error('网断了'))
    const ctx = setup()
    await ctx.panel.open()
    expect(ctx.panel.isOpen.value).toBe(true)
    const roles = ctx.panel.chat.entries.value.map((one) => one.role)
    expect(roles).toEqual(['note'])
    ctx.wrapper.unmount()
  })

  it('时间线已经有内容时不重复灌（来回开合面板）', async () => {
    readBack.mockResolvedValue(detailOf([said('user', '帮我绑点', 1)]))
    const ctx = setup()
    await ctx.panel.open()
    ctx.panel.close()
    await ctx.panel.open()
    // 再读一次库的话，屏上同一段历史会出现两遍
    expect(readBack).toHaveBeenCalledTimes(1)
    expect(ctx.panel.chat.entries.value).toHaveLength(1)
    ctx.wrapper.unmount()
  })

  it('上一次读取还没回来又开了一次：后一次为准', async () => {
    let settleFirst!: (given: AssistantSessionDetail) => void
    const first = new Promise<AssistantSessionDetail>((resolve) => {
      settleFirst = resolve
    })
    readBack
      .mockImplementationOnce(() => first)
      .mockResolvedValueOnce(detailOf([said('user', '新历史', 1)]))
    const ctx = setup()
    const opened = ctx.panel.open()
    // 等第一次读取真的发出去（open 会一直等在它上面）
    await vi.waitFor(() => expect(readBack).toHaveBeenCalledTimes(1))
    await ctx.panel.open()
    settleFirst(detailOf([said('user', '旧历史', 1)]))
    await opened
    // 旧响应不许盖掉新的，也不许再叠一份
    expect(ctx.panel.chat.entries.value.map((one) => one.text)).toEqual([
      '新历史',
    ])
    ctx.wrapper.unmount()
  })
})

describe('下拉显示的那一路', () => {
  /** 探测面：这套部署报的默认是订阅账号那一路。 */
  function probesCodexAsDefault(): void {
    setAiPorts({
      probe: () =>
        Promise.resolve({
          is_model_enabled: true,
          skills: [],
          models: [],
          default_model_id: 'codex',
          default_effort: 'medium',
          attachment_suffixes: [],
        }),
    })
  }

  it('建完会话就以行上那一路为准，不是能力端点报的默认', async () => {
    // 两处各填各的话，界面显示订阅账号而回合走按量计费——运行期毫无迹象，
    // 只有账单看得出来
    probesCodexAsDefault()
    created.mockResolvedValue(rowOf({ model_profile: 'default' }))
    const ctx = setup()
    await ctx.wrapper.vm.$nextTick()
    await Promise.resolve()

    await ctx.panel.open()

    expect(ctx.panel.choice.value.profile).toBe('default')
    ctx.wrapper.unmount()
  })

  it('会话还没建起来时先拿部署的默认占着', async () => {
    probesCodexAsDefault()
    const ctx = setup()
    await ctx.wrapper.vm.$nextTick()
    await Promise.resolve()

    expect(ctx.panel.choice.value.profile).toBe('codex')
    ctx.wrapper.unmount()
  })

  it('换一路之后同样以服务端回的那一行为准', async () => {
    // 换路时思考档是清在本地的，而没带上这一格的 PATCH 不动行上的旧值——
    // 不抄回来的话下拉是空的，回合却仍按行上那一档在跑
    const ctx = setup()
    await ctx.panel.open()
    patched.mockResolvedValue(
      rowOf({ model_profile: 'codex', reasoning_effort: 'high' }),
    )

    await ctx.panel.pickModel({ profile: 'codex', effort: '' })

    expect(patched).toHaveBeenCalledWith('s1', { model_profile: 'codex' })
    expect(ctx.panel.choice.value).toEqual({
      profile: 'codex',
      effort: 'high',
    })
    ctx.wrapper.unmount()
  })
})
