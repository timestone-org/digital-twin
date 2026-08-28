/**
 * @fileoverview 2D 孪生工作面绑点那一半：读绑定规格书、照抄绑定、读实时读数、
 * 落库（docs/AI_ASSISTANT_V3_PLAN.md §2.1–§2.4）。算法共用 `features/ai` 那份
 * 与大屏、3D 孪生同源的实现，这一页只负责把自己的行表喂进去。
 *
 * ⚠ 落库不另写一套：走页面现有的整树替换，漏一个节点就是把它删了。
 * ⚠ 读数走画中画同一份快照缓存，不另订一份：另订一份会出现「助手说有值、
 * 画面上是占位符」。
 * ⚠ 取值的四档与 `Twin2dLiveState` 是同一套说法：订上了没来第一帧是
 * `waiting`（几乎总是绑定还没保存），取数失败才是 `unavailable`。合成一档的话，
 * 模型会把「刚绑上还没保存」读成「这个点位是坏的」，然后去把绑定改掉。
 */
import type { AssistantToolCall, BindingPayload } from '@dt/contracts'
import {
  TWIN_2D_VIEW_BINDINGS,
  twin2dBindingRows,
  twin2dRowsOfEntity,
  type Twin2dBindingRow,
  type Twin2dConfig,
} from '@dt/twin2d'

import {
  rowsBindingReport,
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
} from '@/features/ai/valueReport'
import { createBinding } from '@/features/dashboard/editorDoc'

import type { Twin2dSurfaceDeps } from './aiSurfaceTypes'

/** 这一半实现了哪些工具。⚠ 与规格书 §2 里的名字逐字相同。 */
export const TWIN_2D_BINDING_TOOLS = [
  'dashboard.read_bindings',
  'dashboard.copy_bindings',
  'dashboard.read_values',
  'dashboard.save',
] as const

/** 三个数组槽的槽名，规格书里 `slots[].label` 那一格用它。 */
const SLOT_LABELS: Readonly<Record<string, string>> = Object.fromEntries(
  TWIN_2D_VIEW_BINDINGS.map((spec) => [spec.key, spec.label]),
)

/** 跑一个绑点工具；认不出名字给 null，由调用方接着往下问。 */
export function runTwin2dBindingTool(
  deps: Twin2dSurfaceDeps,
  call: AssistantToolCall,
): unknown {
  if (call.name === 'dashboard.read_bindings') {
    return readBindings(deps, call)
  }
  if (call.name === 'dashboard.copy_bindings') return copyBindings(deps, call)
  if (call.name === 'dashboard.read_values') return readValues(deps, call)
  if (call.name === 'dashboard.save') {
    return runSaveTool({ save: deps.save, version: deps.savedVersion })
  }
  return null
}

/**
 * 入参里的 `node_id` 认不认。
 * ⚠ 子编辑器一次只编**一段**孪生，而工具契约里 `node_id` 是必填的。收下一个别的
 * 节点却照样按本段动手，模型会拿这一次的结果当另一块屏的证据——静默动错对象是
 * 这套东西最难查的一类故障。给的是本段那个、或者干脆没给，才往下走。
 * @param deps 工作面句柄
 * @param call 模型下发的调用
 */
export function twin2dSameNodeOrThrow(
  deps: Twin2dSurfaceDeps,
  call: AssistantToolCall,
): void {
  const given = call.arguments.node_id
  if (typeof given === 'string' && given !== deps.nodeId()) {
    throw new Error(`这一页只编 ${deps.nodeId()} 这一张图，动不了 ${given}`)
  }
}

/** 当前配置；还没读出来就如实抛，模型下一轮会重读一次工作面。 */
export function twin2dConfigOf(deps: Twin2dSurfaceDeps): Twin2dConfig {
  const config = deps.config()
  if (config === null) throw new Error('2D 孪生配置还没读出来')
  return config
}

function readBindings(
  deps: Twin2dSurfaceDeps,
  call: AssistantToolCall,
): BindingReport {
  twin2dSameNodeOrThrow(deps, call)
  return rowsBindingReport({
    nodeId: deps.nodeId(),
    moduleType: deps.moduleType(),
    nodeLabel: deps.nodeLabel(),
    rows: twin2dBindingRows(twin2dConfigOf(deps)),
    bindings: deps.bindings(),
    slotLabels: SLOT_LABELS,
  })
}

/** 读此刻画面上的实时读数；不给 `node_id` 就是整张图。 */
function readValues(
  deps: Twin2dSurfaceDeps,
  call: AssistantToolCall,
): ValueReport {
  twin2dSameNodeOrThrow(deps, call)
  const rows = twin2dBindingRows(twin2dConfigOf(deps))
  return valueReport({
    rows: pairRows(rows, deps.bindings()),
    read: deps.read,
  })
}

