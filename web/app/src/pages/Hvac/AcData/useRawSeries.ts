/**
 * @fileoverview 折线图那条取数路径。
 *
 * ⚠ 自持一个竞态序号，与表格那条分开：换区间会同时触发两条，共用序号会让它们
 * 互相判成过期，表现是「切时间后有一半没数据」。
 */
import { ref, type Ref } from 'vue'
import type { AcMetric, RawSeries } from '@dt/contracts'
import type { DtChartSeries } from '@dt/ui'

import { useRacedFetch, type RacedFetch } from '@/composables/useRacedFetch'
import { toChartSeries } from './acDataQuery'
import { describeAcDataError, type AcDataProblem } from './acDataError'

export interface RawSeriesView {
  series: Ref<DtChartSeries[]>
  /** 服务端挑的桶宽；不显示出来的话图上的疏密无从解释。 */
  intervalMinutes: Ref<number>
  loading: Ref<boolean>
  problem: Ref<AcDataProblem | null>
  load: (metrics: readonly AcMetric[]) => Promise<void>
}

interface SeriesState {
  fetcher: () => Promise<RawSeries>
  series: Ref<DtChartSeries[]>
  intervalMinutes: Ref<number>
  loading: Ref<boolean>
  problem: Ref<AcDataProblem | null>
  raced: RacedFetch
}

/**
 * @param fetcher 按当前区间与勾选的指标取一次聚合序列
 */
export function useRawSeries(fetcher: () => Promise<RawSeries>): RawSeriesView {
  const state: SeriesState = {
    fetcher,
    series: ref<DtChartSeries[]>([]),
    intervalMinutes: ref(0),
    loading: ref(false),
    problem: ref<AcDataProblem | null>(null),
    raced: useRacedFetch(),
  }
  return {
    series: state.series,
    intervalMinutes: state.intervalMinutes,
    loading: state.loading,
    problem: state.problem,
    load: (metrics) => load(state, metrics),
  }
}

async function load(
  state: SeriesState,
  metrics: readonly AcMetric[],
): Promise<void> {
  state.loading.value = true
  await state.raced.run(state.fetcher, {
    ok: (found) => {
      state.series.value = toChartSeries(found, metrics)
      state.intervalMinutes.value = found.interval_minutes
      state.problem.value = null
    },
    fail: (caught) => {
      state.problem.value = describeAcDataError(caught)
      state.series.value = []
    },
    settled: () => (state.loading.value = false),
  })
}
