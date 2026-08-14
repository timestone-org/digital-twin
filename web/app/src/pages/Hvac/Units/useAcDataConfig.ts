/**
 * @fileoverview 「数据与达标」弹窗的状态面。取值规则在 ./acLimitForm.ts，
 * 取数与回写在 ./acDataOps.ts，可绑定对象的清单在 ./useSourceObjects.ts。
 */
import { computed, ref, type ComputedRef, type Ref } from 'vue'
import type { AcDataBinding, AcDataset, DtSelectOption } from '@dt/contracts'

import { useRacedFetch } from '@/composables/useRacedFetch'
import * as ops from './acDataOps'
import type { ConfigState } from './acDataOps'
import type { LimitRow } from './acLimitForm'
import { useSourceObjects } from './useSourceObjects'

export interface AcDataConfig {
  dataset: ComputedRef<AcDataset | undefined>
  datasetKey: Ref<string>
  datasetOptions: ComputedRef<DtSelectOption[]>
  objectOptions: ComputedRef<DtSelectOption[]>
  loadingObjects: Ref<boolean>
  sourceObject: Ref<string>
  boundObject: ComputedRef<string>
  rows: Ref<LimitRow[]>
  loading: Ref<boolean>
  busy: Ref<boolean>
  error: ComputedRef<string | null>
  load: () => Promise<void>
  selectDataset: (key: string) => Promise<void>
  saveBinding: () => Promise<boolean>
  removeBinding: () => Promise<boolean>
  saveLimits: () => Promise<boolean>
}

/**
 * @param acUnitId 取当前这台空调的 id；弹窗换机器时它跟着变
 */
export function useAcDataConfig(acUnitId: () => string): AcDataConfig {
  const state: ConfigState = {
    acUnitId,
    datasets: ref<AcDataset[]>([]),
    datasetKey: ref(''),
    bindings: ref<AcDataBinding[]>([]),
    sourceObject: ref(''),
    rows: ref<LimitRow[]>([]),
    loading: ref(false),
    busy: ref(false),
    failure: ref<string | null>(null),
    snapshot: useRacedFetch(),
    objects: useSourceObjects(),
  }
  return {
    datasetKey: state.datasetKey,
    sourceObject: state.sourceObject,
    rows: state.rows,
    loading: state.loading,
    busy: state.busy,
    objectOptions: state.objects.options,
    loadingObjects: state.objects.loading,
    boundObject: computed(() => ops.boundObjectOf(state)),
    error: computed(() => state.failure.value ?? state.objects.error.value),
    dataset: computed(() =>
      state.datasets.value.find((item) => item.key === state.datasetKey.value),
    ),
    datasetOptions: computed(() =>
      state.datasets.value.map((item) => ({
        value: item.key,
        label: item.name,
      })),
    ),
    load: () => ops.load(state),
    selectDataset: (key) => ops.selectDataset(state, key),
    saveBinding: () => ops.saveBinding(state),
    removeBinding: () => ops.removeBinding(state),
    saveLimits: () => ops.saveLimits(state),
  }
}
