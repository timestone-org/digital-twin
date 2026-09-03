/**
 * @fileoverview 知识库对话页的行为契约。
 *
 * ⚠ 最要紧的三条：没有对话时发第一句要**自动建一个**（进来就想问的人不该先找
 * 「新建」按钮）；切对话要回放它的历史且慢回来的那次不许盖后选的；出错把后端
 * 那句原话摆出来。另守语音输入的接线：接了才有麦克风键，说出来的话进草稿、
 * 发出去的就是它。
 */
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import type {
  KnowledgeChatSession,
  KnowledgeChatSessionDetail,
} from '@dt/contracts'

import type { KnowledgeCapability } from '@/api/knowledge'
import KnowledgeChatPage from '@/pages/KnowledgeChat/index.vue'
import { useAuthStore } from '@/stores/auth'

const api = vi.hoisted(() => ({
  listSessions: vi.fn(),
  createSession: vi.fn(),
  readSession: vi.fn(),
  renameSession: vi.fn(),
  archiveSession: vi.fn(),
  deleteSession: vi.fn(),
  advanceTurn: vi.fn(),
}))

vi.mock('@/api/knowledgeChat', () => api)

const knowledgeApi = vi.hoisted(() => ({ readCapability: vi.fn() }))

vi.mock('@/api/knowledge', () => knowledgeApi)

const mic = vi.hoisted(() => ({
  onFrame: null as ((frame: ArrayBuffer) => void) | null,
  stop: vi.fn(),
}))

vi.mock('@/features/speech/pcmCapture', () => ({
  startPcmCapture: (onFrame: (frame: ArrayBuffer) => void) => {
    mic.onFrame = onFrame
    return Promise.resolve({ stop: mic.stop })
  },
}))

type Listener = (event: unknown) => void

/** 记下每次构造与发送的假 WebSocket（同 useSpeechInput 那份用例）。 */
class FakeSocket {
  static instances: FakeSocket[] = []
  static readonly OPEN = 1

  readyState = FakeSocket.OPEN
  sent: (string | ArrayBuffer)[] = []
  private listeners = new Map<string, Listener[]>()

  constructor(
    readonly url: string,
    readonly protocols: string[],
  ) {
    FakeSocket.instances.push(this)
  }

  addEventListener(type: string, handler: Listener): void {
    const bucket = this.listeners.get(type) ?? []
    bucket.push(handler)
    this.listeners.set(type, bucket)
  }

  send(data: string | ArrayBuffer): void {
    this.sent.push(data)
  }

  close(): void {
    this.emit('close', { code: 1000 })
  }

  emit(type: string, event: unknown = {}): void {
    for (const handler of this.listeners.get(type) ?? []) handler(event)
  }
}

function hear(body: unknown): void {
  const socket = FakeSocket.instances.at(-1)
  if (socket === undefined) throw new Error('还没有建立过语音连接')
  socket.emit('message', { data: JSON.stringify(body) })
}

function capabilityOf(isAsrEnabled: boolean): KnowledgeCapability {
  return {
    isEmbeddingEnabled: true,
    isModelEnabled: true,
    isAsrEnabled,
    strategies: ['naive', 'hybrid', 'agentic'],
    readyStrategies: ['naive', 'hybrid', 'agentic'],
    acceptedSuffixes: ['.md', '.docx'],
    index: { vector: 'pgvector', keyword: 'trgm', reason: '' },
    rerank: {
      isEnabled: false,
      model: '',
      reason: '还没给「知识库重排」分配模型',
    },
  }
}

vi.mock('vue-router', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useRoute: () => ({ path: '/knowledge/chat', query: {} }),
  RouterLink: { template: '<a><slot /></a>' },
}))

const confirmSpy = vi.fn<() => Promise<boolean>>()
vi.mock('@dt/ui', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@dt/ui')
  return { ...actual, useConfirm: () => ({ ask: confirmSpy }) }
})

function sessionOf(id: string, title = ''): KnowledgeChatSession {
  return {
    id,
    user_id: 'u1',
    title,
    is_archived: false,
    row_version: 1,
    last_error: null,
    created_at: '2026-09-02T00:00:00.000Z',
    updated_at: '2026-09-02T00:00:00.000Z',
  }
}

