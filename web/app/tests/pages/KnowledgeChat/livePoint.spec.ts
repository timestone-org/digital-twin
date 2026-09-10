/** @fileoverview 实时卡片的真实渲染、生命周期、同源缓存与竞态。 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { computed, ref } from 'vue'
import * as collect from '@/api/collect'
import ChatLivePoint from '@/pages/KnowledgeChat/components/ChatLivePoint.vue'
import {
  createLiveSources,
  LIVE_SOURCES,
} from '@/pages/KnowledgeChat/scripts/liveSources'
import { FIRST_FRAME_TIMEOUT_MS } from '@/pages/KnowledgeChat/scripts/useLivePoint'
import type { TopicHandler } from '@/runtime/topicRegistry'
import { LIVE_POINT, POINT, POINT_PAGE, SOURCE } from '@/testing/knowledgeLive'

vi.mock('@/api/collect', () => ({ getSource: vi.fn(), listPoints: vi.fn() }))
const transport = vi.hoisted(() => ({ get: vi.fn() }))
vi.mock('@/composables/useRealtimeChannel', () => ({
  useRealtimeChannel: transport.get,
}))
const connected = ref(true)
let handlers = new Map<string, TopicHandler>()
let unsubscribed: string[] = []
let subscriptions: string[] = []
const wrappers: ReturnType<typeof mount>[] = []
function push(value: unknown, quality = 'good') {
  handlers.get(`collect:${SOURCE.id}`)?.({
    items: [
      {
        nodeKey: POINT.node_key,
        state: 'ok',
        value,
        timestampMs: Date.UTC(2026, 8, 10),
        quality,
      },
    ],
  })
}
function open(sources = createLiveSources()) {
  const wrapper = mount(ChatLivePoint, {
    props: { point: LIVE_POINT, enabled: true },
    global: { provide: { [LIVE_SOURCES]: sources }, stubs: { teleport: true } },
  })
  wrappers.push(wrapper)
  return wrapper
}
beforeEach(() => {
  vi.useFakeTimers()
  connected.value = true
  handlers = new Map()
  subscriptions = []
  unsubscribed = []
  vi.mocked(collect.getSource).mockResolvedValue(SOURCE)
  vi.mocked(collect.listPoints).mockResolvedValue(POINT_PAGE)
  transport.get.mockReturnValue({
    isConnected: connected,
    connectionState: computed(() => (connected.value ? 'open' : 'closed')),
    isRejected: ref(false),
    subscribe: (topic: string, handler: TopicHandler) => {
      subscriptions.push(topic)
      handlers.set(topic, handler)
      return () => {
        unsubscribed.push(topic)
        handlers.delete(topic)
      }
    },
  })
})
afterEach(() => {
  for (const wrapper of wrappers.splice(0)) wrapper.unmount()
  vi.useRealTimers()
  vi.resetAllMocks()
})
it('renders streamed zero and false values, quality and sampling time', async () => {
  const wrapper = open()
  await flushPromises()
  expect(wrapper.text()).toContain('等待最新读数')
  push(0)
  await flushPromises()
  expect(wrapper.find('.chat-live-point__value').text()).toContain('0')
  expect(wrapper.text()).toContain('持续接收')
  expect(wrapper.get('.chat-live-point__status').attributes('title')).toContain(
    '2026',
  )
  push(false, 'bad')
  await flushPromises()
  expect(wrapper.find('.chat-live-point__value').text()).toContain('false')
  expect(wrapper.text()).toContain('质量不可用')
})
it('marks old values stale through disconnect and until a new frame arrives', async () => {
  const wrapper = open()
  await flushPromises()
  push(23)
  await flushPromises()
  connected.value = false
  await flushPromises()
  expect(wrapper.text()).toContain('数据可能过期')
  expect(wrapper.find('.chat-live-point__value--stale').text()).toContain('23')
  connected.value = true
  await flushPromises()
  expect(wrapper.text()).toContain('等待最新读数')
  push(24)
  await flushPromises()
  expect(wrapper.text()).toContain('持续接收')
})
it('pauses, restores and unsubscribes on unmount', async () => {
  const wrapper = open()
  await flushPromises()
  push(22)
  await flushPromises()
  await wrapper.find('button').trigger('click')
  await flushPromises()
  expect(wrapper.text()).toContain('已暂停')
  expect(unsubscribed).toHaveLength(1)
  await wrapper.find('button').trigger('click')
  await flushPromises()
  expect(subscriptions).toHaveLength(2)
  wrapper.unmount()
  expect(unsubscribed).toHaveLength(2)
  expect(vi.getTimerCount()).toBe(0)
})
it('second same-source card receives cached initial values and does not unsubscribe the first', async () => {
  const sources = createLiveSources()
  const first = open(sources)
  await flushPromises()
  push(26)
  await flushPromises()
  const second = open(sources)
  await flushPromises()
  expect(second.find('.chat-live-point__value').text()).toContain('26')
  expect(subscriptions).toHaveLength(1)
  second.unmount()
  expect(unsubscribed).toHaveLength(0)
  push(27)
  await flushPromises()
  expect(first.find('.chat-live-point__value').text()).toContain('27')
})
it('does not spin forever when the first frame is missing', async () => {
  const wrapper = open()
  await flushPromises()
  await vi.advanceTimersByTimeAsync(FIRST_FRAME_TIMEOUT_MS)
  expect(wrapper.text()).toContain('尚未收到点位数据')
  expect(wrapper.text()).toContain('重新连接')
})
it('late metadata cannot subscribe after the card is removed', async () => {
  let release: ((value: typeof SOURCE) => void) | undefined
  vi.mocked(collect.getSource).mockImplementation(
    () =>
      new Promise((resolve) => {
        release = resolve
      }),
  )
  const wrapper = open()
  wrapper.unmount()
  release?.(SOURCE)
  await flushPromises()
  expect(subscriptions).toHaveLength(0)
})
it('reports permission revocation while the socket remains connected', async () => {
  const wrapper = open()
  await flushPromises()
  push(22)
  await flushPromises()
  handlers.get(`collect:${SOURCE.id}`)?.onUnavailable?.('实时订阅已被撤回')
  await flushPromises()
  expect(wrapper.text()).toContain('实时订阅已被撤回')
  expect(wrapper.find('.chat-live-point__value--stale').exists()).toBe(true)
})
it('reports missing or denied metadata and never subscribes', async () => {
  vi.mocked(collect.getSource).mockRejectedValue(new Error('无采集权限'))
  const wrapper = open()
  await flushPromises()
  expect(wrapper.text()).toContain('无采集权限')
  expect(subscriptions).toHaveLength(0)
})
it('inactive historical cards release subscriptions', async () => {
  const wrapper = open()
  await flushPromises()
  await wrapper.setProps({ enabled: false })
  await flushPromises()
  expect(wrapper.text()).toContain('已停止')
  expect(unsubscribed).toHaveLength(1)
})

it('detects publisher silence even while the socket is open', async () => {
  const wrapper = open()
  await flushPromises()
  push(22)
  await flushPromises()
  await vi.advanceTimersByTimeAsync(45_000)
  expect(wrapper.text()).toContain('推送已中断')
  expect(wrapper.find('.chat-live-point__value--stale').exists()).toBe(true)
  push(22)
  await flushPromises()
  expect(wrapper.text()).toContain('持续接收')
})
it('unrelated points cannot keep an obsolete reading fresh', async () => {
  const wrapper = open()
  await flushPromises()
  push(22)
  await flushPromises()
  await vi.advanceTimersByTimeAsync(30_000)
  handlers.get(`collect:${SOURCE.id}`)?.({
    items: [
      {
        nodeKey: `${SOURCE.id}:another`,
        state: 'ok',
        value: 99,
        timestampMs: 0,
        quality: 'good',
      },
    ],
  })
  await vi.advanceTimersByTimeAsync(15_000)
  expect(wrapper.text()).toContain('推送已中断')
})

it('changing point identity never relabels the previous point value', async () => {
  const wrapper = open()
  await flushPromises()
  push(22)
  await flushPromises()
  await wrapper.setProps({
    point: {
      ...LIVE_POINT,
      node_key: `${SOURCE.id}:missing`,
      name: '另一个点位',
    },
  })
  await flushPromises()
  expect(wrapper.find('.chat-live-point__value').text()).not.toContain('22')
})

it('defaults numeric readings to two decimal places and allows adjustment', async () => {
  const wrapper = open()
  await flushPromises()
  push(39.78009033203125)
  await flushPromises()
  expect(wrapper.get('.chat-live-point__value').text()).toBe('39.78 ℃')
  await wrapper.get('button[aria-label="数值卡片设置"]').trigger('click')
  await flushPromises()
  await wrapper.get('input[aria-label="小数位"]').setValue('4')
  expect(wrapper.get('.chat-live-point__value').text()).toBe('39.7801 ℃')
  await wrapper.get('input[aria-label="小数位"]').setValue('0')
  expect(wrapper.get('.chat-live-point__value').text()).toBe('40 ℃')
  await wrapper.get('input[aria-label="小数位"]').setValue('')
  expect(wrapper.get('.chat-live-point__value').text()).toBe('39.78 ℃')
  push(0)
  await flushPromises()
  expect(wrapper.get('.chat-live-point__value').text()).toBe('0.00 ℃')
})

it('bounds decimal places and keeps the selection for new readings', async () => {
  const wrapper = open()
  await flushPromises()
  push(-1.23456789)
  await flushPromises()
  await wrapper.get('button[aria-label="数值卡片设置"]').trigger('click')
  await flushPromises()
  await wrapper.get('input[aria-label="小数位"]').setValue('12')
  expect(wrapper.get('.chat-live-point__value').text()).toBe('-1.2345678900 ℃')
  await wrapper.get('input[aria-label="小数位"]').setValue('-1')
  expect(wrapper.get('.chat-live-point__value').text()).toBe('-1 ℃')
  await wrapper.get('input[aria-label="小数位"]').setValue('3')
  push(2.5)
  await flushPromises()
  expect(wrapper.get('.chat-live-point__value').text()).toBe('2.500 ℃')
})

it.each([
  ['running', 'running'],
  ['001.2300', '001.2300'],
  [null, 'null'],
  [true, 'true'],
  [{ value: 1 }, '{"value":1}'],
])('keeps non-numeric reading %j unchanged', async (reading, expected) => {
  const wrapper = open()
  await flushPromises()
  push(reading)
  await flushPromises()
  expect(wrapper.get('.chat-live-point__value').text()).toBe(`${expected} ℃`)
})
