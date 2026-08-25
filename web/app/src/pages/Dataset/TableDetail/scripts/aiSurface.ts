/**
 * @fileoverview 台账详情页作为助手的工作面：它能读什么、能被要求做什么。
 *
 * ⚠ **这一页没有撤销栈。** 大屏编辑器改的是一份本地草稿，这里每一次写入都是
 * 真实落库。所以助手在这一页只有一个写动作，而它写的不是库、是一张**待用户
 * 确认的提议**（ADR-0023 的边界那一条）。
 *
 * ⚠ 列 key 建后不可改：它是数据行 JSONB 里的字段名，也是公式里的 `{列key}`。
 * 提议一个新列时给错 key，用户改不回来——所以提议里把 key 原样摆出来给人看。
 */
import { ref, type Ref } from 'vue'
import type { AssistantToolCall, DatasetColumn } from '@dt/contracts'

import type { AiSurface, SurfaceSnapshot } from '@/features/ai/surfaces'

/** 这一页实现了哪些客户端工具。⚠ 与技能清单里声明的名字逐字相同。 */
export const TABLE_TOOLS = [
  'dataset.read_columns',
  'dataset.propose_formula',
] as const

/** 助手交上来、等用户点头的一条公式。 */
export interface FormulaProposal {
  /** 写给哪一列；这一列还不存在时就是助手建议的新 key。 */
  columnKey: string
  formula: string
  /** 一句话说明它在算什么。 */
  reading: string
  /** 这一列此刻在不在表上——不在就是「要新建一列」。 */
  isExisting: boolean
}

export interface TableSurfaceDeps {
  tableId: () => string
  tableName: () => string
  columns: () => readonly DatasetColumn[]
}

export interface TableSurface {
  surface: AiSurface
  /** 待确认的提议；用户点过之后由页面清掉。 */
  proposal: Ref<FormulaProposal | null>
  clearProposal: () => void
}

/** 造出台账详情这个工作面。 */
export function createTableSurface(deps: TableSurfaceDeps): TableSurface {
  const proposal = ref<FormulaProposal | null>(null)
  return {
    proposal,
    clearProposal: () => {
      proposal.value = null
    },
    surface: {
      kind: 'dataset-table',
      label: '台账详情',
      tools: TABLE_TOOLS,
      snapshot: () => snapshotOf(deps),
      run: (call) => settle(deps, proposal, call),
    },
  }
}

function snapshotOf(deps: TableSurfaceDeps): SurfaceSnapshot {
  return {
    table_id: deps.tableId(),
    table_name: deps.tableName(),
    column_count: deps.columns().length,
    columns: deps.columns().map(columnOf),
  }
}

function columnOf(column: DatasetColumn): SurfaceSnapshot {
  return {
    key: column.key,
    name: column.name,
    unit: column.unit,
    data_type: column.data_type,
    source: column.source,
    formula: column.formula,
  }
}

/**
 * 把同步的分派收成一个 Promise。
 * ⚠ 必须接住同步抛：`Promise.resolve(dispatch(...))` 会在建出 Promise 之前
 * 就把异常扔出去，于是只挂了 `.catch()` 的调用方一个都收不到。
 */
function settle(
  deps: TableSurfaceDeps,
  proposal: Ref<FormulaProposal | null>,
  call: AssistantToolCall,
): Promise<unknown> {
  try {
    return Promise.resolve(dispatch(deps, proposal, call))
  } catch (error) {
    return Promise.reject(
      error instanceof Error ? error : new Error('执行失败'),
    )
  }
}

function dispatch(
  deps: TableSurfaceDeps,
  proposal: Ref<FormulaProposal | null>,
  call: AssistantToolCall,
): unknown {
  if (call.name === 'dataset.read_columns') return snapshotOf(deps)
  if (call.name === 'dataset.propose_formula') {
    return propose(deps, proposal, call)
  }
  throw new Error(`当前页面没有实现 ${call.name}`)
}

function propose(
  deps: TableSurfaceDeps,
  proposal: Ref<FormulaProposal | null>,
  call: AssistantToolCall,
): SurfaceSnapshot {
  const columnKey = textArg(call, 'column_key')
  const isExisting = deps.columns().some((one) => one.key === columnKey)
  proposal.value = {
    columnKey,
    formula: textArg(call, 'formula'),
    reading: textArg(call, 'reading'),
    isExisting,
  }
  // 把「这是新建还是改现有」如实回给模型：它据此决定该跟用户说哪一句
  return {
    ok: true,
    staged: true,
    column_key: columnKey,
    is_existing_column: isExisting,
    note: '已交给用户过目，落库要他自己点确认',
  }
}

function textArg(call: AssistantToolCall, name: string): string {
  const given = call.arguments[name]
  if (typeof given !== 'string' || given === '') {
    throw new Error(`${call.name} 少了参数 ${name}`)
  }
  return given
}
