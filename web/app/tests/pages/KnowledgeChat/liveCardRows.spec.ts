/** @fileoverview 多点位卡片同轮归组与历史回放边界。 */
import { expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import type { KnowledgeConversation } from '@/composables/useKnowledgeConversation'
import ChatPanel from '@/pages/KnowledgeChat/components/ChatPanel.vue'
import ChatLivePoint from '@/pages/KnowledgeChat/components/ChatLivePoint.vue'
import type { ChatEntry } from '@/features/ai/conversationLog'
import { liveCardRows } from '@/pages/KnowledgeChat/scripts/liveCardRows'
import { LIVE_POINT } from '@/testing/knowledgeLive'

function card(id: string, state = 'succeeded'): ChatEntry {
  return {
    id,
    role: 'step',
    text: '',
    step: {
      kind: 'tool',
      name: 'collect.watch_point',
      state,
      title: '',
      error: null,
      output: JSON.stringify({
        ...LIVE_POINT,
        node_key: `${LIVE_POINT.node_key}${id}`,
      }),
    },
  }
}

it('groups all selected points in one row across model steps', () => {
  const model: ChatEntry = {
    id: 'model',
    role: 'reasoning',
    text: '打开其它点位',
  }
  const result = liveCardRows([card('a'), model, card('b'), card('c')])
  expect(result.entries.map((one) => one.id)).toEqual(['a', 'model'])
  expect(result.rows.get('a')?.map((one) => one.id)).toEqual(['a', 'b', 'c'])
})

it('starts a separate row for each user turn and retains failures', () => {
  const user: ChatEntry = { id: 'user', role: 'user', text: '另一个设备' }
  const result = liveCardRows([
    card('a'),
    user,
    card('b'),
    card('failed', 'failed'),
  ])
  expect([...result.rows.keys()]).toEqual(['a', 'b'])
  expect(result.entries.map((one) => one.id)).toEqual([
    'a',
    'user',
    'b',
    'failed',
  ])
})

it('keeps the first row identity when another selected point arrives', () => {
  const before = liveCardRows([card('a')])
  const after = liveCardRows([card('a'), card('b')])
  expect([...before.rows.keys()]).toEqual([...after.rows.keys()])
  expect(liveCardRows([]).entries).toEqual([])
})

it('renders a single row with independent cards and enables only the newest six', async () => {
  const entries = ref<readonly ChatEntry[]>([card('a'), card('b')])
  const chat: KnowledgeConversation = {
    entries,
    isRunning: ref(false),
    isAsking: ref(false),
    send: vi.fn(),
    stop: vi.fn(),
    clear: vi.fn(),
    restore: vi.fn(),
    answerAsk: vi.fn(),
    note: vi.fn(),
  }
  const wrapper = mount(ChatPanel, {
    props: {
      chat,
      title: null,
      starters: [],
      speechEnabled: false,
      bases: [],
      scope: null,
    },
    global: { stubs: { ChatLivePoint: true, KnowledgeChatComposer: true } },
  })
  expect(wrapper.findAll('.chat-panel__cards')).toHaveLength(1)
  expect(wrapper.findAllComponents(ChatLivePoint)).toHaveLength(2)
  entries.value = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((id) => card(id))
  await flushPromises()
  const cards = wrapper.findAllComponents(ChatLivePoint)
  expect(cards).toHaveLength(7)
  expect(cards.map((one) => one.props('enabled'))).toEqual([
    false,
    true,
    true,
    true,
    true,
    true,
    true,
  ])
  expect(wrapper.findAll('.chat-panel__cards')).toHaveLength(1)
  wrapper.unmount()
})
