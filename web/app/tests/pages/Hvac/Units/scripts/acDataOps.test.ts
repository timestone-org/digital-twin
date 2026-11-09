/**
 * @fileoverview 「数据与达标」写操作：在飞期间换了空调，回执不许写进新那台的状态。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { computed, ref } from 'vue'
import type { AcDataBinding } from '@dt/contracts'

import * as hvac from '@/api/hvac'
import { useRacedFetch } from '@/composables/useRacedFetch'
import {
  removeBinding,
  saveBinding,
  type ConfigState,
} from '@/pages/Hvac/Units/scripts/acDataOps'
import { emptyWinter } from '@/pages/Hvac/Units/scripts/seasonalLimitForm'

const STAMP = '2026-01-01T00:00:00.000Z'

function binding(source: string): AcDataBinding {
  return {
    dataset: 'raw_minute',
    source_object: source,
    created_at: STAMP,
    updated_at: STAMP,
  }
}

function state(unit: { id: string }): ConfigState {
  return {
    acUnitId: () => unit.id,
    datasets: ref([]),
    datasetKey: ref('raw_minute'),
    bindings: ref<AcDataBinding[]>([]),
    sourceObject: ref('VIEW_A'),
    rows: ref([]),
    winter: ref(emptyWinter()),
    effectiveSeason: ref(''),
    loadedUnitId: ref(unit.id),
    loading: ref(false),
    busy: ref(false),
    failure: ref<string | null>(null),
    snapshot: useRacedFetch(),
    objects: {
      items: ref([]),
      options: computed(() => []),
      loading: ref(false),
      error: ref<string | null>(null),
      load: async () => undefined,
    },
  }
}

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('写操作跨空调', () => {
  it('⚠ 保存绑定在飞时换了空调，回执不写进新那台', async () => {
    const pending = deferred<AcDataBinding>()
    const put = vi
      .spyOn(hvac, 'putAcDataBinding')
      .mockReturnValue(pending.promise)
    const unit = { id: 'A' }
    const config = state(unit)
    const saving = saveBinding(config)
    unit.id = 'B'
    config.bindings.value = [binding('VIEW_B')]
    pending.resolve(binding('VIEW_A'))
    await saving
    expect(put).toHaveBeenCalledWith('A', 'raw_minute', 'VIEW_A')
    expect(config.bindings.value).toEqual([binding('VIEW_B')])
  })

  it('⚠ 解除绑定在飞时换了空调，不清新那台的绑定', async () => {
    const pending = deferred<undefined>()
    vi.spyOn(hvac, 'deleteAcDataBinding').mockReturnValue(pending.promise)
    const unit = { id: 'A' }
    const config = state(unit)
    const removing = removeBinding(config)
    unit.id = 'B'
    config.bindings.value = [binding('VIEW_B')]
    config.sourceObject.value = 'VIEW_B'
    pending.resolve(undefined)
    await removing
    expect(config.bindings.value).toEqual([binding('VIEW_B')])
    expect(config.sourceObject.value).toBe('VIEW_B')
  })
})
