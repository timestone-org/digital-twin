/**
 * @fileoverview 「数据与达标」弹窗的取数与回写动作。状态以一个显式的
 * `ConfigState` 传进来，组合式函数那层只负责把 ref 建好，见 ./useAcDataConfig.ts。
 */
import type { Ref } from 'vue'
import type {
  AcDataBinding,
  AcDataset,
  AcCompliancePolicy,
} from '@dt/contracts'

import * as hvac from '@/api/hvac'
import { describeError } from '@/composables/useAsyncList'
import type { RacedFetch } from '@/composables/useRacedFetch'
import { buildLimitRows } from './acLimitForm'
import type { LimitRow } from './acLimitForm'
import type { SourceObjects } from './useSourceObjects'
import {
  emptyWinter,
  seasonalPayload,
  validateSeasonalLimits,
  type WinterDraft,
} from './seasonalLimitForm'

export interface ConfigState {
  acUnitId: () => string
  datasets: Ref<AcDataset[]>
  datasetKey: Ref<string>
  bindings: Ref<AcDataBinding[]>
  sourceObject: Ref<string>
  rows: Ref<LimitRow[]>
  winter: Ref<WinterDraft>
  effectiveSeason: Ref<string>
  loadedUnitId: Ref<string>
  loading: Ref<boolean>
  busy: Ref<boolean>
  failure: Ref<string | null>
  // 与可绑定对象那条路径各持一个序号，理由见 useSourceObjects 的文件头
  snapshot: RacedFetch
  objects: SourceObjects
}

/** 后端当前记着的对象名；空串表示这个数据集还没绑。 */
export function boundObjectOf(state: ConfigState): string {
  return (
    state.bindings.value.find((item) => item.dataset === state.datasetKey.value)
      ?.source_object ?? ''
  )
}

/** 拉目录、现有绑定与现有达标范围，把表单铺成它们的样子。 */
export async function load(state: ConfigState): Promise<void> {
  state.loading.value = true
  state.failure.value = null
  const id = state.acUnitId()
  state.loadedUnitId.value = ''
  state.rows.value = []
  state.busy.value = false
  state.winter.value = emptyWinter()
  state.effectiveSeason.value = ''
  await state.snapshot.run(
    async () =>
      await Promise.all([
        hvac.listAcDatasets(),
        hvac.listAcDataBindings(id),
        hvac.getAcCompliancePolicy(id),
      ]),
    {
      ok: ([catalog, bound, limits]) => {
        state.datasets.value = catalog
        state.bindings.value = bound
        applyPolicy(state, limits)
        state.loadedUnitId.value = id
        state.datasetKey.value = catalog[0]?.key ?? ''
        state.sourceObject.value = boundObjectOf(state)
      },
      fail: (caught) => (state.failure.value = describeError(caught)),
      settled: () => (state.loading.value = false),
    },
  )
  await state.objects.load(state.datasetKey.value)
}

export async function selectDataset(
  state: ConfigState,
  key: string,
): Promise<void> {
  state.datasetKey.value = key
  state.sourceObject.value = boundObjectOf(state)
  await state.objects.load(key)
}

/** 跑一次写操作，把失败翻译成 in-form 的说明；成功给 true。 */
async function write(
  state: ConfigState,
  task: () => Promise<unknown>,
): Promise<boolean> {
  const id = state.acUnitId()
  state.busy.value = true
  state.failure.value = null
  try {
    await task()
    return state.acUnitId() === id
  } catch (caught) {
    if (state.acUnitId() === id) state.failure.value = describeError(caught)
    return false
  } finally {
    if (state.acUnitId() === id) state.busy.value = false
  }
}

export async function saveBinding(state: ConfigState): Promise<boolean> {
  if (state.sourceObject.value === '') return false
  return await write(state, async () => {
    const saved = await hvac.putAcDataBinding(
      state.acUnitId(),
      state.datasetKey.value,
      state.sourceObject.value,
    )
    state.bindings.value = [
      ...state.bindings.value.filter((item) => item.dataset !== saved.dataset),
      saved,
    ]
  })
}

export async function removeBinding(state: ConfigState): Promise<boolean> {
  const key = state.datasetKey.value
  return await write(state, async () => {
    await hvac.deleteAcDataBinding(state.acUnitId(), key)
    state.bindings.value = state.bindings.value.filter(
      (item) => item.dataset !== key,
    )
    state.sourceObject.value = ''
  })
}

/** ⚠ 提交的是**全部**可配指标：PUT 覆盖式，漏掉一项等于把它删了。 */
export async function saveLimits(state: ConfigState): Promise<boolean> {
  if (state.loadedUnitId.value !== state.acUnitId()) return false
  const invalid = validateSeasonalLimits(state.rows.value, state.winter.value)
  if (invalid !== null) {
    state.failure.value = invalid
    return false
  }
  const id = state.acUnitId()
  const payload = seasonalPayload(state.rows.value, state.winter.value)
  return await write(state, async () => {
    const saved = await hvac.putAcCompliancePolicy(id, payload)
    if (state.acUnitId() === id) applyPolicy(state, saved)
  })
}

function applyPolicy(state: ConfigState, saved: AcCompliancePolicy): void {
  state.rows.value = buildLimitRows(state.datasets.value, saved.non_winter)
  state.winter.value = {
    isEnabled: saved.winter_period !== null,
    start: saved.winter_period?.start ?? '',
    end: saved.winter_period?.end ?? '',
    rows: buildLimitRows(state.datasets.value, saved.winter),
  }
  state.effectiveSeason.value =
    saved.effective_season === 'winter' ? '冬季' : '非冬季'
}
