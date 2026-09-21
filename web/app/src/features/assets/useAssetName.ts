/** @fileoverview 素材名称回显：引用保持持久化身份，异步名称仅用于展示。 */
import { parseAssetRef } from '@dt/contracts'
import { computed, onUnmounted, ref, watch } from 'vue'
import type { ComputedRef } from 'vue'

import { getAsset } from '@/api/assets'
import { useRacedFetch } from '@/composables/useRacedFetch'

/** 按当前引用查询名称，快速切换和卸载时作废旧请求。 */
export function useAssetName(current: () => string): ComputedRef<string> {
  const label = ref('')
  const raced = useRacedFetch()
  watch(
    current,
    (value) => {
      raced.cancel()
      const id = parseAssetRef(value)
      label.value = id === null ? '未选择模型' : '正在读取模型名称…'
      if (id === null) return
      void raced.run(() => getAsset(id), {
        ok: (asset) => {
          label.value = asset.name
        },
        fail: () => {
          label.value = '模型名称暂不可用'
        },
        settled: () => undefined,
      })
    },
    { immediate: true },
  )
  onUnmounted(raced.cancel)
  return computed(() => label.value)
}
