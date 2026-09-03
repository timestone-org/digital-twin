/**
 * @fileoverview 参数面板那一摊：开着哪个节点、它的 schema 摊成什么字段、
 * 台账与列的候选从哪来。
 *
 * ⚠ 列候选取自**上游那条支路**上的取数节点，不是图里所有取数节点：一条流水线
 * 接两张台账时，另一支的列名会被列进来，用户勾了要等运行时才报「这一列不存在」。
 */
import type {
  ModelingGraph,
  ModelingGraphNode,
  ModelingOperator,
} from '@dt/contracts'
import type { ComputedRef, Ref } from 'vue'
import { computed, ref, watch } from 'vue'

import type { FormOptions } from './schemaForm'
import { fieldsOf } from './schemaForm'
import { sourceTablesFor, upstreamSourcesFor, visibleKeysOf } from './upstream'
import { useLedgerOptions } from './useLedgerOptions'

type Operators = ReadonlyMap<string, ModelingOperator>
type Ledger = ReturnType<typeof useLedgerOptions>

export interface ConfigPanelDeps {
  graph: Ref<ModelingGraph>
  operators: ComputedRef<Operators>
  /** 改一个节点的参数。 */
  setConfig: (nodeId: string, config: Record<string, unknown>) => void
  /** 当前账号有没有 `dataset:view`——没有就不去拉台账清单。 */
  canViewLedger: () => boolean
}

/** 列候选列不出东西时该说哪一句。 */
function noteFor(
  tables: readonly string[],
  hasColumns: boolean,
  isNarrowed: boolean,
): string {
  if (tables.length === 0) return '先在上游的取数算子里选好台账'
  if (hasColumns) return ''
  if (isNarrowed) return '上游那一步的取数把列挑窄了，这里一列都不剩'
  return '这张台账还没有列，或者当前账号看不到它的列'
}

/**
 * 当前这个节点该看哪些列。
 *
 * ⚠ 收窄只看**别人**挑了什么，正在配的那个取数节点自己不算：拿它自己的选择去
 * 收窄自己的候选，等于一取消勾选就再也勾不回来。
 */
function columnsFor(
  deps: ConfigPanelDeps,
  ledger: Ledger,
  nodeId: string | null,
): { columns: readonly { key: string; name: string }[]; note: string } {
  const sources = upstreamSourcesFor(
    deps.graph.value,
    deps.operators.value,
    nodeId,
  )
  const codes = sourceTablesFor(deps.graph.value, deps.operators.value, nodeId)
  const all = codes.flatMap((code) => [...ledger.columnsOf(code)])
  const visible = visibleKeysOf(
    sources.filter((item) => item.nodeId !== nodeId),
  )
  const columns =
    visible === null ? all : all.filter((item) => visible.has(item.key))
  return {
    columns,
    note: noteFor(
      codes,
      columns.length > 0,
      visible !== null && all.length > 0,
    ),
  }
}

/** 当前开着的那个节点、它的算子与摊平后的字段表。 */
function viewsOf(
  deps: ConfigPanelDeps,
  nodeId: Ref<string | null>,
  ledger: Ledger,
) {
  const node = computed<ModelingGraphNode | null>(
    () =>
      deps.graph.value.nodes.find((item) => item.id === nodeId.value) ?? null,
  )
  const spec = computed(() =>
    node.value === null
      ? undefined
      : deps.operators.value.get(node.value.operator),
  )
  return {
    node,
    spec,
    fields: computed(() =>
      spec.value === undefined ? [] : fieldsOf(spec.value.config_schema),
    ),
    options: computed<FormOptions>(() => {
      const picked = columnsFor(deps, ledger, nodeId.value)
      return {
        tables: ledger.tables.value,
        tablesState: ledger.state.value,
        tablesNote: ledger.note.value,
        columns: picked.columns,
        columnsNote: picked.note,
      }
    }),
  }
}

export function useConfigPanel(deps: ConfigPanelDeps) {
  const nodeId = ref<string | null>(null)
  const ledger = useLedgerOptions({ canView: deps.canViewLedger })
  const views = viewsOf(deps, nodeId, ledger)

  // 上游选了哪张台账一变，就把那张台账的列拉回来
  watch(
    () => sourceTablesFor(deps.graph.value, deps.operators.value, nodeId.value),
    (codes) => {
      for (const code of codes) void ledger.loadColumns(code)
    },
    { immediate: true },
  )

  return {
    ...views,
    nodeId,
    loadTables: ledger.loadTables,
    open: (id: string) => {
      nodeId.value = id
    },
    close: () => {
      nodeId.value = null
    },
    setValue: (key: string, value: unknown) => {
      const current = views.node.value
      if (current === null) return
      deps.setConfig(current.id, { ...current.config, [key]: value })
    },
  }
}
