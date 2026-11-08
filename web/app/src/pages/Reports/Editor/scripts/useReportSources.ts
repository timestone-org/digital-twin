/**
 * @fileoverview 报告可用的数据来源目录：台账（按 code 引用）与模板里的第三方 API 来源，
 * 列清单按需加载并缓存；失败不写缓存，避免一次网络抖动永久毒化下拉。
 */
import { computed, onBeforeUnmount, ref, type Ref } from 'vue'
import type { DatasetTableSummary, ReportBody } from '@dt/contracts'
import { listDatasetColumns, listDatasetTables } from '@/api/dataset'
import { describeError } from '@/composables/useAsyncList'
import { useRacedFetch } from '@/composables/useRacedFetch'

type ApiSources = NonNullable<ReportBody['api_sources']>

export interface SourceColumn {
  key: string
  name: string
  dataType: string
}

export interface SourceOption {
  value: string
  label: string
}

const MAX_CATALOG_PAGES = 50
const PAGE_SIZE = 200

async function loadCatalog(): Promise<DatasetTableSummary[]> {
  const result: DatasetTableSummary[] = []
  for (let page = 1; page <= MAX_CATALOG_PAGES; page += 1) {
    const found = await listDatasetTables({ page, size: PAGE_SIZE })
    result.push(...found.items)
    if (result.length >= found.total || !found.items.length) return result
  }
  throw new Error('台账目录超过加载上限')
}

function apiColumns(sources: ApiSources, source: string): SourceColumn[] {
  const found = sources.find((item) => `api:${item.code}` === source)
  return (found?.columns ?? []).map((column) => ({
    key: column.key,
    name: column.name,
    dataType: column.data_type ?? 'number',
  }))
}

function useColumnCache(
  tables: Ref<DatasetTableSummary[]>,
  error: Ref<string>,
) {
  const columns: Ref<Record<string, SourceColumn[]>> = ref({})
  const loading = new Set<string>()
  async function ensure(source: string): Promise<void> {
    if (!source || source.startsWith('api:') || columns.value[source]) return
    const table = tables.value.find((item) => item.code === source)
    if (!table || loading.has(source)) return
    loading.add(source)
    try {
      const items = await listDatasetColumns(table.id)
      columns.value = {
        ...columns.value,
        [source]: items.map((item) => ({
          key: item.key,
          name: item.name,
          dataType: item.data_type,
        })),
      }
    } catch (caught) {
      error.value = describeError(caught)
    } finally {
      loading.delete(source)
    }
  }
  return { columns, ensure }
}

/**
 * 数据来源目录与列清单。
 * @param apiSources 模板当前草稿里的 API 来源
 */
export function useReportSources(apiSources: () => ApiSources) {
  const tables = ref<DatasetTableSummary[]>([])
  const error = ref('')
  const cache = useColumnCache(tables, error)
  const catalog = useRacedFetch()
  let started = false

  const options = computed<SourceOption[]>(() => [
    ...tables.value.map((table) => ({
      value: table.code,
      label: `台账 · ${table.name}`,
    })),
    ...apiSources().map((source) => ({
      value: `api:${source.code}`,
      label: `API · ${source.name}`,
    })),
  ])

  function start(): void {
    if (started) return
    started = true
    void catalog.run(loadCatalog, {
      ok: (items) => {
        tables.value = items
      },
      fail: (caught) => {
        started = false
        error.value = describeError(caught)
      },
      settled: () => undefined,
    })
  }

  /** @param source 来源取值 */
  function columnsOf(source: string): SourceColumn[] {
    return source.startsWith('api:')
      ? apiColumns(apiSources(), source)
      : (cache.columns.value[source] ?? [])
  }

  /** @param source 来源取值 */
  function labelOf(source: string): string {
    return options.value.find((item) => item.value === source)?.label ?? source
  }

  onBeforeUnmount(() => catalog.cancel())
  return {
    options,
    error,
    start,
    ensure: cache.ensure,
    columnsOf,
    labelOf,
    tables,
  }
}
