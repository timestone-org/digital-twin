/**
 * @fileoverview 单条开机事件的下钻曲线：按运行组合里选中的那台，取起始前后的
 * 原始采样画成折线。
 *
 * ⚠ 自持一个竞态序号：连点两条事件、或在弹窗里换机器，慢的那次后返回会把
 * 曲线刷成上一条事件的，而且不报任何错。
 */
import { ref, type Ref } from 'vue'
import type { AcMetric, RawSample, StartupEpisode } from '@dt/contracts'
import type { DtChartPoint, DtChartSeries } from '@dt/ui'

import * as hvac from '@/api/hvac'
import { describeError } from '@/composables/useAsyncList'
import { useRacedFetch, type RacedFetch } from '@/composables/useRacedFetch'
import { curveWindow } from './startupView'

// 达标看的就是这两个量，曲线只画它们；多画几条反而看不出何时进的范围
const CURVE_METRICS = ['workshop_temp_avg', 'workshop_humidity_avg'] as const

export interface EpisodeCurve {
  series: Ref<DtChartSeries[]>
  loading: Ref<boolean>
  error: Ref<string | null>
  load: (
    acUnitId: string,
    episode: StartupEpisode,
    metrics: readonly AcMetric[],
  ) => Promise<void>
  reset: () => void
}

interface CurveState {
  series: Ref<DtChartSeries[]>
  loading: Ref<boolean>
  error: Ref<string | null>
  raced: RacedFetch
}

export function useEpisodeCurve(): EpisodeCurve {
  const state: CurveState = {
    series: ref<DtChartSeries[]>([]),
    loading: ref(false),
    error: ref<string | null>(null),
    raced: useRacedFetch(),
  }
  return {
    series: state.series,
    loading: state.loading,
    error: state.error,
    load: (acUnitId, episode, metrics) =>
      load(state, acUnitId, episode, metrics),
    reset: () => {
      state.series.value = []
      state.error.value = null
    },
  }
}

/**
 * 取一帧上某个指标的值。
 * ⚠ 解构把 `ts` 摘出去，剩下整块才是「键 → 读数」，可以按 key 查；
 * 直接 Object.entries(sample) 拿到的值类型是 any。
 */
function toPoint(sample: RawSample, key: string): DtChartPoint {
  const { ts, ...rest } = sample
  const readings: Record<string, number | null> = rest
  return [ts, readings[key] ?? null]
}

/** 把一页采样摊成两条系列；null 保持 null，断档才画成缺口。 */
function toSeries(
  samples: readonly RawSample[],
  metrics: readonly AcMetric[],
): DtChartSeries[] {
  const catalog = new Map(metrics.map((item) => [item.key, item]))
  return CURVE_METRICS.map((key) => {
    const found = catalog.get(key)
    return {
      key,
      name: found?.name ?? key,
      unit: found?.unit ?? '',
      axis: found?.group ?? key,
      points: samples.map((sample) => toPoint(sample, key)),
    }
  })
}

async function load(
  state: CurveState,
  acUnitId: string,
  episode: StartupEpisode,
  metrics: readonly AcMetric[],
): Promise<void> {
  state.loading.value = true
  const window = curveWindow(episode)
  await state.raced.run(
    () => hvac.listRawSamples(acUnitId, { ...window, limit: 200 }),
    {
      ok: (page) => {
        state.series.value = toSeries(page.items, metrics)
        state.error.value = null
      },
      fail: (caught) => {
        state.error.value = describeError(caught)
        state.series.value = []
      },
      settled: () => (state.loading.value = false),
    },
  )
}
