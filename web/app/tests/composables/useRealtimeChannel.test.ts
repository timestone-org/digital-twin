/**
 * @fileoverview 实时通道的行为契约。
 *
 * 这个文件守的是四条**只有在现场才会暴露**的事：
 * 1. 握手必须报两个子协议（`dt.auth` + token）——浏览器不允许自定义头，
 *    少一个就永远连不上，而错误只是一句「握手失败」。
 * 2. 重连后必须把已有订阅**重订一遍**：连上了却收不到数据是最难查的一种。
 * 3. 最后一个订阅者走了才退订：还有人在看时退订，另一半页面会静默停更。
 * 4. 重连要退避：不退避的话 hub 一挂，全站客户端会一起打它。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

import {
  AUTH_SUBPROTOCOL,
  CLOSE_TOKEN_EXPIRED,
  closeRealtimeChannel,
  useRealtimeChannel,
} from '@/composables/useRealtimeChannel'
import { REALTIME_AUTH_EXPIRED_CLOSE_CODE } from '@dt/contracts'
import { STORAGE_KEYS } from '@dt/security'

type Listener = (event: unknown) => void

/** 记下每次构造与发送的假 WebSocket。 */
class FakeSocket {
  static instances: FakeSocket[] = []
  static readonly OPEN = 1

  readyState = FakeSocket.OPEN
  sent: string[] = []
  closed = false
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

  send(text: string): void {
    this.sent.push(text)
  }

  close(): void {
    this.closed = true
  }

  emit(type: string, event: unknown = {}): void {
    for (const handler of this.listeners.get(type) ?? []) handler(event)
  }
}

function latest(): FakeSocket {
  const socket = FakeSocket.instances.at(-1)
  if (socket === undefined) throw new Error('还没有建立过连接')
  return socket
}

beforeEach(() => {
  vi.useFakeTimers()
  setActivePinia(createPinia())
  localStorage.setItem(STORAGE_KEYS.accessToken, 'tok-1')
  FakeSocket.instances = []
  vi.stubGlobal('WebSocket', FakeSocket)
})

afterEach(() => {
  closeRealtimeChannel()
  vi.unstubAllGlobals()
  vi.useRealTimers()
  localStorage.clear()
})

