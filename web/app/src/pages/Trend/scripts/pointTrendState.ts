/**
 * @fileoverview 点位历史那一面「一次查询前后要动的那几格」以及动它们的三件事：
 * 取数、拼触顶那一句、勾选之后留下哪几项。
 *
 * ⚠ 取数失败一律写 `failure` 并把 `fetched` 清空，绝不留一份空读数了事：一张
 * 空图与「这段时间确实没采到数」在界面上长得一模一样。
 */
import { ref, type Ref } from 'vue'

import type { HistoryPoint } from '@dt/contracts'
import type { DtChartSeries } from '@dt/ui'

import { describeError } from '@/composables/useAsyncList'
import type { RacedFetch } from '@/composables/useRacedFetch'
import {
  bucketTruncationHint,
  type TrendBucket,
} from '@/features/trend/trendBucket'
import {
  isSelectionDirty,
  pointChartSeries,
  toggleTrendKey,
  type TrendItem,
} from '@/features/trend/trendSeries'
import {
  resolveTrendRange,
  type TrendRangeValue,
} from '@/features/trend/trendRange'
import { readPointReadings } from './pointTrendData'

/** 一次查询前后要动的那几格。 */
export interface PointState {
  chosen: Ref<TrendItem[]>
  fetched: Ref<Record<string, HistoryPoint[]>>
  hasQueried: Ref<boolean>
  bucket: Ref<TrendBucket | null>
  isTruncated: Ref<boolean>
  loading: Ref<boolean>
  failure: Ref<string | null>
}

export function createPointState(): PointState {
  return {
    chosen: ref<TrendItem[]>([]),
    fetched: ref<Record<string, HistoryPoint[]>>({}),
    hasQueried: ref(false),
    bucket: ref<TrendBucket | null>(null),
    isTruncated: ref(false),
    loading: ref(false),
    failure: ref<string | null>(null),
  }
}

/** 界面上那几个「怎么取」的选择。 */
export interface PointQueryChoice {
  range: TrendRangeValue
  aggregate: string
  /** 取点间隔，`auto` 即跟着窗口走。 */
  interval: string
}

/**
 * 取一次读数。
 * @param state 要写的那几格
 * @param raced 竞态守卫
 * @param choice 界面上的时间范围、折算档位与取点间隔
 */
export async function runPointQuery(
  state: PointState,
  raced: RacedFetch,
  choice: PointQueryChoice,
): Promise<void> {
  const wanted = [...state.chosen.value]
  const window = resolveTrendRange(choice.range).window
  if (wanted.length === 0 || window === null) return
  state.loading.value = true
  state.failure.value = null
  await raced.run(
    (signal) =>
      readPointReadings(
        {
          wanted,
          fromMs: window.fromMs,
          toMs: window.toMs,
          aggregate: choice.aggregate,
          interval: choice.interval,
        },
        signal,
      ),
    {
      ok: (result) => {
        const next: Record<string, HistoryPoint[]> = {}
        for (const one of result.readings) next[one.key] = one.points
        state.fetched.value = next
        state.bucket.value = result.bucket
        state.isTruncated.value = result.isTruncated
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
 * 触顶的那一句；没触顶给 null。
 * @param state 一次查询留下的那几格
 */
export function pointTruncation(state: PointState): string | null {
  const bucket = state.bucket.value
  if (!state.isTruncated.value || bucket === null) return null
  return bucketTruncationHint(bucket)
}

/**
 * 这一次要画的那几条曲线。
 * ⚠ 只摊上一次查询真取回来的那几个 key：勾了但还没查的不进图，否则会得到一条
 * 有图例、没有线的空曲线，看的人会判成「这一列没数据」。
 * @param state 一次查询留下的那几格
 * @param items 清单
 * @param selected 当前勾选
 */
export function pointSeries(
  state: PointState,
  items: readonly TrendItem[],
  selected: readonly string[],
): DtChartSeries[] {
  return pointChartSeries(state.fetched.value, items, selected)
}

/**
 * 勾选是否已经超出上一次查询的结果。
 * @param state 一次查询留下的那几格
 * @param selected 当前勾选
 */
export function pointDirty(
  state: PointState,
  selected: readonly string[],
): boolean {
  return isSelectionDirty(state.hasQueried.value, selected, state.fetched.value)
}

/**
 * 清单上列哪几项：已勾的排在前面，再接上这一次搜出来、还没勾的那些。
 * ⚠ 已勾的必须一直留着，不随搜索结果与筛选消失：它掉出清单时图上那条线还在，
 * 用户会以为自己已经取消了勾选。
 * @param chosen 已勾的那几项
 * @param found 这一次搜出来的点位摊成的项
 * @param drawableOnly 只留画得出线的
 */
export function listedItems(
  chosen: readonly TrendItem[],
  found: readonly TrendItem[],
  drawableOnly: boolean,
): TrendItem[] {
  const picked = new Set(chosen.map((item) => item.key))
  return [
    ...chosen,
    ...found.filter(
      (item) => !picked.has(item.key) && (!drawableOnly || item.isDrawable),
    ),
  ]
}

/**
 * 勾一下之后该留下哪几项。
 * ⚠ 存的是**整项**而不是 key：勾上的点位随时会掉出搜索结果，那时只剩 key 就
 * 拼不出名字与量纲，图例会变成一串 `{uuid}:{code}`。
 * @param items 当前清单
 * @param selected 当前勾选
 * @param key 被点的那一项
 */
export function nextChosen(
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