function detailOf(id: string, said: string): KnowledgeChatSessionDetail {
  return {
    ...sessionOf(id),
    messages: [
      {
        id: `${id}-m1`,
        session_id: id,
        seq: 1,
        role: 'user',
        content_json: { text: said },
        usage_json: null,
        steps: [],
        created_at: '',
      },
    ],
  }
}

function frame(name: string, body: unknown): string {
  return `event: ${name}\ndata: ${JSON.stringify(body)}\n\n`
}

async function* reply(text: string): AsyncGenerator<string> {
  await Promise.resolve()
  yield frame('turn.done', { reply: text })
}

function signIn(): void {
  const auth = useAuthStore()
  auth.user = {
    id: 'u1',
    username: 'heyufan',
    permissions: ['knowledge:use'],
    role_permissions: ['knowledge:use'],
  } as never
  auth.accessToken = 'token'
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.resetAllMocks()
  api.listSessions.mockResolvedValue([sessionOf('s1', '锅炉那几台')])
  api.readSession.mockResolvedValue(detailOf('s1', '早先问过'))
  api.advanceTurn.mockImplementation(() => reply('上限 65 ℃ [1]'))
  knowledgeApi.readCapability.mockResolvedValue(capabilityOf(false))
  FakeSocket.instances = []
  mic.onFrame = null
  vi.stubGlobal('WebSocket', FakeSocket)
})

enableAutoUnmount(afterEach)

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

async function render() {
  signIn()
  const wrapper = mount(KnowledgeChatPage)
  await flushPromises()
  return wrapper
}

describe('首屏', () => {
  it('列出对话，不自动选中任何一个', async () => {
    const wrapper = await render()

    expect(wrapper.text()).toContain('锅炉那几台')
    expect(api.readSession).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('问一句资料里的事')
  })

  it('没标题的对话显示建立时刻而不是空白', async () => {
    api.listSessions.mockResolvedValue([sessionOf('s2')])

    const wrapper = await render()

    expect(wrapper.text()).toContain('未命名')
  })

  it('一个对话都没有时空态说清第一句怎么发', async () => {
    api.listSessions.mockResolvedValue([])

    const wrapper = await render()

    expect(wrapper.text()).toContain('还没有对话')
    expect(wrapper.text()).toContain('直接在右边发第一句')
  })
})

describe('切对话', () => {
  it('点一个就回放它的历史', async () => {
    const wrapper = await render()

    await wrapper.find('button[title="锅炉那几台"]').trigger('click')
    await flushPromises()

    expect(api.readSession.mock.calls[0]?.[0]).toBe('s1')
    expect(wrapper.text()).toContain('早先问过')
  })

  it('慢回来的那一次不许盖后选的', async () => {
    // ⚠ 不防的话，时间线上是上一个对话的历史而标题是这一个的
    api.listSessions.mockResolvedValue([
      sessionOf('s1', '甲'),
      sessionOf('s2', '乙'),
    ])
    let releaseFirst: (value: KnowledgeChatSessionDetail) => void = () =>
      undefined
    api.readSession
      .mockImplementationOnce(
        () =>
          new Promise<KnowledgeChatSessionDetail>((resolve) => {
            releaseFirst = resolve
          }),
      )
      .mockResolvedValueOnce(detailOf('s2', '乙的历史'))
    const wrapper = await render()

    await wrapper.find('button[title="甲"]').trigger('click')
    await wrapper.find('button[title="乙"]').trigger('click')
    await flushPromises()
    releaseFirst(detailOf('s1', '甲的历史'))
    await flushPromises()

    expect(wrapper.text()).toContain('乙的历史')
    expect(wrapper.text()).not.toContain('甲的历史')
  })
})

