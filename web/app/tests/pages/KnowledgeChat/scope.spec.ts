/**
 * @fileoverview 这一页怎么用检索范围：默认全部、改了写回会话、切对话跟着恢复、
 * 还没建会话时先攒着、冲突时说清而不是默默覆盖（ADR-0044）。
 */
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import {
  KNOWLEDGE_CHAT_CONFLICT_CODE,
  type KnowledgeChatSession,
} from '@dt/contracts'

import { BizError } from '@/api/client'
import type { KnowledgeBase, KnowledgeCapability } from '@/api/knowledge'
import KnowledgeChatPage from '@/pages/KnowledgeChat/index.vue'
import { useAuthStore } from '@/stores/auth'

const api = vi.hoisted(() => ({
  listSessions: vi.fn(),
  createSession: vi.fn(),
  readSession: vi.fn(),
  renameSession: vi.fn(),
  archiveSession: vi.fn(),
  deleteSession: vi.fn(),
  setSessionScope: vi.fn(),
  advanceTurn: vi.fn(),
}))

vi.mock('@/api/knowledgeChat', () => api)

const knowledgeApi = vi.hoisted(() => ({
  readCapability: vi.fn(),
  listBases: vi.fn(),
}))

vi.mock('@/api/knowledge', () => knowledgeApi)

vi.mock('vue-router', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useRoute: () => ({ path: '/knowledge/chat', query: {} }),
  RouterLink: { template: '<a><slot /></a>' },
}))

function baseOf(id: string, name: string): KnowledgeBase {
  return {
    id,
    name,
    description: '',
    strategy: 'hybrid',
    embeddingModel: null,
    dimensions: null,
    documentCount: 0,
    createdAt: '',
  }
}

function capability(): KnowledgeCapability {
  return {
    isEmbeddingEnabled: true,
    isModelEnabled: true,
    isAsrEnabled: false,
    strategies: ['hybrid'],
    readyStrategies: ['hybrid'],
    acceptedSuffixes: ['.md'],
    index: { vector: 'pgvector', keyword: 'trgm', reason: '' },
    rerank: { isEnabled: false, model: '', reason: '这套部署没接重排' },
  }
}

function sessionOf(
  id: string,
  scope: KnowledgeChatSession['base_scope'],
  rowVersion = 1,
): KnowledgeChatSession {
  return {
    id,
    user_id: 'u1',
    title: id,
    base_scope: scope,
    is_archived: false,
    row_version: rowVersion,
    last_error: null,
    created_at: '2026-09-03T00:00:00.000Z',
    updated_at: '2026-09-03T00:00:00.000Z',
  }
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
  api.listSessions.mockResolvedValue([sessionOf('s1', null)])
  api.readSession.mockResolvedValue({ ...sessionOf('s1', null), messages: [] })
  knowledgeApi.readCapability.mockResolvedValue(capability())
  knowledgeApi.listBases.mockResolvedValue([
    baseOf('b1', '手册库'),
    baseOf('b2', '规程库'),
  ])
})

enableAutoUnmount(afterEach)

afterEach(() => {
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

async function render() {
  signIn()
  const wrapper = mount(KnowledgeChatPage, { attachTo: document.body })
  await flushPromises()
  return wrapper
}

function trigger(): HTMLButtonElement {
  const found = document.querySelector('button.chat-scope__trigger')
  if (!(found instanceof HTMLButtonElement)) throw new Error('没有范围选择器')
  return found
}

async function pick(label: string): Promise<void> {
  trigger().click()
  await flushPromises()
  const box = [...document.querySelectorAll('label')]
    .find((node) => node.textContent?.includes(label))
    ?.querySelector('input[type="checkbox"]')
  if (!(box instanceof HTMLInputElement)) throw new Error(`没有「${label}」`)
  box.click()
  await flushPromises()
}

async function selectSession(id: string): Promise<void> {
  const found = [...document.querySelectorAll('button')].find(
    (node) => node.getAttribute('title') === id,
  )
  found?.click()
  await flushPromises()
}

describe('范围选择器', () => {
  it('新对话默认全部知识库', async () => {
    await render()

    expect(trigger().textContent).toContain('全部知识库')
  })

  it('改了就写回这条会话，带上手上那份的行版本', async () => {
    api.setSessionScope.mockResolvedValue(
      sessionOf(
        's1',
        [{ base_id: 'b2', name: '规程库', is_missing: false }],
        2,
      ),
    )
    await render()
    await selectSession('s1')

    await pick('手册库')

    expect(api.setSessionScope).toHaveBeenCalledWith('s1', ['b2'], 1)
    expect(trigger().textContent).toContain('规程库')
  })

  it('切到另一条对话，选择器跟着恢复那一条的范围', async () => {
    api.listSessions.mockResolvedValue([
      sessionOf('s1', null),
      sessionOf('s2', [{ base_id: 'b1', name: '手册库', is_missing: false }]),
    ])
    await render()

    await selectSession('s2')

    expect(trigger().textContent).toContain('手册库')
  })

  it('⚠ 还没有对话时先攒着，建会话那一刻带上去，不空打一次接口', async () => {
    api.listSessions.mockResolvedValue([])
    api.createSession.mockResolvedValue(
      sessionOf('s9', [{ base_id: 'b2', name: '规程库', is_missing: false }]),
    )
    const wrapper = await render()

    await pick('手册库')
    expect(api.setSessionScope).not.toHaveBeenCalled()

    await wrapper.get('button.chat-scope__trigger').trigger('click')
    const create = wrapper
      .findAll('button')
      .find((one) => one.text().includes('新对话'))
    await create?.trigger('click')
    await flushPromises()

    expect(api.createSession).toHaveBeenCalledWith('', ['b2'])
  })

  it('⚠ 别处刚改过时说清并重新载入，而不是默默盖掉他划的范围', async () => {
    api.setSessionScope.mockRejectedValue(
      new BizError(KNOWLEDGE_CHAT_CONFLICT_CODE, '在别处改过了', 409, 't'),
    )
    const wrapper = await render()
    await selectSession('s1')

    await pick('手册库')

    expect(wrapper.text()).toContain('在别处改过了')
    expect(api.listSessions).toHaveBeenCalledTimes(2)
  })
})
