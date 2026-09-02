/**
 * @fileoverview 参数面板要的两份下拉数据：有哪些数据台账、某张台账有哪些列。
 *
 * ⚠ 台账清单归 `dataset:view` 管，而建模是另一套权限码：只有 `modeling:*` 的
 * 人会在这里吃 403。那时**不能只显示一个空下拉**——空下拉读起来是「一张台账
 * 都没建」，而真相是「你看不到」。拿不到就退回让人手填编码，并把原因说出来。
 */
import type { DatasetColumn, DatasetTableSummary } from '@dt/contracts'
import { ref, shallowRef } from 'vue'

import * as dataset from '@/api/dataset'

/** 台账清单一次取这么多。再多就该做搜索而不是下拉了。 */
const TABLE_PAGE_SIZE = 200

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

export function useLedgerOptions(deps: LedgerDeps) {
  const tables = shallowRef<readonly LedgerTable[]>([])
  /** 按台账编码缓存的列清单。**同一张只拉一次**。 */
  const columnsByCode = ref(new Map<string, readonly LedgerColumn[]>())
  /** 拿不到清单时的那句人话；拿得到就是空串。 */
  const note = ref('')
  const pending = new Set<string>()

  /** 拉一次台账清单。进画布时调一次就够。 */
  async function loadTables(): Promise<void> {
    // ⚠ 没有那个码就不发：种子角色 admin / viewer 都带着 dataset:view，但管理员
    // 能手工配出「只有 modeling 那一组」的角色，那时这一趟必被边缘挡下
    if (!deps.canView()) {
      note.value = '没有台账查看权限（dataset:view），台账编码只能手填'
      return
    }
    try {
      const page = await dataset.listDatasetTables({ size: TABLE_PAGE_SIZE })
      tables.value = page.items.map(tableOf)
      note.value =
        page.items.length === 0 ? '还没有建过数据台账，先去台账页建一张' : ''
    } catch {
      tables.value = []
      note.value = '看不到台账清单（要 dataset:view 权限），可以直接填台账编码'
    }
  }

  /**
   * 拉某张台账的列。拉过的不再拉。
   *
   * @param code 台账编码——图里存的是编码，而接口按 id 取列
   */
  async function loadColumns(code: string): Promise<void> {
    if (code === '' || !deps.canView()) return
    if (columnsByCode.value.has(code) || pending.has(code)) return
    const table = tables.value.find((item) => item.code === code)
    if (table === undefined) return
    pending.add(code)
    try {
      const rows = await dataset.listDatasetColumns(table.id)
      columnsByCode.value = new Map(columnsByCode.value).set(
        code,
        rows.map(columnOf),
      )
    } catch {
      // 拉不到列不该打断配参数：列选择器会退回「先选好台账」那句提示
    } finally {
      pending.delete(code)
    }
  }

  return {
    tables,
    note,
    loadTables,
    loadColumns,
    /** 某张台账的列；还没拉到时给空。 */
    columnsOf: (code: string): readonly LedgerColumn[] =>
      columnsByCode.value.get(code) ?? [],
  }
}
