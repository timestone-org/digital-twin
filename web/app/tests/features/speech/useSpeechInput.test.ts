/**
 * @fileoverview 语音输入状态机的契约：握手报 `dt.auth` + token；ready 之前的帧攒着、
 * 之后按序送出；转写整段替换不拼接；stop 走「送 stop → 收 done → idle」；
 * 关闭码 1013 / 1008 各有一句话；作用域没了就作废并把麦克风与连接都放掉。
 */
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'
import { REALTIME_AUTH_SUBPROTOCOL } from '@dt/contracts'

import {
  useSpeechInput,
  type SpeechInput,
} from '@/features/speech/useSpeechInput'
import { useAuthStore } from '@/stores/auth'

type Listener = (event: unknown) => void

/** 记下每次构造与发送的假 WebSocket；关闭时同步发一次 close，像真的那样回一枪。 */
class FakeSocket {
  static instances: FakeSocket[] = []
  static readonly CONNECTING = 0
  static readonly OPEN = 1

  readyState = FakeSocket.OPEN
  sent: (string | ArrayBuffer)[] = []
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

  send(data: string | ArrayBuffer): void {
    this.sent.push(data)
  }

  close(): void {
    this.closed = true
    this.emit('close', { code: 1000 })
  }

  emit(type: string, event: unknown = {}): void {
    for (const handler of this.listeners.get(type) ?? []) handler(event)
  }

  /** 发出去的二进制帧各多少字节。 */
  binaryLengths(): number[] {
    return this.sent.flatMap((one) =>
      one instanceof ArrayBuffer ? [one.byteLength] : [],
    )
  }

  /** 发出去的动作名，按序。 */
  actions(): string[] {
    return this.sent.flatMap((one) =>
      typeof one === 'string'
        ? [String((JSON.parse(one) as Record<string, unknown>)['action'])]
        : [],
    )
  }
}

const mic = vi.hoisted(() => ({
  onFrame: null as ((frame: ArrayBuffer) => void) | null,
  stop: vi.fn(),
  failure: null as Error | null,
}))

vi.mock('@/features/speech/pcmCapture', () => ({
  startPcmCapture: (onFrame: (frame: ArrayBuffer) => void) => {
    if (mic.failure !== null) return Promise.reject(mic.failure)
    mic.onFrame = onFrame
    return Promise.resolve({ stop: mic.stop })
  },
}))

function latest(): FakeSocket {
  const socket = FakeSocket.instances.at(-1)
  if (socket === undefined) throw new Error('还没有建立过连接')
  return socket
}

function frame(body: unknown): string {
  return JSON.stringify(body)
}

const READY = frame({ type: 'system', event: 'ready' })
const DONE = frame({ type: 'system', event: 'done' })

function partial(text: string): string {
  return frame({ type: 'data', payload: { stage: 'partial', text } })
}

function final(text: string): string {
  return frame({ type: 'data', payload: { stage: 'final', text } })
}

function speak(bytes: number): void {
  if (mic.onFrame === null) throw new Error('麦克风还没开')
  mic.onFrame(new ArrayBuffer(bytes))
}

function hear(raw: string): void {
  latest().emit('message', { data: raw })
}

async function started(): Promise<SpeechInput> {
  const speech = useSpeechInput()
  await speech.start()
  return speech
}

