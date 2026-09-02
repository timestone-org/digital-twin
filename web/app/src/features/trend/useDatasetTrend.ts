/**
 * @fileoverview 一张台账的趋势取数：勾了哪几列、看哪一段、取回来的序列与截断。
 *
 * ⚠ 这份状态整个属于「当前这张台账」。换表时由调用方按 `tableId` 给组件挂
 * `:key` 整体重建，而不是在这里逐项复位——勾选、已取序列、截断标记、查过没有
 * 是四份互相咬合的状态，漏复位其中任何一份都会让新表的图上留着旧表的曲线。
 * ⚠ 取数失败一律走 `failure`，绝不把 `fetched` 留成空对象了事：一张空图与
 * 「这段时间确实没有数据」在界面上长得一模一样。
 */
import { computed, ref, watch, type ComputedRef, type Ref } from 'vue'

import type { DatasetColumn, DatasetSeriesPoint } from '@dt/contracts'
import type { DtChartSeries } from '@dt/ui'

import { getDatasetSeries } from '@/api/dataset'
import { describeError } from '@/composables/useAsyncList'
import { useRacedFetch, type RacedFetch } from '@/composables/useRacedFetch'
import {
  columnTrendItems,
  countTrendPoints,
  datasetChartSeries,
  isSelectionDirty,
  numericTrendColumns,
  seedTrendSelection,
  toggleTrendKey,
  truncationHint,
  type TrendItem,
} from './trendSeries'
import {
  defaultTrendRange,
  resolveTrendRange,
  toIsoWindow,
  type TrendRangeValue,
} from './trendRange'

export interface DatasetTrend {
  items: ComputedRef<TrendItem[]>
  selected: Ref<string[]>
  range: Ref<TrendRangeValue>
  series: ComputedRef<DtChartSeries[]>
  pointCount: ComputedRef<number>
  loading: Ref<boolean>
  /** 取数失败的那一句；有它时不许再画图。 */
  failure: Ref<string | null>
  /** 勾选已经超出上一次查询的结果。 */
  dirty: ComputedRef<boolean>
  /** 截断的那一句；没截断就是 null。 */
  truncation: ComputedRef<string | null>
  toggle: (key: string) => void
  /** 一次取消全部勾选。 */
  clear: () => void
  query: () => Promise<void>
  /** 卸载时掐掉在途请求。 */
  dispose: () => void
}

/** 一次查询前后要动的那几格。 */
interface TrendState {
  fetched: Ref<Record<string, DatasetSeriesPoint[]>>
  hasQueried: Ref<boolean>
  isTruncated: Ref<boolean>
  limit: Ref<number>
  loading: Ref<boolean>
  failure: Ref<string | null>
}

function createState(): TrendState {
  return {
    fetched: ref<Record<string, DatasetSeriesPoint[]>>({}),
    hasQueried: ref(false),
    isTruncated: ref(false),
    limit: ref(0),
    loading: ref(false),
    failure: ref<string | null>(null),
  }
}

/**
 * 取一次序列。范围填不全或一条都没勾时**不发请求**——那两种都是本地就看得出
 * 的，占一次往返只会换回一个 422。
 * @param state 要写的那几格
 * @param raced 竞态守卫
 * @param tableId 台账 id
 * @param keys 要取的列
 * @param range 界面上的时间范围
 */
async function runQuery(
  state: TrendState,
  raced: RacedFetch,
  tableId: string,
  keys: readonly string[],
  range: TrendRangeValue,
): Promise<void> {
  const resolved = resolveTrendRange(range)
  const window = resolved.window
  if (keys.length === 0 || window === null) return
  state.loading.value = true
  state.failure.value = null
  await raced.run(
    (signal) => getDatasetSeries(tableId, keys, toIsoWindow(window), signal),
    {
      ok: (result) => {
        state.fetched.value = result.series
        state.isTruncated.value = result.is_truncated
        state.limit.value = result.limit
        state.hasQueried.value = true
      },
      fail: (caught) => {
        state.failure.value = describeError(caught)
        state.fetched.value = {}
        state.hasQueried.value = false
        state.isTruncated.value = false
      },
      settled: () => (state.loading.value = false),
    },
  )
}

/**
 * @param tableId 台账 id
 * @param columns 台账的全部列
 */
export function useDatasetTrend(
  tableId: () => string,
  columns: () => readonly DatasetColumn[],
): DatasetTrend {
  const items = computed(() => columnTrendItems(numericTrendColumns(columns())))
  const selected = ref<string[]>(seedTrendSelection(items.value))
  const range = ref<TrendRangeValue>(defaultTrendRange())
  const state = createState()
  const raced = useRacedFetch()

  // 列是后到的（/trend 页先定表再拉列）：挂载那一刻按空列播种什么都没勾上，
  // 列到了而用户还没动过勾选、也没查过，就补播一次
  watch(items, (next, prev) => {
    if (
      prev.length === 0 &&
      selected.value.length === 0 &&
      !state.hasQueried.value
    ) {
      selected.value = seedTrendSelection(next)
      // 挂载那一次的「进来就画」是按空勾选跑的，等于没画；补播之后再画一次
      void runQuery(state, raced, tableId(), selected.value, range.value)
    }
  })

  const series = computed(() =>
    datasetChartSeries(state.fetched.value, items.value, selected.value),
  )

  return {
    items,
    selected,
    range,
    series,
    pointCount: computed(() => countTrendPoints(series.value)),
    loading: state.loading,
    failure: state.failure,
    dirty: computed(() =>
      isSelectionDirty(
        state.hasQueried.value,
        selected.value,
        state.fetched.value,
      ),
    ),
    truncation: computed(() =>
      state.isTruncated.value
        ? truncationHint('earlier', state.limit.value)
        : null,
    ),
    toggle: (key) => {
      selected.value = toggleTrendKey(selected.value, key)
    },
    clear: () => (selected.value = []),
    query: () => runQuery(state, raced, tableId(), selected.value, range.value),
    dispose: raced.cancel,
  }
}
