/**
 * @fileoverview 模型页用例的共享夹具：造模型、评估、折外预测与实时读数。
 *
 * ⚠ 评估口径是「热行为主」：hot 里放页面主要展示的数字，整体统计另给一套
 * 明显不同的值——用例据此分辨页面读的是哪一份。
 */
import type {
  AcModel,
  AcUnitLiveReading,
  ModelMetrics,
  ModelMetricsBlock,
  ModelPrediction,
  Page,
  RoomLiveReadings,
} from '@dt/contracts'

export const STAMP = '2026-08-12T02:00:00.000Z'

const OVERALL: ModelMetricsBlock = {
  count: 120,
  mae: 2.1,
  medae: 0.4,
  rmse: 4.1,
  coverage: 0.93,
  mean_width: 14.0,
  r2: 0.81,
  reliability: 'reliable',
  hot: {
    count: 80,
    mae: 4.2,
    medae: 3.1,
    rmse: 6.0,
    coverage: 0.82,
    mean_width: 22.0,
    r2: 0.64,
    reliability: 'reliable',
  },
  zero_count: 40,
  zero_hit_rate: 0.97,
  hot_hit_rate: 0.95,
}

const BY_K11: ModelMetricsBlock = {
  count: 110,
  mae: 2.0,
  medae: 0.3,
  rmse: 3.9,
  coverage: 0.94,
  mean_width: 13.0,
  r2: 0.79,
  reliability: 'reliable',
  hot: {
    count: 74,
    mae: 4.0,
    medae: 3.0,
    rmse: 5.8,
    coverage: 0.84,
    mean_width: 20.0,
    r2: 0.61,
    reliability: 'reliable',
  },
  zero_count: 36,
  zero_hit_rate: 0.96,
  hot_hit_rate: 0.94,
}

/** ⚠ 每次给一份新拷贝：用例常就地改 hot / zero_count 造老评估。 */
function block(base: ModelMetricsBlock): ModelMetricsBlock {
  return { ...base, hot: base.hot === null ? null : { ...base.hot } }
}

export function metrics(over: Partial<ModelMetrics> = {}): ModelMetrics {
  return {
    overall: block(OVERALL),
    by_set: { K11: block(BY_K11), 'K11+K12': null },
    ...over,
  }
}

export function model(over: Partial<AcModel> = {}): AcModel {
  return {
    id: 'm1',
    name: '早班模型',
    description: null,
    room: { id: 'r1', name: '注塑房' },
    workshop: { id: 'w1', name: '东车间' },
    serving_sets: [['K11'], ['K11', 'K12']],
    half_life_days: 180,
    status: 'ready',
    error: null,
    feature_version: 1,
    trained_at: STAMP,
    sample_count: 120,
    window_start: '2026-01-01T00:00:00.000Z',
    window_end: '2026-08-01T00:00:00.000Z',
    metrics: metrics(),
    is_batch_stale: false,
    is_feature_stale: false,
    created_by: 'alice',
    created_at: STAMP,
    updated_at: STAMP,
    ...over,
  }
}

export function prediction(
  over: Partial<ModelPrediction> = {},
): ModelPrediction {
  return {
    started_at: STAMP,
    running_set: ['K11'],
    actual_minutes: 25,
    p10: 18.0,
    p50: 24.0,
    p90: 33.0,
    fold: 2,
    ...over,
  }
}

export function predictionPage(
  items: ModelPrediction[],
  total: number | null = null,
): Page<ModelPrediction> {
  return { items, page: 1, size: 20, total: total ?? items.length }
}

/** 一台机组的当下读数。⚠ 缺测传 null，别传 0。 */
export function liveUnit(
  over: Partial<AcUnitLiveReading> = {},
): AcUnitLiveReading {
  return {
    serial: 'K11',
    sampled_at: '2026-08-12T02:59:00.000Z',
    is_running: true,
    readings: {
      workshop_temp_avg: 24.1,
      workshop_humidity_avg: 58,
      fresh_air_temp: 31.2,
      fresh_air_humidity: 71,
      chilled_water_supply_temp: 8.4,
      ...over.readings,
    },
    ...over,
  }
}

export function liveReadings(
  units: AcUnitLiveReading[] = [liveUnit()],
  over: Partial<RoomLiveReadings> = {},
): RoomLiveReadings {
  return {
    as_of: '2026-08-12T03:00:00.000Z',
    lookback_minutes: 15,
    units,
    ...over,
  }
}
