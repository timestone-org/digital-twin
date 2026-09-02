/**
 * @fileoverview 参数面板要的两份下拉数据：有哪些数据台账、某张台账有哪些列。
 *
 * ⚠ 台账清单归 `dataset:view` 管，而建模是另一套权限码：只有 `modeling:*` 的
 * 人会在这里吃 403。那时**不能只显示一个空下拉**——空下拉读起来是「一张台账
 * 都没建」，而真相是「你看不到」。没有那个码就不发请求、退回手填并说出原因。
 * ⚠ 「没权限」与「拉取失败」是两种状态：失败要给重试，说成权限问题会让人去找
 * 管理员要一个他本来就有的码。
 */
import type { DatasetColumn, DatasetTableSummary } from '@dt/contracts'
import type { Ref } from 'vue'
import { ref, shallowRef } from 'vue'

import * as dataset from '@/api/dataset'
import { describeError } from '@/composables/useAsyncList'
import { useRacedFetch } from '@/composables/useRacedFetch'

import type { TableListState } from './schemaForm'

/** 台账清单一页取这么多，是接口的上限；超过一页就接着翻。 */
const TABLE_PAGE_SIZE = 200
/** 最多翻这么多页。台账是业务级别的数量，翻到这里还没完那是数据出了问题。 */
const MAX_TABLE_PAGES = 10

/** 参数面板认的一列。 */
export interface LedgerColumn {
  key: string
  name: string
}

/** 参数面板认的一张台账。 */
export interface LedgerTable {
  id: string
  code: string
  name: string
}

function tableOf(row: DatasetTableSummary): LedgerTable {
  return { id: row.id, code: row.code, name: row.name }
}

function columnOf(row: DatasetColumn): LedgerColumn {
  return { key: row.key, name: row.name }
}

export interface LedgerDeps {
  /** 当前账号有没有 `dataset:view`。没有就一趟请求都不发。 */
  canView: () => boolean
}

/**
 * 把台账清单翻完。页码分页，拿够 `total` 条就停；一页空着也停，免得空转。
 *
 * ⚠ 不能只拿第一页：清单一旦超过一页，后面那些台账在下拉里就凭空消失，
 * 而用户看到的只是「我的表怎么不在」。
 */
async function allTables(): Promise<DatasetTableSummary[]> {
  const rows: DatasetTableSummary[] = []
  for (let page = 1; page <= MAX_TABLE_PAGES; page += 1) {
    const got = await dataset.listDatasetTables({ page, size: TABLE_PAGE_SIZE })
    rows.push(...got.items)
    if (rows.length >= got.total || got.items.length === 0) break
  }
  return rows
}

/** 按台账编码缓存的列清单。**同一张只拉一次**。 */
function columnCache(
  deps: LedgerDeps,
  tables: Readonly<Ref<readonly LedgerTable[]>>,
) {
  const byCode = ref(new Map<string, readonly LedgerColumn[]>())
  const pending = new Set<string>()

  /**
   * 拉某张台账的列。拉过的不再拉。
   *
   * @param code 台账编码——图里存的是编码，而接口按 id 取列
   */
  async function load(code: string): Promise<void> {
    if (code === '' || !deps.canView()) return
    if (byCode.value.has(code) || pending.has(code)) return
    const table = tables.value.find((item) => item.code === code)
    if (table === undefined) return
    pending.add(code)
    try {
      const rows = await dataset.listDatasetColumns(table.id)
      byCode.value = new Map(byCode.value).set(code, rows.map(columnOf))
    } catch {
      // 拉不到列不该打断配参数：列选择器会退回「先选好台账」那句提示
    } finally {
      pending.delete(code)
    }
  }

  return {
    load,
    /** 某张台账的列；还没拉到时给空。 */
    of: (code: string): readonly LedgerColumn[] => byCode.value.get(code) ?? [],
  }
}

export function useLedgerOptions(deps: LedgerDeps) {
  const tables = shallowRef<readonly LedgerTable[]>([])
  const state = ref<TableListState>('loading')
  /** 清单列不出东西时的那句人话；列得出就是空串。 */
  const note = ref('')
  const columns = columnCache(deps, tables)
  // 进画布拉一次、失败后按「重试」再拉，慢的那次后返回不许盖掉快的那次
  const listing = useRacedFetch()

  function settle(rows: DatasetTableSummary[]): void {
    tables.value = rows.map(tableOf)
    state.value = rows.length === 0 ? 'empty' : 'ready'
    note.value = rows.length === 0 ? '还没有建过数据台账，先去台账页建一张' : ''
  }

  /** 拉台账清单。进画布时调一次；拉失败了由「重试」再调。 */
  async function loadTables(): Promise<void> {
    // ⚠ 没有那个码就不发：种子角色 admin / viewer 都带着 dataset:view，但管理员
    // 能手工配出「只有 modeling 那一组」的角色，那时这一趟必被边缘挡下
    if (!deps.canView()) {
      state.value = 'denied'
      note.value = '没有台账查看权限（dataset:view），台账编码只能手填'
      return
    }
    state.value = 'loading'
    note.value = '正在拉台账清单…'
    await listing.run(allTables, {
      ok: settle,
      fail: (caught) => {
        tables.value = []
        state.value = 'failed'
        note.value = `没拉到台账清单：${describeError(caught)}`
      },
      settled: () => undefined,
    })
  }

  return {
    tables,
    state,
    note,
    loadTables,
    loadColumns: columns.load,
    columnsOf: columns.of,
  }
}
