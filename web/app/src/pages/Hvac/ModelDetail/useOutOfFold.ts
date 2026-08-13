/**
 * @fileoverview 折外预测的**全量**取数与派生统计，供详情页那几张图共用。
 *
 * ⚠ 与 ⑥ 逐条表分开取：一张 20 个点的散点不是这个模型的画像，用户会以为
 * 折外预测总共只有 20 条。这里连着翻页拉全量，组合过滤在客户端做——切组合
 * 因此是零请求的瞬时操作。
 */
import {
  computed,
  onBeforeUnmount,
  ref,
  shallowRef,
  type ComputedRef,
  type Ref,
} from 'vue'
import type { ModelPrediction } from '@dt/contracts'

import * as hvac from '@/api/hvac'
import { describeError } from '@/composables/useAsyncList'
import { formatSet, isCovered } from '@/features/hvac/modelView'
import {
  foldStatsOf,
  meanAbsError,
  topErrorsOf,
  type FoldStat,
} from './foldStats'

/** 后端 MAX_PAGE_SIZE；护栏上限约合 10 次请求。 */
export const OUT_OF_FOLD_PAGE_SIZE = 200
export const SCATTER_MAX_ROWS = 2000

export interface OutOfFold {
  /** 原始全量（未按组合过滤）。 */
  rows: Ref<ModelPrediction[]>
  /** 后端报的总数；命中护栏时它比 `rows.length` 大。 */
  total: Ref<number>
  loading: Ref<boolean>
  error: Ref<string | null>
  filtered: ComputedRef<ModelPrediction[]>
  hotRows: ComputedRef<ModelPrediction[]>
  hotMae: ComputedRef<number | null>
  missedCount: ComputedRef<number>
  foldStats: ComputedRef<FoldStat[]>
  topErrors: ComputedRef<ModelPrediction[]>
  reload: () => void
}

/**
 * @param modelId 当前模型 id，空串表示还不知道要取谁的
 * @param setFilter 组合过滤，空串 = 全部组合
 */
export function useOutOfFold(
  modelId: () => string,
  setFilter: () => string,
): OutOfFold {
  const source = usePagedRows(modelId)
  return { ...source, ...derive(source.rows, setFilter) }
}

/** 连着翻页把全量拉回来，每页回来就补进 `rows`（渐进渲染）。 */
function usePagedRows(modelId: () => string) {
  const rows = shallowRef<ModelPrediction[]>([])
  const total = ref(0)
  const loading = ref(false)
  const error = ref<string | null>(null)
  // ⚠ 自增序号防竞态：换模型或重训完成会重新拉，慢的那次后返回会把上一个
  // 模型的点混进来；卸载时也靠作废它让在途的循环自己退出
  let token = 0

  onBeforeUnmount(() => {
    token += 1
  })

  async function run(): Promise<void> {
    const mine = ++token
    rows.value = []
    total.value = 0
    error.value = null
    if (modelId() === '') return
    loading.value = true
    try {
      await pull(mine)
    } catch (caught) {
      if (mine !== token) return
      error.value = describeError(caught)
      rows.value = []
    } finally {
      if (mine === token) loading.value = false
    }
  }

  async function pull(mine: number): Promise<void> {
    let page = 1
    for (;;) {
      const got = await hvac.listModelPredictions(modelId(), {
        page,
        size: OUT_OF_FOLD_PAGE_SIZE,
      })
      if (mine !== token) return
      rows.value = [...rows.value, ...got.items]
      total.value = got.total
      const drained = page * OUT_OF_FOLD_PAGE_SIZE >= got.total
      if (drained || rows.value.length >= SCATTER_MAX_ROWS) return
      page += 1
    }
  }

  return { rows, total, loading, error, reload: (): void => void run() }
}

/** 全部按当前组合过滤后的派生值。 */
function derive(rows: Ref<ModelPrediction[]>, setFilter: () => string) {
  const filtered = computed(() => {
    const wanted = setFilter()
    if (wanted === '') return rows.value
    return rows.value.filter((row) => formatSet(row.running_set) === wanted)
  })
  const hotRows = computed(() =>
    filtered.value.filter((row) => row.actual_minutes > 0),
  )
  return {
    filtered,
    hotRows,
    hotMae: computed(() => meanAbsError(hotRows.value)),
    missedCount: computed(
      () => filtered.value.filter((row) => !isCovered(row)).length,
    ),
    foldStats: computed(() => foldStatsOf(filtered.value)),
    topErrors: computed(() => topErrorsOf(filtered.value)),
  }
}
