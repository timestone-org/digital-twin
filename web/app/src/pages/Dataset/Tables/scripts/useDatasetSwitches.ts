/**
 * @fileoverview 台账列表的采集和保留期清理开关，读取与重试规则见 DATASET_DESIGN §7.13。
 */

import { onUnmounted, ref, type Ref } from 'vue'

import { listRuntimeParams } from '@/api/runtimeParams'
import { useRacedFetch } from '@/composables/useRacedFetch'

// 两个总开关在后端目录里的键，与 apps/runtime_params/catalog.py 逐字一致
const COLLECT_KEY = 'dataset_enabled'
const RETENTION_KEY = 'dataset_retention_enabled'

export interface DatasetSwitches {
  /** 聚合采集器在不在跑。 */
  collectEnabled: Ref<boolean | null>
  /** 保留期清理在不在跑。 */
  retentionEnabled: Ref<boolean | null>
  isLoading: Ref<boolean>
  error: Ref<string>
  load: () => Promise<void>
}

/** 装上这两个开关的读取。调用方自己决定什么时候 `load()`。 */
export function useDatasetSwitches(): DatasetSwitches {
  const collectEnabled = ref<boolean | null>(null)
  const retentionEnabled = ref<boolean | null>(null)
  const isLoading = ref(false)
  const error = ref('')
  const raced = useRacedFetch()

  onUnmounted(() => {
    raced.cancel()
  })

  async function load(): Promise<void> {
    collectEnabled.value = null
    retentionEnabled.value = null
    isLoading.value = true
    error.value = ''
    await raced.run((signal) => listRuntimeParams('dataset', signal), {
      ok: (rows) => {
        const pick = (key: string): boolean | null => {
          const value = rows.find((one) => one.key === key)?.value
          return typeof value === 'boolean' ? value : null
        }
        collectEnabled.value = pick(COLLECT_KEY)
        retentionEnabled.value = pick(RETENTION_KEY)
        if (collectEnabled.value === null || retentionEnabled.value === null)
          error.value = '运行参数缺少开关或开关值无效，请重试'
      },
      fail: (cause) => {
        error.value =
          cause instanceof Error && cause.message !== ''
            ? cause.message
            : '读取失败，请重试'
      },
      settled: () => {
        isLoading.value = false
      },
    })
  }

  return { collectEnabled, retentionEnabled, isLoading, error, load }
}
