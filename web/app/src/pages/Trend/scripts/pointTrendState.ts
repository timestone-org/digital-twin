/**
 * @fileoverview 点位历史那一面「一次查询前后要动的那几格」以及动它们的三件事：
 * 取数、拼触顶那一句、勾选之后留下哪几项。
 *
 * ⚠ 取数失败一律写 `failure` 并把 `fetched` 清空，绝不留一份空读数了事：一张
 * 空图与「这段时间确实没采到数」在界面上长得一模一样。
 */
import { ref, type Ref } from 'vue'

import type { HistoryPoint } from '@dt/contracts'

import { describeError } from '@/composables/useAsyncList'
import type { RacedFetch } from '@/composables/useRacedFetch'
import {
  bucketTruncationHint,
  type TrendBucket,
} from '@/features/trend/trendBucket'
import { toggleTrendKey, type TrendItem } from '@/features/trend/trendSeries'
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

/**
 * 取一次读数。
 * @param state 要写的那几格
 * @param raced 竞态守卫
 * @param range 界面上的时间范围
 * @param aggregate 折算档位
 */
export async function runPointQuery(
  state: PointState,
  raced: RacedFetch,
  range: TrendRangeValue,
  aggregate: string,
): Promise<void> {
  const wanted = [...state.chosen.value]
  const window = resolveTrendRange(range).window
  if (wanted.length === 0 || window === null) return
  state.loading.value = true
  state.failure.value = null
  await raced.run(
    (signal) =>
      readPointReadings(wanted, window.fromMs, window.toMs, aggregate, signal),
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