beforeEach(() => {
  setActivePinia(createPinia())
  useAuthStore().accessToken = 'tok-1'
  FakeSocket.instances = []
  mic.onFrame = null
  mic.failure = null
  mic.stop.mockReset()
  vi.stubGlobal('WebSocket', FakeSocket)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('连线', () => {
  it('⚠ 握手报两个子协议：dt.auth 在前、token 在后，路径挂在知识库前缀下', async () => {
    await started()

    expect(latest().protocols).toEqual([REALTIME_AUTH_SUBPROTOCOL, 'tok-1'])
    expect(latest().url).toContain('/api/v1/knowledge/speech/ws')
  })

  it('没有登录态时不连，直接说登录态失效', async () => {
    useAuthStore().accessToken = null

    const speech = await started()

    expect(FakeSocket.instances).toHaveLength(0)
    expect(speech.status.value).toBe('error')
    expect(speech.error.value).toContain('登录')
  })

  it('ready 之前是 connecting，ready 之后是 listening', async () => {
    const speech = await started()
    expect(speech.status.value).toBe('connecting')

    hear(READY)

    expect(speech.status.value).toBe('listening')
  })
})

describe('送音频', () => {
  it('⚠ ready 之前的帧攒着不丢，ready 之后按原顺序送出，之后的帧直接送', async () => {
    await started()
    speak(2)
    speak(4)
    expect(latest().binaryLengths()).toEqual([])

    hear(READY)
    expect(latest().binaryLengths()).toEqual([2, 4])

    speak(6)
    expect(latest().binaryLengths()).toEqual([2, 4, 6])
  })

  it('攒的帧超过 5 s 就丢最旧的', async () => {
    await started()
    speak(60_000)
    speak(60_000)
    speak(60_000)

    hear(READY)

    expect(latest().binaryLengths()).toEqual([60_000, 60_000])
  })
})

describe('转写', () => {
  it('每帧都是整段，整体替换而不是拼接', async () => {
    const speech = await started()
    hear(READY)

    hear(partial('冷'))
    expect(speech.transcript.value).toBe('冷')
    hear(partial('冷却水'))
    expect(speech.transcript.value).toBe('冷却水')
    hear(final('冷却水出口温度。'))
    expect(speech.transcript.value).toBe('冷却水出口温度。')
  })

  it('不认识的帧忽略，连接照旧', async () => {
    const speech = await started()
    hear(READY)
    hear(partial('冷'))

    hear('{nope')
    hear(frame({ type: 'ack' }))

    expect(speech.transcript.value).toBe('冷')
    expect(speech.status.value).toBe('listening')
  })
})

describe('说完了', () => {
  it('stop 送 stop 动作、停麦、进入 finishing；收到 done 回 idle 且转写留着', async () => {
    const speech = await started()
    hear(READY)
    hear(partial('冷却水'))

    speech.stop()
    expect(latest().actions()).toEqual(['stop'])
    expect(mic.stop).toHaveBeenCalledTimes(1)
    expect(speech.status.value).toBe('finishing')

    hear(final('冷却水出口温度的上限是多少？'))
    hear(DONE)
    expect(speech.status.value).toBe('idle')
    expect(speech.transcript.value).toBe('冷却水出口温度的上限是多少？')
    expect(latest().closed).toBe(true)
  })

  it('⚠ ready 还没到就按了 stop：先把攒的帧送完，再送 stop', async () => {
    const speech = await started()
    speak(2)
    speech.stop()
    expect(latest().actions()).toEqual([])

    hear(READY)

    expect(latest().binaryLengths()).toEqual([2])
    expect(latest().actions()).toEqual(['stop'])
    expect(latest().sent.at(-1)).toBeTypeOf('string')
    expect(speech.status.value).toBe('finishing')
  })

  it('finishing 期间服务端直接关了也算说完', async () => {
    const speech = await started()
    hear(READY)
    speech.stop()

    latest().emit('close', { code: 1000 })

    expect(speech.status.value).toBe('idle')
    expect(speech.error.value).toBe('')
  })

  it('done 迟迟不来，兜底超时后也回 idle', async () => {
    vi.useFakeTimers()
    const speech = await started()
    hear(READY)
    speech.stop()

    vi.advanceTimersByTime(8_000)

    expect(speech.status.value).toBe('idle')
  })

  it('没在录时 stop 什么都不做', () => {
    const speech = useSpeechInput()

    speech.stop()

    expect(speech.status.value).toBe('idle')
    expect(FakeSocket.instances).toHaveLength(0)
  })
})

describe('出错', () => {
  it('1013 是这套部署此刻没有语音识别', async () => {
    const speech = await started()

    latest().emit('close', { code: 1013 })

    expect(speech.status.value).toBe('error')
    expect(speech.error.value).toBe('这套部署的语音识别此刻不可用')
    expect(mic.stop).toHaveBeenCalledTimes(1)
  })

  it('1008 是登录态失效', async () => {
    const speech = await started()

    latest().emit('close', { code: 1008 })

    expect(speech.error.value).toBe('登录态失效，重新登录后再试')
  })

  it('其它异常关闭是连接断了', async () => {
    const speech = await started()
    hear(READY)

    latest().emit('close', { code: 1006 })

    expect(speech.error.value).toBe('语音识别连接断了')
  })

  it('error 帧把服务端那句原话摆出来，随后连接关掉', async () => {
    const speech = await started()

    hear(frame({ type: 'error', code: 42330, message: '识别服务没接上' }))

    expect(speech.error.value).toBe('识别服务没接上')
    expect(latest().closed).toBe(true)
  })

  it('开麦失败把那句原因摆出来，并把连接关掉', async () => {
    mic.failure = new Error('浏览器只在 HTTPS 或 localhost 页面上开放麦克风')

    const speech = await started()

    expect(speech.status.value).toBe('error')
    expect(speech.error.value).toContain('HTTPS')
    expect(latest().closed).toBe(true)
  })

  it('出错之后再 start 会清掉上一次的错并重新连', async () => {
    const speech = await started()
    latest().emit('close', { code: 1013 })

    await speech.start()

    expect(speech.error.value).toBe('')
    expect(FakeSocket.instances).toHaveLength(2)
  })
})

describe('作废', () => {
  it('cancel 送 cancel 动作、关连接、停麦、转写清空', async () => {
    const speech = await started()
    hear(READY)
    hear(partial('冷却水'))

    speech.cancel()

    expect(latest().actions()).toEqual(['cancel'])
    expect(latest().closed).toBe(true)
    expect(mic.stop).toHaveBeenCalledTimes(1)
    expect(speech.transcript.value).toBe('')
    expect(speech.status.value).toBe('idle')
  })

  it('⚠ 作用域没了等于 cancel：连接与麦克风都放掉', async () => {
    const scope = effectScope()
    const speech = scope.run(() => useSpeechInput())
    if (speech === undefined) throw new Error('作用域没跑起来')
    await speech.start()
    hear(READY)

    scope.stop()

    expect(latest().closed).toBe(true)
    expect(mic.stop).toHaveBeenCalledTimes(1)
    expect(speech.status.value).toBe('idle')
  })

  it('等麦克风授权时取消了，授权下来的那路麦克风也要放掉', async () => {
    const speech = useSpeechInput()
    // 不 await：授权还挂着的时候就取消
    const starting = speech.start()
    speech.cancel()
    await starting

    expect(mic.stop).toHaveBeenCalledTimes(1)
    expect(speech.status.value).toBe('idle')
    expect(latest().closed).toBe(true)
  })
})
