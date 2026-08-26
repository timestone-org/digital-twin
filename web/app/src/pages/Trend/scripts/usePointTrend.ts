/**
 * @fileoverview 趋势分析页「点位历史」这一面的取数：搜点位、筛点位、勾点位、
 * 取一段分桶读数。一次查询要动的那几格与动它们的三件事在 `pointTrendState`。
 *
 * ⚠ 勾选与搜索结果是两份东西：搜完下一个关键字，已经勾上的点位仍要留在清单里，
 * 否则用户会以为自己取消了勾选，而图上那条线还在。
 * ⚠ 「只看记录历史的」默认开着：没开归档的点位勾得上、查得动、永远画不出线，
 * 而现场往往几十个点位里只有几个开了归档——不筛的话满屏都是画不出的东西。
 */
import { computed, ref, type ComputedRef, type Ref } from 'vue'

import type { DtChartSeries } from '@dt/ui'

import { usePointPicker, type PointPicker } from '@/composables/usePointPicker'
import { useRacedFetch } from '@/composables/useRacedFetch'
import {
  TREND_BUCKET_AUTO,
  type TrendBucket,
} from '@/features/trend/trendBucket'
import type { TrendItem } from '@/features/trend/trendSeries'
import {
  defaultTrendRange,
  type TrendRangeValue,
} from '@/features/trend/trendRange'
import { toTrendItem } from './pointTrendData'
import {
  createPointState,
  listedItems,
  nextChosen,
  pointDirty,
  pointSeries,
  pointTruncation,
  runPointQuery,
} from './pointTrendState'

/** 进来先看哪一档折算。平均是唯一一档对温度、压力这类瞬时量说得通的。 */
const DEFAULT_AGGREGATE = 'avg'

export interface PointTrend {
  picker: PointPicker
  /** 只看开了归档的点位。 */
  drawableOnly: Ref<boolean>
  items: ComputedRef<TrendItem[]>
  selected: ComputedRef<string[]>
  range: Ref<TrendRangeValue>
  aggregate: Ref<string>
  /** 取点间隔，`auto` 即跟着时间范围走。 */
  interval: Ref<string>
  series: ComputedRef<DtChartSeries[]>
  /** 这次取数真正用的桶宽；还没查过是 null。 */
  bucket: Ref<TrendBucket | null>
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

export function usePointTrend(): PointTrend {
  const picker = usePointPicker()
  const state = createPointState()
  const range = ref<TrendRangeValue>(defaultTrendRange())
  const aggregate = ref(DEFAULT_AGGREGATE)
  const interval = ref(TREND_BUCKET_AUTO)
  const drawableOnly = ref(true)
  const raced = useRacedFetch()

  const selected = computed(() => state.chosen.value.map((item) => item.key))
  const items = computed<TrendItem[]>(() =>
    listedItems(
      state.chosen.value,
      picker.items.value.map(toTrendItem),
      drawableOnly.value,
    ),
  )

  return {
    picker,
    drawableOnly,
    items,
    selected,
    range,
    aggregate,
    interval,
    bucket: state.bucket,
    series: computed(() => pointSeries(state, items.value, selected.value)),
    loading: state.loading,
    failure: state.failure,
    dirty: computed(() => pointDirty(state, selected.value)),
    truncation: computed(() => pointTruncation(state)),
    toggle: (key) => {
      state.chosen.value = nextChosen(items.value, selected.value, key)
    },
    clear: () => (state.chosen.value = []),
    query: () =>
      runPointQuery(state, raced, {
        range: range.value,
        aggregate: aggregate.value,
        interval: interval.value,
      }),
    dispose: () => {
      picker.dispose()
      raced.cancel()
    },
  }
}
