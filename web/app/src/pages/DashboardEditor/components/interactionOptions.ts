/**
 * @fileoverview 联动编辑面的纯数据：事件与动作的中文名与下拉项、换动作类型时的
 * 缺省形状、规则摘要文案，以及「哪些节点能当事件源」的判定。
 */
import type {
  DashboardNodePayload,
  DtSelectOption,
  InteractionAction,
  InteractionEventName,
  InteractionRule,
} from '@dt/contracts'
import { INTERACTION_EVENTS } from '@dt/contracts'
import type { GetModuleManifest } from '@dt/runtime'

import { nodeLabelOf } from '@/features/dashboard/nodeLabel'

/** 动作的判别键，取值来自契约里 `InteractionAction` 的六个 type。 */
export type InteractionActionType = InteractionAction['type']

const EVENT_LABELS: Record<InteractionEventName, string> = {
  click: '点击',
  change: '变化',
  select: '选项点击',
}

const ACTION_LABELS: Record<InteractionActionType, string> = {
  show: '显示目标',
  hide: '隐藏目标',
  toggle: '切换目标显隐',
  setActive: '按值互斥切换',
  openModal: '弹出弹窗',
  closeModal: '关闭弹窗',
}

// 显隐三档排在前面：它们是最常配的，互斥切换与弹窗要多填字段
const ACTION_TYPES = [
  'show',
  'hide',
  'toggle',
  'setActive',
  'openModal',
  'closeModal',
] as const satisfies readonly InteractionActionType[]

export const EVENT_OPTIONS: readonly DtSelectOption[] = INTERACTION_EVENTS.map(
  (event) => ({ value: event, label: EVENT_LABELS[event] }),
)

export const ACTION_OPTIONS: readonly DtSelectOption[] = ACTION_TYPES.map(
  (type) => ({ value: type, label: ACTION_LABELS[type] }),
)

/** 下拉回来的字符串是不是合法事件名。 */
export function isEventName(raw: string): raw is InteractionEventName {
  return (INTERACTION_EVENTS as readonly string[]).includes(raw)
}

/** 下拉回来的字符串是不是合法动作类型。 */
export function isActionType(raw: string): raw is InteractionActionType {
  return (ACTION_TYPES as readonly string[]).includes(raw)
}

/**
 * 能当事件源的节点：清单声明整块可点，或模块自己上抛交互事件。
 * 两个标记正交、任一为真即可，都没有的模块（纯装饰）配了也永远不会触发。
 */
export function isInteractiveSource(
  node: Pick<DashboardNodePayload, 'moduleType'>,
  getManifest: GetModuleManifest,
): boolean {
  const manifest = getManifest(node.moduleType)
  if (manifest === undefined) return false
  return manifest.hostClickable === true || manifest.emitsInteractions === true
}

/** 节点下拉项：显示名走 `nodeLabelOf`，值一律是 nodeId。 */
export function nodeOptionsOf(
  nodes: readonly DashboardNodePayload[],
  getManifest: GetModuleManifest,
): DtSelectOption[] {
  return nodes.map((node) => ({
    value: node.id,
    label: nodeLabelOf(node, getManifest),
  }))
}

function actionSummary(
  action: InteractionAction,
  labelOf: (nodeId: string) => string,
): string {
  if (action.type === 'closeModal') return ACTION_LABELS.closeModal
  if (action.type === 'openModal') {
    return `${ACTION_LABELS.openModal}：${labelOf(action.target)}`
  }
  if (action.type === 'setActive') {
    return `${ACTION_LABELS.setActive}（${action.groups.length} 组）`
  }
  return `${ACTION_LABELS[action.type]}（${action.targets.length} 个）`
}

/** 一条规则的摘要：源节点名 · 事件 → 动作。 */
export function ruleSummary(
  rule: InteractionRule,
  labelOf: (nodeId: string) => string,
): string {
  const source = `${labelOf(rule.source.nodeId)} · ${EVENT_LABELS[rule.source.event]}`
  return `${source} → ${actionSummary(rule.action, labelOf)}`
}

/** 这个动作会作用到哪些节点上。`closeModal` 不指名任何节点，故给空表。 */
function actionTargets(action: InteractionAction): readonly string[] {
  if (action.type === 'closeModal') return []
  if (action.type === 'openModal') return [action.target]
  if (action.type === 'setActive') {
    return action.groups.flatMap((group) => group.targets)
  }
  return action.targets
}

/**
 * 这条规则跟这个节点有没有关系——它当触发源，或者它是被控制的一方。
 * 选中某个模块时的联动页只列出这些，整屏几十条规则里翻自己那几条翻不动。
 * @param rule 一条规则
 * @param nodeId 当前选中的节点
 */
export function ruleTouchesNode(rule: InteractionRule, nodeId: string): boolean {
  return (
    rule.source.nodeId === nodeId || actionTargets(rule.action).includes(nodeId)
  )
}

/**
 * 换动作类型后的新动作：同族能沿用的沿用（显隐三档共用一张目标表，
 * 互斥切换换来换去保住已配的组），其余给空。
 * @param fallbackTarget 弹窗缺省落在哪个节点上；没有节点时给空串
 */
export function actionForType(
  type: InteractionActionType,
  current: InteractionAction,
  fallbackTarget: string,
): InteractionAction {
  if (type === 'show' || type === 'hide' || type === 'toggle') {
    return { type, targets: 'targets' in current ? current.targets : [] }
  }
  if (type === 'setActive') {
    return { type, groups: current.type === 'setActive' ? current.groups : [] }
  }
  if (type === 'openModal') {
    const target =
      current.type === 'openModal' ? current.target : fallbackTarget
    return { type, target }
  }
  return { type: 'closeModal' }
}
