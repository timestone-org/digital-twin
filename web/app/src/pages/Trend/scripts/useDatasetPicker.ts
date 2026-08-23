/**
 * @fileoverview 趋势分析页「数据台账」这一面的选表：列台账、选一张、取它的列。
 *
 * ⚠ 深链带来的 `tableId` 找不到时**不静默改选第一张**：那会让人以为看的就是
 * 自己点进来的那一张，而图上画的是另一张表的数（docs/DATASET_DESIGN.md §7.13
 * 的口径——宁可说不知道，不许假装知道）。没带深链时才落到第一张。
 */
import { computed, ref, type ComputedRef, type Ref } from 'vue'

import type {
  DatasetColumn,
  DatasetTableSummary,
  DtSelectOption,
} from '@dt/contracts'

import { getDatasetTable, listDatasetTables } from '@/api/dataset'
import { describeError } from '@/composables/useAsyncList'
import { useRacedFetch, type RacedFetch } from '@/composables/useRacedFetch'

/** 一次列多少张台账。集合有界，一页取完免得再做一个翻页器。 */
const TABLE_PAGE_SIZE = 200

export interface DatasetPicker {
  tables: Ref<DatasetTableSummary[]>
  options: ComputedRef<DtSelectOption[]>
  tableId: Ref<string>
  columns: Ref<DatasetColumn[]>
  loading: Ref<boolean>
  error: Ref<string | null>
  /** 深链指向的台账不在了；这不是加载失败，页面照常可用。 */
  missingLink: Ref<string | null>
  /** 拉台账清单，并按深链预选。 */
  load: (wantedId: string | null) => Promise<void>
  /** 换一张表，连列一起换。 */
  select: (id: string) => Promise<void>
  dispose: () => void
}

/** 选表这一面要写的那几格。 */
interface PickerState {
  tables: Ref<DatasetTableSummary[]>
  tableId: Ref<string>
  columns: Ref<DatasetColumn[]>
  loading: Ref<boolean>
  error: Ref<string | null>
  missingLink: Ref<string | null>
}

function createState(): PickerState {
  return {
    tables: ref<DatasetTableSummary[]>([]),
    tableId: ref(''),
    columns: ref<DatasetColumn[]>([]),
    loading: ref(false),
    error: ref<string | null>(null),
    missingLink: ref<string | null>(null),
  }
}

/**
 * 换一张表：列先清空再取，取回来之前界面上不许留着上一张表的列。
 * @param state 要写的那几格
 * @param raced 竞态守卫
 * @param id 台账 id
 */
async function selectTable(
  state: PickerState,
  raced: RacedFetch,
  id: string,
): Promise<void> {
  state.tableId.value = id
  state.columns.value = []
  if (id === '') return
  state.loading.value = true
  await raced.run(() => getDatasetTable(id), {
    ok: (table) => {
      state.columns.value = table.columns
      state.error.value = null
    },
    fail: (caught) => (state.error.value = describeError(caught)),
    settled: () => (state.loading.value = false),
  })
}

/**
 * 拉台账清单，并按深链预选。
 * @param state 要写的那几格
 * @param listing 清单那条的竞态守卫
 * @param detail 详情那条的竞态守卫
 * @param wantedId 深链带来的台账 id，没带就是 null
 */
async function loadTables(
  state: PickerState,
  listing: RacedFetch,
  detail: RacedFetch,
  wantedId: string | null,
): Promise<void> {
  state.loading.value = true
  await listing.run(
    () => listDatasetTables({ page: 1, size: TABLE_PAGE_SIZE }),
    {
      ok: (page) => {
        state.tables.value = page.items
        state.error.value = null
      },
      fail: (caught) => {
        state.error.value = describeError(caught)
        state.tables.value = []
      },
      settled: () => (state.loading.value = false),
    },
  )
  const found = state.tables.value.some((table) => table.id === wantedId)
  if (wantedId !== null && !found) {
    state.missingLink.value = '链接里的台账不存在或已被删除，请自己选一张。'
    return
  }
  const fallback = wantedId ?? state.tables.value[0]?.id ?? ''
  if (fallback !== '') await selectTable(state, detail, fallback)
}

export function useDatasetPicker(): DatasetPicker {
  const state = createState()
  const listing = useRacedFetch()
  const detail = useRacedFetch()

  return {
    ...state,
    options: computed<DtSelectOption[]>(() =>
      state.tables.value.map((table) => ({
        value: table.id,
        label: table.name,
      })),
    ),
    load: (wantedId) => loadTables(state, listing, detail, wantedId),
    select: (id) => selectTable(state, detail, id),
    dispose: () => {
      listing.cancel()
      detail.cancel()
    },
  }
}
