/**
 * @fileoverview 外部库里可绑定对象的取数。
 *
 * ⚠ 自己持一个竞态序号，不与弹窗别的取数共用：换数据集是点得很快的动作，
 * 共用序号会让两条路径互相顶掉，表现是「有时候下拉框是空的」。
 */
import { computed, ref, type ComputedRef, type Ref } from 'vue'
import type { AcSourceObject, DtSelectOption } from '@dt/contracts'

import * as hvac from '@/api/hvac'
import { describeError } from '@/composables/useAsyncList'
import { useRacedFetch, type RacedFetch } from '@/composables/useRacedFetch'

export interface SourceObjects {
  items: Ref<AcSourceObject[]>
  options: ComputedRef<DtSelectOption[]>
  loading: Ref<boolean>
  error: Ref<string | null>
  /** 拉某个数据集可绑定的对象；空串表示还没选出数据集。 */
  load: (dataset: string) => Promise<void>
}

interface ObjectsState {
  items: Ref<AcSourceObject[]>
  loading: Ref<boolean>
  error: Ref<string | null>
  raced: RacedFetch
}

export function useSourceObjects(): SourceObjects {
  const state: ObjectsState = {
    items: ref<AcSourceObject[]>([]),
    loading: ref(false),
    error: ref<string | null>(null),
    raced: useRacedFetch(),
  }
  return {
    items: state.items,
    loading: state.loading,
    error: state.error,
    options: computed(() => toOptions(state.items.value)),
    load: (dataset) => load(state, dataset),
  }
}

function toOptions(items: readonly AcSourceObject[]): DtSelectOption[] {
  return items.map((item) => ({
    value: item.name,
    // caption 是厂商给的中文别名，取不到就只显示对象名
    label:
      item.caption === null ? item.name : `${item.name}（${item.caption}）`,
  }))
}

async function load(state: ObjectsState, dataset: string): Promise<void> {
  if (dataset === '') {
    state.items.value = []
    return
  }
  state.loading.value = true
  state.error.value = null
  await state.raced.run(() => hvac.listAcSourceObjects(dataset), {
    ok: (found) => (state.items.value = found),
    fail: (caught) => {
      state.items.value = []
      state.error.value = describeError(caught)
    },
    settled: () => (state.loading.value = false),
  })
}
