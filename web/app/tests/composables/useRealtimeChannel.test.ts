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
  CLOSE_TOKEN_EXPIRED,
  closeRealtimeChannel,
  usePublicRealtimeChannel,
  useRealtimeChannel,
} from '@/composables/useRealtimeChannel'
import {
  REALTIME_AUTH_EXPIRED_CLOSE_CODE,
  REALTIME_AUTH_SUBPROTOCOL as AUTH_SUBPROTOCOL,
  REALTIME_PUBLIC_GRANT_CLOSE_CODE,
  REALTIME_PUBLIC_SUBPROTOCOL as PUBLIC_SUBPROTOCOL,
} from '@dt/contracts'
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

/**
 * 一条载荷帧，字段照 hub 的 `publisher.py::_envelope` 拼全。
 *
 * ⚠ 别在用例里手搓半截帧：少了 `ts`/`seq` 的帧 hub 根本发不出来，
 * 拿它测「分发」等于在测一条现实中不存在的路径。
 * Args: topic, payload。
 */
function dataFrame(topic: string, payload: unknown): string {
  return JSON.stringify({
    type: 'data',
    topic,
    ts: '2026-08-14T09:30:00.000Z',
    seq: 1,
    payload,
    trace_id: '0af7651916cd43dd8448eb211c80319c',
  })
}

/** 取最近一次发出的 `subscribe` 动作里的 topic。 */
function sentTopics(socket: FakeSocket, action: string): string[] {
  return socket.sent
    .map((raw) => JSON.parse(raw) as Record<string, unknown>)
    .filter((message) => message['action'] === action)
    .map((message) => String(message['topic']))
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
    expect(sentTopics(latest(), 'subscribe')).toContain('opcua:1')
    off()
    expect(sentTopics(latest(), 'unsubscribe')).toContain('opcua:1')
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
    latest().emit('message', { data: dataFrame('opcua:1', { items: [1] }) })
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
    expect(sentTopics(latest(), 'subscribe')).toContain('opcua:1')
  })

  it('⚠ 收到 reauth_required 就换票，不然到期必被 4001 关掉', () => {
    const channel = useRealtimeChannel()
    latest().emit('open')
    channel.subscribe('opcua:1', () => {})
    latest().emit('message', {
      data: JSON.stringify({ type: 'system', event: 'reauth_required' }),
    })
    const actions = latest().sent.map(
      (raw) => (JSON.parse(raw) as Record<string, unknown>)['action'],
    )
    expect(actions).toContain('reauth')
  })

  it('⚠ 服务端退掉的主题不许在重连时被重订', () => {
    // 权限被收回后 hub 单方面退订；本地不删的话，每次重连都会再订一次
    // 同一个必然被拒的主题，而本地还以为自己订着
    const channel = useRealtimeChannel()
    latest().emit('open')
    channel.subscribe('opcua:1', () => {})
    channel.subscribe('opcua:2', () => {})
    latest().emit('message', {
      data: JSON.stringify({
        type: 'system',
        event: 'unsubscribed',
        topic: 'opcua:1',
        reason: 'permission_revoked',
      }),
    })
    latest().emit('close', { code: 1006 })
    vi.advanceTimersByTime(1000)
    latest().emit('open')
    const resubscribed = sentTopics(latest(), 'subscribe')
    expect(resubscribed).toContain('opcua:2')
    expect(resubscribed).not.toContain('opcua:1')
  })

  it('⚠ 被退掉的主题也不再收到推送', () => {
    const channel = useRealtimeChannel()
    latest().emit('open')
    const seen: unknown[] = []
    channel.subscribe('opcua:1', (payload) => seen.push(payload))
    latest().emit('message', {
      data: JSON.stringify({
        type: 'system',
        event: 'unsubscribed',
        topic: 'opcua:1',
        reason: 'permission_revoked',
      }),
    })
    latest().emit('message', { data: dataFrame('opcua:1', { items: [1] }) })
    expect(seen).toEqual([])
  })

  it('⚠ 握手被拒（1008）不再重连——换票没用，要回登录态', () => {
    // 拿同一张验不过的票重试，只会打满退避上限空转
    useRealtimeChannel()
    latest().emit('close', { code: 1008 })
    vi.advanceTimersByTime(60_000)
    expect(FakeSocket.instances).toHaveLength(1)
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

describe('公开链接', () => {
  it('⚠ 报的是公开标记与令牌本身，不是 access token', () => {
    usePublicRealtimeChannel('tok-public')
    expect(latest().protocols).toEqual([PUBLIC_SUBPROTOCOL, 'tok-public'])
  })

  it('⚠ 即使当前登录着也用公开票据：公开页订的是别名主题', () => {
    // 拿登录态的票去握手会连上，但那条连接订别名主题一律被拒——表现是
    // 「连着、没有值」，而排查会一路走到后端去
    localStorage.setItem(STORAGE_KEYS.accessToken, 'tok-1')
    usePublicRealtimeChannel('tok-public')
    expect(latest().protocols[1]).toBe('tok-public')
  })

  it('换一枚票据要重连——授权在握手那一刻定死', () => {
    usePublicRealtimeChannel('tok-a')
    const first = latest()
    usePublicRealtimeChannel('tok-b')
    expect(first.closed).toBe(true)
    expect(latest().protocols).toEqual([PUBLIC_SUBPROTOCOL, 'tok-b'])
  })

  it('⚠ 同一枚票据不重复建连', () => {
    usePublicRealtimeChannel('tok-a')
    usePublicRealtimeChannel('tok-a')
    expect(FakeSocket.instances).toHaveLength(1)
  })

  it('⚠ 4003 是可重试的：撤回与「还没对账到」在客户端看来一样', () => {
    const channel = usePublicRealtimeChannel('tok-public')
    latest().emit('close', { code: REALTIME_PUBLIC_GRANT_CLOSE_CODE })
    expect(channel.isRejected.value).toBe(true)
    vi.advanceTimersByTime(1000)
    // 停下不再连的话，刚发布出去的链接会在那几秒的对账窗口里被判成永久失败
    expect(FakeSocket.instances).toHaveLength(2)
  })

  it('⚠ 1008 才是「别再连了」', () => {
    const channel = usePublicRealtimeChannel('tok-public')
    latest().emit('close', { code: 1008 })
    vi.advanceTimersByTime(60_000)
    expect(channel.isRejected.value).toBe(true)
    expect(FakeSocket.instances).toHaveLength(1)
  })

  it('重新连上就把「被拒」这件事收回去', () => {
    const channel = usePublicRealtimeChannel('tok-public')
    latest().emit('close', { code: REALTIME_PUBLIC_GRANT_CLOSE_CODE })
    vi.advanceTimersByTime(1000)
    latest().emit('open')
    expect(channel.isRejected.value).toBe(false)
  })

  it('⚠ 关闭时票据也要清掉，否则回到登录态还在报公开子协议', () => {
    usePublicRealtimeChannel('tok-public')
    closeRealtimeChannel()
    localStorage.setItem(STORAGE_KEYS.accessToken, 'tok-1')

    useRealtimeChannel()

    expect(latest().protocols).toEqual([AUTH_SUBPROTOCOL, 'tok-1'])
  })
})
