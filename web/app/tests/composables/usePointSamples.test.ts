/** @fileoverview 点位快照缓存：同一点位再来一帧画面要跟着变，一帧多点不能每点复制一整份表。 */
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { computed, defineComponent, h } from 'vue'
import type { PointSample } from '@dt/contracts'

import {
  usePointSamples,
  type PointSamples,
} from '@/composables/usePointSamples'

const provider = vi.hoisted(() => ({
  onValue: null as ((key: string, sample: PointSample) => void) | null,
}))

vi.mock('@dt/datasources', () => ({
  hasProvider: () => true,
  getProvider: () => ({
    subscribe: (
      _keys: readonly string[],
      onValue: (key: string, sample: never) => void,
    ) => {
      provider.onValue = onValue
      return () => undefined
    },
  }),
}))

function sample(value: number): PointSample {
  return { state: 'ok', value, timestampMs: 0, quality: 'good' }
}

function host(keys: string[]): PointSamples {
  let made: PointSamples | null = null
  mount(
    defineComponent({
      setup() {
        made = usePointSamples(
          () => keys,
          () => 'screen-1',
        )
        return () => h('div')
      },
    }),
  )
  if (made === null) throw new Error('没挂上')
  return made
}

function push(key: string, value: number): void {
  if (provider.onValue === null) throw new Error('没订上')
  provider.onValue(key, sample(value))
}

const NativeMap = globalThis.Map

afterEach(() => {
  globalThis.Map = NativeMap
})

describe('usePointSamples', () => {
  it('同一点位第二帧到了，读它的 computed 跟着重算', () => {
    const points = host(['k'])
    const shown = computed(() => {
      const read = points.read('k')
      return read?.state === 'ok' ? read.value : undefined
    })
    push('k', 1)
    expect(shown.value).toBe(1)
    push('k', 2)
    expect(shown.value).toBe(2)
  })

  it('一帧 500 个点不会每点复制一整份表', () => {
    const keys = Array.from({ length: 500 }, (_, at) => `k${at}`)
    const points = host(keys)
    let constructed = 0
    class CountingMap<K, V> extends NativeMap<K, V> {
      constructor(entries?: Iterable<readonly [K, V]> | null) {
        super(entries)
        constructed += 1
      }
    }
    globalThis.Map = CountingMap
    for (const [at, key] of keys.entries()) push(key, at)
    globalThis.Map = NativeMap
    expect(constructed).toBeLessThan(5)
    expect(points.sampleCount.value).toBe(500)
  })
})
