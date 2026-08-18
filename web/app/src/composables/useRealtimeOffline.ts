/**
 * @fileoverview 「实时通道断了，而且断得够久」——大屏上该不该报警由它说了算。
 *
 * ⚠ 断开要**压一小会儿再报**：重连退避从 1 秒起步，hub 重启一次可能只断半秒，
 * 一断就在墙上闪一条红条，看的人很快就学会无视它，真断的那次也一起被无视。
 * ⚠ 一旦报出来就**不再自己消失**，只有真连上才消：大屏是没人盯着操作的屏，
 * 提示自动淡掉等于没提示过。
 */
import { onBeforeUnmount, ref, watch, type Ref } from 'vue'

import { useRealtimeChannel } from '@/composables/useRealtimeChannel'

/** 断开多久才承认它是一次故障。比重连退避的起点长一档。 */
export const OFFLINE_GRACE_MS = 3_000

/**
 * 装上「够久的断开」判定。
 * @param graceMs 断开持续多久才报，缺省 3 秒
 */
export function useRealtimeOffline(graceMs = OFFLINE_GRACE_MS): Ref<boolean> {
  const channel = useRealtimeChannel()
  const isOffline = ref(false)
  let timer: ReturnType<typeof setTimeout> | null = null

  function clear(): void {
    if (timer !== null) clearTimeout(timer)
    timer = null
  }

  watch(
    channel.isConnected,
    (isUp) => {
      clear()
      if (isUp) {
        isOffline.value = false
        return
      }
      timer = setTimeout(() => {
        isOffline.value = true
      }, graceMs)
    },
    { immediate: true },
  )

  // ⚠ 卸载必须清：定时器到点会对着一个已经不在的页面写状态
  onBeforeUnmount(clear)

  return isOffline
}