/**
 * 一行拿来**对齐**的那半个名字。
 * ⚠ 行名是「节点名 · 槽名」这种整名，直接拿它对齐的话两个节点之间永远对不上。
 * 节点读数行记着自己喂的是哪个**槽位键**，那才是「同一个实体内第几件事」的稳定
 * 身份；状态行与连线行一个实体只占一行，没有这一截，退回槽键——那时「这个槽的
 * 那一行」就是它的全部身份。
 */
function alignLabelOf(row: Twin2dBindingRow): string {
  return row.entitySlot === '' ? row.slotKey : row.entitySlot
}

/**
 * 某个实体占的那些行，`label` 换成对齐用的那半个名字。
 * ⚠ 行上带的是**行号**，过滤之后绝不许重新编号：数组绑定的 fieldKey 是
 * `槽[行号].子键`，按过滤后的位置重编会让每一条绑定改喂另一个实体。
 * @param config 归一化后的 2D 孪生配置
 * @param entityId 节点 id 或连线 id
 */
function alignRowsOf(
  config: Twin2dConfig,
  entityId: string,
): BindingRowInput[] {
  return twin2dRowsOfEntity(config, entityId).map((row) => ({
    ...row,
    label: alignLabelOf(row),
  }))
}

/** 把一处接好的整套取数来源照抄到另一处实体上。 */
function copyBindings(
  deps: Twin2dSurfaceDeps,
  call: AssistantToolCall,
): CopyPlan {
  const fromId = textArg(call, 'from_entity_id')
  const toId = textArg(call, 'to_entity_id')
  if (fromId === toId) throw new Error('源与目标是同一个实体，没什么可抄的')
  const config = twin2dConfigOf(deps)
  const bindings = deps.bindings()
  const isDryRun = call.arguments.dry_run === true
  const plan = planCopyBindings({
    from: { rows: rowsOrThrow(config, fromId), bindings },
    to: { rows: rowsOrThrow(config, toId), bindings },
    match: copyMatchOf(call.arguments.match),
    isDryRun,
  })
  if (!isDryRun) applyCopy(deps, bindings, plan.copied)
  return plan
}

/** 认不出的实体一律抛：静默交一份空计划会被模型读成「那边本来就没接过」。 */
function rowsOrThrow(
  config: Twin2dConfig,
  entityId: string,
): BindingRowInput[] {
  const found = alignRowsOf(config, entityId)
  if (found.length === 0) {
    throw new Error(`这张图里 ${entityId} 没有可绑的行，先读一次绑定`)
  }
  return found
}

/**
 * 把算好的那批照抄真写进目标实体。
 * ⚠ 逐条走页面现有的 `write`：它按 (节点, 槽) 并帧，所以同一个槽里的整批照抄
 * 仍然只占一次撤销——「助手的一步 = 用户的一次撤销」是这套东西的基本承诺
 * （ADR-0023）。
 * @param deps 工作面句柄
 * @param bindings 动手之前的那一份绑定
 * @param copied 算好的那批
 */
function applyCopy(
  deps: Twin2dSurfaceDeps,
  bindings: readonly BindingPayload[],
  copied: readonly CopiedBinding[],
): void {
  const source = new Map(bindings.map((one) => [one.fieldKey, one]))
  for (const one of copied) {
    const found = source.get(one.from_field_key)
    if (found === undefined) continue
    deps.write(writtenFrom(deps.nodeId(), one.to_field_key, found))
  }
}

/**
 * 目标那一行要写成什么样。
 * ⚠ 取数明细整份誊过去（常量值、历史窗、派生规格、定值变换）：只誊 `nodeKey`
 * 的话，历史序列与台账那两种抄过去存得下、永远取不到数。
 * ⚠ 不在这里找旧绑定补 id：页面的 `write` 按 fieldKey 原地替换时**自己沿用**
 * 旧 id，两处都补一遍只会多一处能漏。
 */
function writtenFrom(
  nodeId: string,
  fieldKey: string,
  source: BindingPayload,
): BindingPayload {
  return {
    ...createBinding(nodeId, fieldKey),
    sourceKind: source.sourceKind,
    nodeKey: source.nodeKey,
    staticValueJson: source.staticValueJson,
    computeJson: source.computeJson,
    detailJson: source.detailJson,
    transformJson: source.transformJson,
  }
}

function textArg(call: AssistantToolCall, name: string): string {
  const given = call.arguments[name]
  if (typeof given !== 'string' || given === '') {
    throw new Error(`${call.name} 少了参数 ${name}`)
  }
  return given
}
