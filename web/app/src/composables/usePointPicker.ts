/** @fileoverview 配置挑点状态：关键词列表与助手同源的语义候选，统一防竞态。 */
import { computed, ref, type Ref } from 'vue'
import type {
  CollectPoint,
  CollectSource,
  DtSelectOption,
  PointMatchOut,
} from '@dt/contracts'
import { listSources } from '@/api/collect'
import { resolveCollectPoint } from '@/api/collectSearch'
import { describeError } from '@/composables/useAsyncList'
import { useRacedFetch } from '@/composables/useRacedFetch'
import { usePointPickerSearch } from '@/composables/usePointPickerSearch'
import { protocolLabel } from '@/features/collect/protocols'

export { POINT_PICKER_PAGE_SIZE } from '@/composables/usePointPickerSearch'
const SOURCE_PAGE_SIZE = 200
export const ANY_SOURCE = ''
export type PointPicker = ReturnType<typeof usePointPicker>

/** 数据源筛选与名称；清单失败不阻断点位搜索。 */
function useSourceList() {
  const sources = ref<readonly CollectSource[]>([])
  const sourceError = ref<string | null>(null)
  async function loadSources(): Promise<void> {
    sourceError.value = null
    try {
      sources.value = (await listSources({ size: SOURCE_PAGE_SIZE })).items
    } catch (caught) {
      sources.value = []
      sourceError.value = describeError(caught)
    }
  }
  return {
    sourceError,
    loadSources,
    sourceOptions: computed<DtSelectOption[]>(() => [
      { value: ANY_SOURCE, label: '全部数据源' },
      ...sources.value.map((one) => ({
        value: one.id,
        label: `${one.name} · ${protocolLabel(one.protocol)}`,
      })),
    ]),
    sourceName: (id: string) =>
      sources.value.find((one) => one.id === id)?.name ?? '',
  }
}

/** 选中候选时读取真实配置；关闭或重搜后不再回填。 */
function usePointSelection(error: Ref<string | null>) {
  const selecting = ref(false)
  const raced = useRacedFetch()
  async function resolve(
    point: CollectPoint | PointMatchOut,
  ): Promise<CollectPoint | null> {
    if ('address' in point) return point
    selecting.value = true
    error.value = null
    let selected: CollectPoint | null = null
    await raced.run((signal) => resolveCollectPoint(point, signal), {
      ok: (result) => {
        selected = result
      },
      fail: (caught) => {
        error.value = describeError(caught)
      },
      settled: () => {
        selecting.value = false
      },
    })
    return selected
  }
  return {
    selecting,
    resolve,
    cancel: () => {
      raced.cancel()
      selecting.value = false
    },
  }
}

export function usePointPicker(initialSemantic = false) {
  const state = usePointPickerSearch(initialSemantic)
  const selection = usePointSelection(state.error)
  return {
    ...state,
    ...useSourceList(),
    selecting: selection.selecting,
    resolve: selection.resolve,
    search: () => {
      selection.cancel()
      return state.search()
    },
    dispose: () => {
      state.dispose()
      selection.cancel()
    },
  }
}
