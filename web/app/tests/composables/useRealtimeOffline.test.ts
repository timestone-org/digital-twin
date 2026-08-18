/**
 * @fileoverview 契约：断得够久才报，报了就不自己消失，连上立刻收。
 *
 * ⚠ 守的是「什么时候说」而不只是「说了没有」：一断就闪的提示会被墙上那块屏前
 * 的人学会无视，而真断的那一次也就跟着被无视了。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, h, nextTick, ref, type Ref } from 'vue'

import {
  OFFLINE_GRACE_MS,
  useRealtimeOffline,
} from '@/composables/useRealtimeOffline'

const isConnected = ref(true)

vi.mock('@/composables/useRealtimeChannel', () => ({
  useRealtimeChannel: () => ({
    isConnected,
    subscribe: () => () => undefined,
  }),
}))

const mounted: ReturnType<typeof mount>[] = []

function mountOffline(): Ref<boolean> {
  let created: Ref<boolean> | null = null
  const host = defineComponent({
    setup() {
      created = useRealtimeOffline()
      return () => h('div')
    },
  })
  mounted.push(mount(host))
  if (created === null) throw new Error('composable 还没装起来')
  return created
}

/** 断开并等过宽限期。 */
async function dropFor(ms: number): Promise<void> {
  isConnected.value = false
  await nextTick()
  await vi.advanceTimersByTimeAsync(ms)
}

beforeEach(() => {
  vi.useFakeTimers()
  isConnected.value = true
})

afterEach(() => {
  while (mounted.length > 0) mounted.pop()?.unmount()
  vi.useRealTimers()
})

describe('什么时候报', () => {
  it('连着的时候什么都不报', () => {
    expect(mountOffline().value).toBe(false)
  })

  it('刚断的那一下不报：抖一下就闪一条红条是纯噪音', async () => {
    const isOffline = mountOffline()

    await dropFor(OFFLINE_GRACE_MS - 1)

    expect(isOffline.value).toBe(false)
  })

  it('断够了宽限期才报', async () => {
    const isOffline = mountOffline()

    await dropFor(OFFLINE_GRACE_MS)

    expect(isOffline.value).toBe(true)
  })

  it('宽限期内连回来就当没发生过', async () => {
    const isOffline = mountOffline()

    await dropFor(OFFLINE_GRACE_MS - 1)
    isConnected.value = true
    await nextTick()
    await vi.advanceTimersByTimeAsync(OFFLINE_GRACE_MS * 2)

    expect(isOffline.value).toBe(false)
  })
})

describe('什么时候收', () => {
  it('只有真连上才收，不会自己淡掉', async () => {
    const isOffline = mountOffline()

    await dropFor(OFFLINE_GRACE_MS)
    // 大屏没人盯着操作，提示自动消失等于没提示过
    await vi.advanceTimersByTimeAsync(OFFLINE_GRACE_MS * 100)
    expect(isOffline.value).toBe(true)

    isConnected.value = true
    await nextTick()

    expect(isOffline.value).toBe(false)
  })

  it('反复断连不会漏掉最后那一次的状态', async () => {
    const isOffline = mountOffline()

    await dropFor(OFFLINE_GRACE_MS)
    isConnected.value = true
    await nextTick()
    await dropFor(OFFLINE_GRACE_MS)

    expect(isOffline.value).toBe(true)
  })
})

describe('清理', () => {
  it('卸载后到点的定时器不再写状态', async () => {
    const isOffline = mountOffline()

    isConnected.value = false
    await nextTick()
    mounted.pop()?.unmount()
    await vi.advanceTimersByTimeAsync(OFFLINE_GRACE_MS * 2)

    expect(isOffline.value).toBe(false)
  })
})
