/** @fileoverview 按接收心跳判断点位有效性，不把数值未变化误判为断线。 */
import { computed, onBeforeUnmount, ref, watch, type Ref } from 'vue'

const STREAM_TIMEOUT_MS = 45_000

export function useSampleFreshness(isConnected: Ref<boolean>) {
  const received = ref(new Map<string, number>())
  const now = ref(Date.now())
  const timer = setInterval(() => {
    now.value = Date.now()
  }, 1000)
  const staleKeys = computed(
    () =>
      new Set(
        [...received.value]
          .filter(([, at]) => now.value - at >= STREAM_TIMEOUT_MS)
          .map(([key]) => key),
      ),
  )
  watch(isConnected, (connected) => {
    if (!connected)
      received.value = new Map(
        [...received.value.keys()].map((key) => [key, -Infinity]),
      )
  })
  onBeforeUnmount(() => clearInterval(timer))
  return {
    staleKeys,
    reset: () => {
      received.value = new Map()
    },
    mark: (keys: readonly string[]) => {
      now.value = Date.now()
      const next = new Map(received.value)
      for (const key of keys) next.set(key, now.value)
      received.value = next
    },
  }
}
