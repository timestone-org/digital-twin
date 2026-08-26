/**
 * @fileoverview 趋势分析页「点位历史」这一面的取数：搜点位、筛点位、勾点位、
 * 取一段读数。
 *
 * ⚠ 勾选与搜索结果是两份东西：搜完下一个关键字，已经勾上的点位仍要留在清单里，
 * 否则用户会以为自己取消了勾选，而图上那条线还在。
 * ⚠ 取数失败一律走 `failure`，绝不留一份空读数了事：一张空图与「这段时间确实
 * 没采到数」在界面上长得一模一样（`fetchPointHistory` 因此也是失败即 reject）。
 * ⚠ 「只看记录历史的」默认开着：没开归档的点位勾得上、查得动、永远画不出线，
 * 而现场往往几十个点位里只有几个开了归档——不筛的话满屏都是画不出的东西。
 */
import { computed, ref, type ComputedRef, type Ref } from 'vue'

import type { HistoryPoint } from '@dt/contracts'
import type { DtChartSeries } from '@dt/ui'

import { describeError } from '@/composables/useAsyncList'
import { usePointPicker, type PointPicker } from '@/composables/usePointPicker'
import { useRacedFetch, type RacedFetch } from '@/composables/useRacedFetch'
import {
  countTrendPoints,
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
  /** 只看开了归档的点位。 */
  drawableOnly: Ref<boolean>
  items: ComputedRef<TrendItem[]>
  selected: ComputedRef<string[]>
  range: Ref<TrendRangeValue>
  series: ComputedRef<DtChartSeries[]>
  pointCount: ComputedRef<number>
  loading: Ref<boolean>
  failure: Ref<string | null>
  dirty: ComputedRef<boolean>
  truncation: ComputedRef<string | null>
  toggle: (key: string) => void
  /** 一次取消全部勾选。 */
  clear: () => void
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

/**
 * 勾一下之后该留下哪几项。
 * ⚠ 存的是**整项**而不是 key：勾上的点位随时会掉出搜索结果（换关键字、或者
 * 被「只看记录历史的」筛掉），那时只剩 key 就拼不出名字与量纲，图例会变成
 * 一串 `{uuid}:{code}`。
 * @param items 当前清单
 * @param selected 当前勾选
 * @param key 被点的那一项
 */
function nextChosen(
  items: readonly TrendItem[],
  selected: readonly string[],
  key: string,
): TrendItem[] {
  const catalog = new Map(items.map((item) => [item.key, item]))
  return toggleTrendKey(selected, key).flatMap((wanted) => {
    const found = catalog.get(wanted)
    return found === undefined ? [] : [found]
  })
}

export function usePointTrend(): PointTrend {
  const picker = usePointPicker()
  const state = createState()
  const range = ref<TrendRangeValue>(defaultTrendRange())
  const drawableOnly = ref(true)
  const raced = useRacedFetch()

  const selected = computed(() => state.chosen.value.map((item) => item.key))
  // 已勾的排在前面，再接上这一次搜出来、还没勾的那些
  const items = computed<TrendItem[]>(() => [
    ...state.chosen.value,
    ...picker.items.value
      .map(toTrendItem)
      .filter((item) => !selected.value.includes(item.key))
      .filter((item) => !drawableOnly.value || item.isDrawable),
  ])
  const series = computed(() =>
    pointChartSeries(state.fetched.value, items.value, selected.value),
  )

  return {
    picker,
    drawableOnly,
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
        ? truncationHint('later', POINT_TREND_LIMIT)
        : null,
    ),
    toggle: (key) => {
      state.chosen.value = nextChosen(items.value, selected.value, key)
    },
    clear: () => (state.chosen.value = []),
    query: () => runQuery(state, raced, range.value),
    dispose: () => {
      picker.dispose()
      raced.cancel()
    },
  }
}
