/** @fileoverview 同一账号的层级图能力探测合并在途请求，不缓存服务在线状态。 */
import { defineStore } from 'pinia'
import { onScopeDispose, watch } from 'vue'
import type { HierarchyCapabilities } from '@dt/contracts'
import { PERMISSION_CODES } from '@dt/contracts'
import { capabilities } from '@/api/hierarchy'
import { useRacedFetch } from '@/composables/useRacedFetch'
import { useAuthStore } from './auth'

export const useHierarchyCapabilitiesStore = defineStore(
  'hierarchy-capabilities',
  () => {
    const auth = useAuthStore(),
      request = useRacedFetch()
    let pending: Promise<HierarchyCapabilities> | null = null
    const identity = () =>
      `${auth.user?.id ?? ''}:${auth.can([PERMISSION_CODES.hierarchyView])}`
    watch(
      identity,
      () => {
        pending = null
        request.cancel()
      },
      { flush: 'sync' },
    )
    onScopeDispose(request.cancel)
    async function fetchCapability(): Promise<HierarchyCapabilities> {
      let value: HierarchyCapabilities | null = null
      let failure: unknown = new Error('能力探测已取消，请重新检查')
      await request.run((signal) => capabilities(signal), {
        ok: (result) => {
          value = result
        },
        fail: (error) => {
          failure = error
        },
        settled: () => undefined,
      })
      if (value === null) throw failure
      return value
    }
    function load(): Promise<HierarchyCapabilities> {
      if (pending) return pending
      const current = fetchCapability().finally(() => {
        if (pending === current) pending = null
      })
      pending = current
      return current
    }
    return { load }
  },
)