describe('实时通道', () => {
  it('⚠ 握手报两个子协议：标记在前、token 在后', () => {
    useRealtimeChannel()
    expect(latest().protocols).toEqual([AUTH_SUBPROTOCOL, 'tok-1'])
    expect(latest().url).toContain('/api/v1/realtime/ws')
  })

  it('没有令牌时不连——连上也订不到任何主题', () => {
    localStorage.removeItem(STORAGE_KEYS.accessToken)
    useRealtimeChannel()
    expect(FakeSocket.instances).toHaveLength(0)
  })

  it('订阅在连接就绪后发出，退订在最后一个订阅者走时发出', () => {
    const channel = useRealtimeChannel()
    latest().emit('open')
    const off = channel.subscribe('opcua:1', () => {})
    expect(latest().sent).toContain(
      JSON.stringify({ action: 'subscribe', topic: 'opcua:1' }),
    )
    off()
    expect(latest().sent).toContain(
      JSON.stringify({ action: 'unsubscribe', topic: 'opcua:1' }),
    )
  })

  it('⚠ 还有人在看时不退订', () => {
    const channel = useRealtimeChannel()
    latest().emit('open')
    const first = channel.subscribe('opcua:1', () => {})
    channel.subscribe('opcua:1', () => {})
    first()
    const unsubscribed = latest().sent.filter((item) =>
      item.includes('unsubscribe'),
    )
    expect(unsubscribed).toEqual([])
  })

  it('推送按主题分发，别的主题收不到', () => {
    const channel = useRealtimeChannel()
    latest().emit('open')
    const mine: unknown[] = []
    const other: unknown[] = []
    channel.subscribe('opcua:1', (payload) => mine.push(payload))
    channel.subscribe('opcua:2', (payload) => other.push(payload))
    latest().emit('message', {
      data: JSON.stringify({
        type: 'data',
        topic: 'opcua:1',
        payload: { items: [1] },
      }),
    })
    expect(mine).toEqual([{ items: [1] }])
    expect(other).toEqual([])
  })

  it('坏帧不会掀翻分发', () => {
    const channel = useRealtimeChannel()
    latest().emit('open')
    const seen: unknown[] = []
    channel.subscribe('opcua:1', (payload) => seen.push(payload))
    latest().emit('message', { data: '{"topic":123}' })
    latest().emit('message', { data: '{"topic":"opcua:1"}' })
    expect(seen).toEqual([])
  })

  it('⚠ 重连后把已有订阅重订一遍', () => {
    const channel = useRealtimeChannel()
    latest().emit('open')
    channel.subscribe('opcua:1', () => {})
    latest().emit('close', { code: 1006 })
    vi.advanceTimersByTime(1000)
    latest().emit('open')
    expect(latest().sent).toContain(
      JSON.stringify({ action: 'subscribe', topic: 'opcua:1' }),
    )
  })

  it('⚠ 重连退避：第二次要等更久', () => {
    useRealtimeChannel()
    latest().emit('close', { code: 1006 })
    vi.advanceTimersByTime(999)
    expect(FakeSocket.instances).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(FakeSocket.instances).toHaveLength(2)

    latest().emit('close', { code: 1006 })
    vi.advanceTimersByTime(1999)
    expect(FakeSocket.instances).toHaveLength(2)
    vi.advanceTimersByTime(1)
    expect(FakeSocket.instances).toHaveLength(3)
  })

  it('⚠ 关闭码取自契约包，不是就地再写一个 4001', () => {
    expect(CLOSE_TOKEN_EXPIRED).toBe(REALTIME_AUTH_EXPIRED_CLOSE_CODE)
  })

  it('⚠ 票过期（4001）把退避重置——那是换票重连，不是网络故障', () => {
    useRealtimeChannel()
    latest().emit('close', { code: 1006 })
    vi.advanceTimersByTime(1000)
    latest().emit('close', { code: CLOSE_TOKEN_EXPIRED })
    // 退避被重置回起点，1 秒后就重连
    vi.advanceTimersByTime(1000)
    expect(FakeSocket.instances).toHaveLength(3)
  })

  it('非对象与 null 载荷都被跳过', () => {
    // ⚠ 帧来自另一个服务：形状变了只能跳过，不能让分发循环崩掉
    const channel = useRealtimeChannel()
    latest().emit('open')
    const seen: unknown[] = []
    channel.subscribe('opcua:1', (payload) => seen.push(payload))
    latest().emit('message', { data: '"just a string"' })
    latest().emit('message', { data: 'null' })
    latest().emit('message', {
      data: JSON.stringify({ topic: 'opcua:1', payload: null }),
    })
    expect(seen).toEqual([])
  })

  it('已经连着时不重复建连', () => {
    // ⚠ 一个应用一条连接：每次调用都建一条的话，切页面会反复握手
    useRealtimeChannel()
    useRealtimeChannel()
    expect(FakeSocket.instances).toHaveLength(1)
  })

  it('退订一个从没订过的主题是安全的', () => {
    const channel = useRealtimeChannel()
    latest().emit('open')
    const off = channel.subscribe('opcua:1', () => {})
    off()
    // 再退一次：桶已经没了，不该抛
    expect(() => off()).not.toThrow()
  })

  it('没有待重连的定时器时关闭也安全', () => {
    useRealtimeChannel()
    expect(() => closeRealtimeChannel()).not.toThrow()
  })

  it('关闭通道后不再重连', () => {
    useRealtimeChannel()
    const socket = latest()
    closeRealtimeChannel()
    expect(socket.closed).toBe(true)
    socket.emit('close', { code: 1006 })
    vi.advanceTimersByTime(60_000)
    expect(FakeSocket.instances).toHaveLength(1)
  })
})
