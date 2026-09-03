/**
 * @fileoverview 参数面板那一摊：开着哪个节点、它的 schema 摊成什么字段、
 * 台账与列的候选从哪来。
 *
 * ⚠ 列候选**由后端算**（`:validate` 回执里的 `known_columns`）。前端只负责给
 * 每个列 key 配上台账里的显示名。这里曾经另写过一份「只按取数节点收窄」的口径，
 * 两份各自自洽而真跑起来对不上——加进会造列的算子之后更是整条错
 * （docs/MODELING_PLATFORM_DESIGN.md D2）。
 * ⚠ 台账清单仍然要按**上游那条支路**上的取数节点去拉：一条流水线接两张台账时，
 * 另一支的列名不该被列进来。
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
import { sourceTablesFor } from './upstream'
import { useLedgerOptions } from './useLedgerOptions'

type Operators = ReadonlyMap<string, ModelingOperator>
type Ledger = ReturnType<typeof useLedgerOptions>

export interface ConfigPanelDeps {
  graph: Ref<ModelingGraph>
  operators: ComputedRef<Operators>
  /** 后端算好的逐节点列候选；`null` = 推不出来，不收窄。 */
  knownColumns: Ref<Readonly<Record<string, string[] | null>>>
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
 * ⚠ 后端给的是**列 key 与顺序**，台账那边给的是显示名：按后端那份的顺序摆，
 * 名字对不上的（管线自己造出来的派生列）就拿 key 当名字，不能把它丢掉。
 */
function columnsFor(
  deps: ConfigPanelDeps,
  ledger: Ledger,
  nodeId: string | null,
): { columns: readonly { key: string; name: string }[]; note: string } {
  const codes = sourceTablesFor(deps.graph.value, deps.operators.value, nodeId)
  const all = codes.flatMap((code) => [...ledger.columnsOf(code)])
  const known =
    nodeId === null ? null : (deps.knownColumns.value[nodeId] ?? null)
  const columns =
    known === null
      ? all
      : known.map(
          (key) => all.find((item) => item.key === key) ?? { key, name: key },
        )
  return {
    columns,
    note: noteFor(codes, columns.length > 0, known !== null && all.length > 0),
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
