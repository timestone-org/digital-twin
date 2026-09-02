/**
 * @fileoverview 知识库对话页的行为契约。
 *
 * ⚠ 最要紧的三条：没有对话时发第一句要**自动建一个**（进来就想问的人不该先找
 * 「新建」按钮）；切对话要回放它的历史且慢回来的那次不许盖后选的；出错把后端
 * 那句原话摆出来。
 */
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import type {
  KnowledgeChatSession,
  KnowledgeChatSessionDetail,
} from '@dt/contracts'

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

vi.mock('vue-router', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useRoute: () => ({ path: '/knowledge/chat', query: {} }),
  RouterLink: { template: '<a><slot /></a>' },
}))

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
})

enableAutoUnmount(afterEach)

afterEach(() => {
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

    await wrapper.find('button[aria-label="删除"]').trigger('click')
    await flushPromises()
    expect(api.deleteSession).toHaveBeenCalledWith('s9')
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
