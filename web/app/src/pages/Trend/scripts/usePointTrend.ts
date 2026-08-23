/**
 * @fileoverview 趋势分析页「点位历史」这一面的取数：搜点位、勾点位、取一段读数。
 *
 * ⚠ 勾选与搜索结果是两份东西：搜完下一个关键字，已经勾上的点位仍要留在清单里，
 * 否则用户会以为自己取消了勾选，而图上那条线还在。
 * ⚠ 取数失败一律走 `failure`，绝不留一份空读数了事：一张空图与「这段时间确实
 * 没采到数」在界面上长得一模一样（`fetchPointHistory` 因此也是失败即 reject）。
 */
import { computed, ref, type ComputedRef, type Ref } from 'vue'

import type { HistoryPoint } from '@dt/contracts'
import type { DtChartSeries } from '@dt/ui'

import { describeError } from '@/composables/useAsyncList'
import { usePointPicker, type PointPicker } from '@/composables/usePointPicker'
import { useRacedFetch, type RacedFetch } from '@/composables/useRacedFetch'
import {
  isSelectionDirty,
  pointChartSeries,
  toggleTrendKey,
  truncationHint,
  type TrendItem,
} from '@/features/trend/trendSeries'
import {
  defaultTrendRange,
  resolveTrendRange,
  type TrendRangeValue,
} from '@/features/trend/trendRange'
import {
  POINT_TREND_LIMIT,
  readPointReadings,
  toTrendItem,
} from './pointTrendData'

export interface PointTrend {
  picker: PointPicker
  items: ComputedRef<TrendItem[]>
  selected: ComputedRef<string[]>
  range: Ref<TrendRangeValue>
  series: ComputedRef<DtChartSeries[]>
  loading: Ref<boolean>
  failure: Ref<string | null>
  dirty: ComputedRef<boolean>
  truncation: ComputedRef<string | null>
  toggle: (key: string) => void
  query: () => Promise<void>
  dispose: () => void
}

/** 一次查询前后要动的那几格。 */
interface PointState {
  chosen: Ref<TrendItem[]>
  fetched: Ref<Record<string, HistoryPoint[]>>
  hasQueried: Ref<boolean>
  isTruncated: Ref<boolean>
  loading: Ref<boolean>
  failure: Ref<string | null>
}

function createState(): PointState {
  return {
    chosen: ref<TrendItem[]>([]),
    fetched: ref<Record<string, HistoryPoint[]>>({}),
    hasQueried: ref(false),
    isTruncated: ref(false),
    loading: ref(false),
    failure: ref<string | null>(null),
  }
}

/**
 * 取一次读数。
 * ⚠ 取数本身不吃 signal（点位历史那条要翻好几页），竞态由序号守卫拦：慢的那次
 * 后返回时序号已经不是它的了，写不进状态。
 * @param state 要写的那几格
 * @param raced 竞态守卫
 * @param range 界面上的时间范围
 */
async function runQuery(
  state: PointState,
  raced: RacedFetch,
  range: TrendRangeValue,
): Promise<void> {
  const wanted = [...state.chosen.value]
  const window = resolveTrendRange(range).window
  if (wanted.length === 0 || window === null) return
  state.loading.value = true
  state.failure.value = null
  await raced.run(() => readPointReadings(wanted, window.fromMs, window.toMs), {
    ok: (results) => {
      const next: Record<string, HistoryPoint[]> = {}
      for (const one of results) next[one.key] = one.points
      state.fetched.value = next
      state.isTruncated.value = results.some((one) => one.isTruncated)
      state.hasQueried.value = true
    },
    fail: (caught) => {
      state.failure.value = describeError(caught)
      state.fetched.value = {}
      state.hasQueried.value = false
      state.isTruncated.value = false
    },
    settled: () => (state.loading.value = false),
  })
}

export function usePointTrend(): PointTrend {
  const picker = usePointPicker()
  const state = createState()
  const range = ref<TrendRangeValue>(defaultTrendRange())
  const raced = useRacedFetch()

  const selected = computed(() => state.chosen.value.map((item) => item.key))
  // 已勾的排在前面，再接上这一次搜出来、还没勾的那些
  const items = computed<TrendItem[]>(() => [
    ...state.chosen.value,
    ...picker.items.value
      .map(toTrendItem)
      .filter((item) => !selected.value.includes(item.key)),
  ])

  return {
    picker,
    items,
    selected,
    range,
    series: computed(() =>
      pointChartSeries(state.fetched.value, items.value, selected.value),
    ),
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
        ? truncationHint('later', POINT_TREND_LIMIT)
        : null,
    ),
    toggle: (key) => {
      const catalog = new Map(items.value.map((item) => [item.key, item]))
      state.chosen.value = toggleTrendKey(selected.value, key).flatMap(
        (wanted) => {
          const found = catalog.get(wanted)
          return found === undefined ? [] : [found]
        },
      )
    },
    query: () => runQuery(state, raced, range.value),
    dispose: () => {
      picker.dispose()
      raced.cancel()
    },
  }
}