describe('发一句', () => {
  it('没有对话时先自动建一个再发', async () => {
    api.listSessions.mockResolvedValue([])
    api.createSession.mockResolvedValue(sessionOf('s9'))
    api.readSession.mockResolvedValue({ ...sessionOf('s9'), messages: [] })
    const wrapper = await render()

    await wrapper.find('textarea').setValue('上限多少')
    await wrapper.find('button[aria-label="发送"]').trigger('click')
    await flushPromises()

    expect(api.createSession).toHaveBeenCalledTimes(1)
    expect(api.advanceTurn.mock.calls[0]?.[0]).toBe('s9')
    expect(wrapper.text()).toContain('上限 65 ℃')
  })

  it('普通 Enter 发送，IME 选字中的 Enter 不发送', async () => {
    api.listSessions.mockResolvedValue([])
    api.createSession.mockResolvedValue(sessionOf('s9'))
    api.readSession.mockResolvedValue({ ...sessionOf('s9'), messages: [] })
    const wrapper = await render()

    // ⚠ 选字那一下也是 Enter：不认 isComposing 就会把半截拼音发出去
    await wrapper.find('textarea').setValue('shang xian')
    await wrapper
      .find('textarea')
      .trigger('keydown', { key: 'Enter', isComposing: true })
    await flushPromises()
    expect(api.advanceTurn).not.toHaveBeenCalled()

    await wrapper.find('textarea').setValue('上限多少')
    await wrapper.find('textarea').trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(api.advanceTurn).toHaveBeenCalledTimes(1)
  })

  it('信封里只自报 user.ask，没有工作面', async () => {
    api.listSessions.mockResolvedValue([])
    api.createSession.mockResolvedValue(sessionOf('s9'))
    api.readSession.mockResolvedValue({ ...sessionOf('s9'), messages: [] })
    const wrapper = await render()

    await wrapper.find('textarea').setValue('上限多少')
    await wrapper.find('button[aria-label="发送"]').trigger('click')
    await flushPromises()

    const body = api.advanceTurn.mock.calls[0]?.[1] as Record<string, unknown>
    expect(body.client_tools).toEqual(['user.ask'])
    expect(body).not.toHaveProperty('surface_kind')
  })

  it('空态的开场句点了直接发出去', async () => {
    api.listSessions.mockResolvedValue([])
    api.createSession.mockResolvedValue(sessionOf('s9'))
    api.readSession.mockResolvedValue({ ...sessionOf('s9'), messages: [] })
    const wrapper = await render()

    const starter = wrapper
      .findAll('button')
      .find((one) => one.text().includes('润滑周期'))
    await starter?.trigger('click')
    await flushPromises()

    expect(api.advanceTurn).toHaveBeenCalledTimes(1)
  })
})

describe('管理对话', () => {
  it('建、改名、归档、删各打各的端点', async () => {
    api.createSession.mockResolvedValue(sessionOf('s9'))
    api.readSession.mockResolvedValue({ ...sessionOf('s9'), messages: [] })
    api.renameSession.mockResolvedValue(sessionOf('s1', '改了'))
    api.archiveSession.mockResolvedValue({
      ...sessionOf('s1'),
      is_archived: true,
    })
    api.deleteSession.mockResolvedValue(undefined)
    const wrapper = await render()

    await wrapper.find('button[aria-label="归档"]').trigger('click')
    await flushPromises()
    expect(api.archiveSession).toHaveBeenCalledWith('s1')
    expect(wrapper.text()).not.toContain('锅炉那几台')

    const buttons = wrapper.findAll('button')
    await buttons.find((one) => one.text() === '新对话')?.trigger('click')
    await flushPromises()
    expect(api.createSession).toHaveBeenCalledTimes(1)

    // ⚠ vi.resetAllMocks 会把确认桩清成 undefined，要「确定」的用例每条自己置位
    confirmSpy.mockResolvedValue(true)
    await wrapper.find('button[aria-label="删除"]').trigger('click')
    await flushPromises()
    expect(api.deleteSession).toHaveBeenCalledWith('s9')
  })

  it('删除要二次确认，取消就不打接口', async () => {
    // ⚠ 问答记录跟着一起没，没有确认框的话误点一下就全没了
    api.deleteSession.mockResolvedValue(undefined)
    confirmSpy.mockResolvedValue(false)
    const wrapper = await render()

    await wrapper.find('button[aria-label="删除"]').trigger('click')
    await flushPromises()

    expect(confirmSpy).toHaveBeenCalledTimes(1)
    expect(api.deleteSession).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('锅炉那几台')
  })

  it('后端的那句原话原样摆出来', async () => {
    api.createSession.mockRejectedValue(new Error('这套部署没有接对话档'))
    const wrapper = await render()

    await wrapper
      .findAll('button')
      .find((one) => one.text() === '新对话')
      ?.trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('这套部署没有接对话档')
  })
})

