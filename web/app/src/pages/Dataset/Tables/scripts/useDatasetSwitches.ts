/**
 * @fileoverview 台账那一组运行参数里的两个总开关，供列表页在格子上多说一句实话。
 *
 * 两个后台任务「已上线」不等于「在跑」：聚合采集要 `dataset_enabled`、保留期
 * 清理要 `dataset_retention_enabled`，两者默认都是关的
 * （docs/DATASET_DESIGN.md 开篇的告诫）。
 *
 * ⚠ 措辞由**真实有效值**决定，一个字都不许写死：写死会在运维打开开关之后继续
 * 显示「未生效」，把诚实变成另一个方向的谎（§13.3）。
 * ⚠ 取不到时退回**全关**且照常渲染整页（§7.13）：这两个开关的默认值本就是关，
 * 宁可多标一句「未生效」，也不能反过来承诺后台在采而实际没采；更不能把整页判成
 * 加载失败——台账列表本身跟这一组参数没有依赖关系。
 */

import { onUnmounted, ref, type Ref } from 'vue'

import { listRuntimeParams } from '@/api/runtimeParams'
import { useRacedFetch } from '@/composables/useRacedFetch'

// 两个总开关在后端目录里的键，与 apps/runtime_params/catalog.py 逐字一致
const COLLECT_KEY = 'dataset_enabled'
const RETENTION_KEY = 'dataset_retention_enabled'

export interface DatasetSwitches {
  /** 聚合采集器在不在跑。 */
  collectEnabled: Ref<boolean>
  /** 保留期清理在不在跑。 */
  retentionEnabled: Ref<boolean>
  load: () => Promise<void>
}

/** 装上这两个开关的读取。调用方自己决定什么时候 `load()`。 */
export function useDatasetSwitches(): DatasetSwitches {
  const collectEnabled = ref(false)
  const retentionEnabled = ref(false)
  const raced = useRacedFetch()

  onUnmounted(() => {
    raced.cancel()
  })

  async function load(): Promise<void> {
    await raced.run(() => listRuntimeParams('dataset'), {
      ok: (rows) => {
        const pick = (key: string): boolean =>
          rows.find((one) => one.key === key)?.value === true
        collectEnabled.value = pick(COLLECT_KEY)
        retentionEnabled.value = pick(RETENTION_KEY)
      },
      fail: () => {
        collectEnabled.value = false
        retentionEnabled.value = false
      },
      settled: () => {},
    })
  }

  return { collectEnabled, retentionEnabled, load }
}
