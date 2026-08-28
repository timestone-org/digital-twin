/**
 * @fileoverview 绑点那一半里「读得准、看得见、存得下」的四件事：读绑定行、
 * 照抄绑定、读实时读数、落库（docs/AI_ASSISTANT_V3_PLAN.md §2.1–§2.4）。
 *
 * ⚠ 落库不另写一套：走页面现有的双轴保存，那份的顺序不变量（元数据轴先行、
 * 布局轴取推进后的版本）是唯一对的。
 * ⚠ 读数走画布同一份快照缓存，不另发请求：另发一次会出现「助手说有值、
 * 画面上是占位符」。
 */
import type {
  AssistantToolCall,
  BindingPayload,
  DashboardNodePayload,
} from '@dt/contracts'

import {
  manifestBindingReport,
  manifestBindingRows,
  type BindingReport,
  type BindingRowInput,
} from '@/features/ai/bindingReport'
import {
  copyMatchOf,
  planCopyBindings,
  type CopiedBinding,
  type CopyPlan,
} from '@/features/ai/copyBindings'
import { runSaveTool } from '@/features/ai/saveTool'
import {
  pairRows,
  valueReport,
  type ValueReport,
  type ValueRow,
} from '@/features/ai/valueReport'
import { createBinding, upsertBinding } from '@/features/dashboard/editorDoc'
import { nodeLabelOf } from '@/features/dashboard/nodeLabel'
import type { EditorToolDeps } from './aiSurfaceTypes'

/** 这一半实现了哪些工具。⚠ 与规格书 §2 里的名字逐字相同。 */
export const BINDING_TOOLS = [
  'dashboard.read_bindings',
  'dashboard.copy_bindings',
  'dashboard.read_values',
  'dashboard.save',
] as const

/** 整屏读数时，行名前面缀上节点名——否则同名的行分不出是哪一块上的。 */
const NAME_SEPARATOR = ' · '

/** 跑一个绑点工具；认不出名字给 null，由调用方接着往下问。 */
export function runBindingTool(
  deps: EditorToolDeps,
  call: AssistantToolCall,
): unknown {
  if (call.name === 'dashboard.read_bindings') return readBindings(deps, call)
  if (call.name === 'dashboard.copy_bindings') return copyBindings(deps, call)
  if (call.name === 'dashboard.read_values') return readValues(deps, call)
  if (call.name === 'dashboard.save') {
    return runSaveTool({ save: deps.save, version: deps.savedVersion })
  }
  return null
}

/** 一个画布节点的行表与它此刻的绑定。 */
function rowsOf(
  deps: EditorToolDeps,
  node: DashboardNodePayload,
): BindingRowInput[] {
  return manifestBindingRows({
    manifest: deps.getManifest(node.moduleType),
    config: node.configJson,
    bindings: node.bindings,
  })
}

function readBindings(
  deps: EditorToolDeps,
  call: AssistantToolCall,
): BindingReport {
  const node = nodeOf(deps, call, 'node_id')
  return manifestBindingReport({
    nodeId: node.id,
    moduleType: node.moduleType,
    nodeLabel: nodeLabelOf(node, deps.getManifest),
    manifest: deps.getManifest(node.moduleType),
    config: node.configJson,
    bindings: node.bindings,
  })
}

/**
 * 读此刻画面上的实时读数。
 * 不给 `node_id` 就整屏——那时行名前面缀节点名，否则十块卡片上都有一行叫
 * 「温度」，模型分不出说的是哪一块。
 */
function readValues(
  deps: EditorToolDeps,
  call: AssistantToolCall,
): ValueReport {
  const given = call.arguments.node_id
  const isWhole = given === undefined || given === null
  const nodes = isWhole
    ? deps.editor.nodes.value
    : [nodeOf(deps, call, 'node_id')]
  const rows: ValueRow[] = []
  for (const node of nodes) {
    const prefix = isWhole
      ? `${nodeLabelOf(node, deps.getManifest)}${NAME_SEPARATOR}`
      : ''
    // ⚠ 一块一块配对：整屏时十块卡片上的 `itemValues[0].value` 是同一个
    //   fieldKey，先并成一张表再配对会让后一块的绑定盖掉前一块的
    const paired = pairRows(rowsOf(deps, node), node.bindings)
    for (const one of paired) {
      rows.push({
        ...one,
        row: { ...one.row, label: `${prefix}${one.row.label}` },
      })
    }
  }
  return valueReport({ rows, read: deps.readSample })
}

/** 把一处接好的整套取数来源照抄到另一处。 */
function copyBindings(deps: EditorToolDeps, call: AssistantToolCall): CopyPlan {
  const from = nodeOf(deps, call, 'from_node_id')
  const to = nodeOf(deps, call, 'to_node_id')
  if (from.id === to.id) throw new Error('源与目标是同一个节点，没什么可抄的')
  const isDryRun = call.arguments.dry_run === true
  const plan = planCopyBindings({
    from: { rows: rowsOf(deps, from), bindings: from.bindings },
    to: { rows: rowsOf(deps, to), bindings: to.bindings },
    match: copyMatchOf(call.arguments.match),
    isDryRun,
  })
  if (!isDryRun && plan.copied.length > 0)
    applyCopy(deps, from, to, plan.copied)
  return plan
}

/**
 * 把算好的那批照抄真写进目标节点。
 * ⚠ 整批只压**一笔**撤销：拆成 N 笔的话，用户要按 N 次 Ctrl+Z 才退得回去，
 * 而「助手的一步 = 用户的一次撤销」是这套东西的基本承诺（ADR-0023）。
 */
function applyCopy(
  deps: EditorToolDeps,
  from: DashboardNodePayload,
  to: DashboardNodePayload,
  copied: readonly CopiedBinding[],
): void {
  const source = new Map(from.bindings.map((one) => [one.fieldKey, one]))
  // 先选中目标：用户要看见助手在动哪一个
  deps.editor.select(to.id)
  deps.editor.flush()
  deps.editor.apply((nodes) => {
    let next = [...nodes]
    for (const one of copied) {
      const found = source.get(one.from_field_key)
      if (found === undefined) continue
      next = upsertBinding(next, to.id, writtenFrom(to.id, one, found))
    }
    return next
  })
}

/**
 * 目标那一条要写成什么样。
 * ⚠ 取数明细整份誊过去（常量值、历史窗、派生规格、定值变换）：只誊 `nodeKey`
 * 的话，历史序列与台账那两种抄过去存得下、永远取不到数。
 */
function writtenFrom(
  nodeId: string,
  one: CopiedBinding,
  source: BindingPayload,
): BindingPayload {
  return {
    ...createBinding(nodeId, one.to_field_key),
    sourceKind: source.sourceKind,
    nodeKey: source.nodeKey,
    staticValueJson: source.staticValueJson,
    computeJson: source.computeJson,
    detailJson: source.detailJson,
    transformJson: source.transformJson,
  }
}

function nodeOf(
  deps: EditorToolDeps,
  call: AssistantToolCall,
  name: string,
): DashboardNodePayload {
  const nodeId = textArg(call, name)
  const node = deps.editor.nodes.value.find((one) => one.id === nodeId)
  // 认不出就抛：把「这个画布节点不在这一屏上」如实告诉模型，它下一轮会重读画布
  if (node === undefined) throw new Error(`画布上没有 ${nodeId} 这个节点`)
  return node
}

function textArg(call: AssistantToolCall, name: string): string {
  const given = call.arguments[name]
  if (typeof given !== 'string' || given === '') {
    throw new Error(`${call.name} 少了参数 ${name}`)
  }
  return given
}