describe('面板标题栏', () => {
  it('没选中时写「新对话」，选中后写它的名字', async () => {
    const wrapper = await render()
    expect(wrapper.find('.chat-panel__where').text()).toBe('新对话')

    await wrapper.find('button[title="锅炉那几台"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('.chat-panel__where').text()).toBe('锅炉那几台')
  })

  it('回合跑着时标出「回答中」，答完就撤', async () => {
    let release: () => void = () => undefined
    api.advanceTurn.mockImplementation(async function* () {
      await new Promise<void>((resolve) => {
        release = resolve
      })
      yield frame('turn.done', { reply: '好' })
    })
    api.listSessions.mockResolvedValue([])
    api.createSession.mockResolvedValue(sessionOf('s9'))
    api.readSession.mockResolvedValue({ ...sessionOf('s9'), messages: [] })
    const wrapper = await render()

    await wrapper.find('textarea').setValue('上限多少')
    await wrapper.find('button[aria-label="发送"]').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('回答中')

    release()
    await flushPromises()
    expect(wrapper.text()).not.toContain('回答中')
  })

  it('清空键没内容时禁着，答完一轮点它就清掉这一屏', async () => {
    api.listSessions.mockResolvedValue([])
    api.createSession.mockResolvedValue(sessionOf('s9'))
    api.readSession.mockResolvedValue({ ...sessionOf('s9'), messages: [] })
    const wrapper = await render()
    const clear = () => wrapper.find('button[aria-label="清空这一屏的对话"]')
    expect(clear().attributes('disabled')).toBeDefined()

    await wrapper.find('textarea').setValue('上限多少')
    await wrapper.find('button[aria-label="发送"]').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('上限 65 ℃')

    await clear().trigger('click')

    expect(wrapper.text()).not.toContain('上限 65 ℃')
    expect(wrapper.text()).toContain('问一句资料里的事')
  })
})

describe('语音输入', () => {
  it('接了语音识别才有麦克风键', async () => {
    knowledgeApi.readCapability.mockResolvedValue(capabilityOf(true))
    const wrapper = await render()

    expect(wrapper.find('button[aria-label="开始语音输入"]').exists()).toBe(
      true,
    )
  })

  it('没接就没有那枚键', async () => {
    const wrapper = await render()

    expect(wrapper.find('button[aria-label="开始语音输入"]').exists()).toBe(
      false,
    )
  })

  it('能力接口挂了不挡对话：没有键、也不报错', async () => {
    knowledgeApi.readCapability.mockRejectedValue(new Error('后端没起'))
    const wrapper = await render()

    expect(wrapper.find('button[aria-label="开始语音输入"]').exists()).toBe(
      false,
    )
    expect(wrapper.text()).not.toContain('后端没起')
    expect(wrapper.text()).toContain('锅炉那几台')
  })

  it('点麦克风说一句，转写进草稿，发出去的就是它', async () => {
    knowledgeApi.readCapability.mockResolvedValue(capabilityOf(true))
    api.listSessions.mockResolvedValue([])
    api.createSession.mockResolvedValue(sessionOf('s9'))
    api.readSession.mockResolvedValue({ ...sessionOf('s9'), messages: [] })
    const wrapper = await render()

    await wrapper.find('button[aria-label="开始语音输入"]').trigger('click')
    await flushPromises()
    hear({ type: 'system', event: 'ready' })
    hear({ type: 'data', payload: { stage: 'partial', text: '冷却水出口' } })
    await flushPromises()
    expect(wrapper.find<HTMLTextAreaElement>('textarea').element.value).toBe(
      '冷却水出口',
    )

    await wrapper.find('button[aria-label="结束语音输入"]').trigger('click')
    hear({
      type: 'data',
      payload: { stage: 'final', text: '冷却水出口温度的上限是多少？' },
    })
    hear({ type: 'system', event: 'done' })
    await flushPromises()
    expect(wrapper.text()).not.toContain('整理中')

    await wrapper.find('button[aria-label="发送"]').trigger('click')
    await flushPromises()

    const body = api.advanceTurn.mock.calls[0]?.[1] as Record<string, unknown>
    expect(body.user_text).toBe('冷却水出口温度的上限是多少？')
  })
})
