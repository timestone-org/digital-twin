/** @fileoverview 层级图能力探测，服务缺席时只隐藏对应入口。 */
import { onBeforeUnmount, ref, watch } from 'vue'
import { useHierarchyCapabilitiesStore } from '@/stores/hierarchyCapabilities'
import { useRacedFetch } from './useRacedFetch'
export function useHierarchyAvailability(allowed: () => boolean) {
  const capabilities = useHierarchyCapabilitiesStore()
  const available = ref(false),
    request = useRacedFetch()
  watch(
    allowed,
    (isEnabled) => {
      available.value = false
      request.cancel()
      if (!isEnabled) return
      void request.run(() => capabilities.load(), {
        ok: (result) => {
          available.value = result.is_enabled
        },
        fail: () => {
          available.value = false
        },
        settled: () => undefined,
      })
    },
    { immediate: true },
  )
  onBeforeUnmount(request.cancel)
  return available
}
