/**
 * @fileoverview 模型页用例的共享夹具：造模型、评估与折外预测。
 */
import type {
  AcModel,
  CursorPage,
  ModelMetrics,
  ModelPrediction,
} from '@dt/contracts'

export const STAMP = '2026-08-12T02:00:00.000Z'

export function metrics(over: Partial<ModelMetrics> = {}): ModelMetrics {
  return {
    overall: {
      count: 120,
      mae: 4.2,
      medae: 3.1,
      rmse: 6.0,
      coverage: 0.82,
      mean_width: 22.0,
      reliability: 'reliable',
    },
    by_set: {
      K11: {
        count: 110,
        mae: 4.0,
        medae: 3.0,
        rmse: 5.8,
        coverage: 0.84,
        mean_width: 20.0,
        reliability: 'reliable',
      },
      'K11+K12': null,
    },
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
  next: string | null = null,
): CursorPage<ModelPrediction> {
  return { items, next, has_more: next !== null }
}
