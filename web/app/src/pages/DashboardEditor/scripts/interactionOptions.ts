/**
 * @fileoverview 联动编辑面的纯数据：事件与动作的中文名与下拉项、换动作类型时的
 * 缺省形状、规则摘要文案，以及「哪些节点能当事件源」的判定。
 */
import type {
  ConfigField,
  DashboardNodePayload,
  DtSelectOption,
  InteractionAction,
  InteractionEventName,
  InteractionRule,
  ModuleManifest,
} from '@dt/contracts'
import { INTERACTION_EVENTS } from '@dt/contracts'
import type { GetModuleManifest } from '@dt/runtime'

import { nodeLabelOf } from '@/features/dashboard/nodeLabel'

/** 动作的判别键，取值来自契约里 `InteractionAction` 的六个 type。 */
export type InteractionActionType = InteractionAction['type']

/**
 * 跳转目标那一格借的是属性面板那套控件，故要给它一份字段声明。
 * ⚠ 只能是 `dashboard-ref`（从本项目的大屏里挑），不是一个能填任意地址的框：
 * 能配 URL 的大屏等于一个站内跳板（开放重定向）。
 */
export const NAVIGATE_TARGET_FIELD: ConfigField = {
  key: 'target',
  label: '目标大屏',
  type: 'dashboard-ref',
  placeholder: '目标大屏 id',
}

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
  navigate: '跳转到大屏',
  navigateByValue: '按值跳转大屏',
}

// 显隐三档排在前面：它们是最常配的，互斥切换与弹窗要多填字段。
// 两档跳转排在最后：它们是唯一会**离开本屏**的，与前面几档不是一类事
const ACTION_TYPES = [
  'show',
  'hide',
  'toggle',
  'setActive',
  'openModal',
  'closeModal',
  'navigate',
  'navigateByValue',
] as const satisfies readonly InteractionActionType[]

/** 清单没声明 `interactionEvents` 时的缺省：全仓内置模块实际只上抛 click。 */
const DEFAULT_INTERACTION_EVENTS: readonly InteractionEventName[] = ['click']

/**
 * 这个模块真发得出的事件。
 * ⚠ 助手那条路也读它：另写一份缺省会让面板与助手对同一个模块给出两套答案。
 * @param manifest 源节点的模块清单；节点已删 / 类型未注册时给 undefined
 */
export function supportedEventsOf(
  manifest: ModuleManifest | undefined,
): readonly InteractionEventName[] {
  return manifest?.interactionEvents ?? DEFAULT_INTERACTION_EVENTS
}

/**
 * 源节点的「触发事件」下拉项：按源模块清单声明的 `interactionEvents` 过滤。
 * 存量规则引用了源发不出的事件时**保留该项并标注**，不许静默吞掉存量配置。
 * @param manifest 源节点的模块清单；节点已删 / 类型未注册时给 undefined
 * @param currentEvent 规则当前引用的事件
 */
export function eventOptionsFor(
  manifest: ModuleManifest | undefined,
  currentEvent: InteractionEventName,
): DtSelectOption[] {
  const supported = supportedEventsOf(manifest)
  return INTERACTION_EVENTS.filter(
    (event) => supported.includes(event) || event === currentEvent,
  ).map((event) => ({
    value: event,
    label: supported.includes(event)
      ? EVENT_LABELS[event]
      : `${EVENT_LABELS[event]}（该模块不会发出此事件）`,
  }))
}

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
  // ⚠ 摘要里不解析目标大屏的名字：这里是同步的纯数据，而大屏清单要现拉。
  // 只说清「这条会走人」与「挑没挑目标」，名字由下面的选择器负责显示
  if (action.type === 'navigate') {
    return action.target === ''
      ? `${ACTION_LABELS.navigate}（未挑目标）`
      : ACTION_LABELS.navigate
  }
  if (action.type === 'navigateByValue') {
    return `${ACTION_LABELS.navigateByValue}（${action.routes.length} 条）`
  }
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

/**
 * 这个动作会作用到哪些**节点**上。`closeModal` 不指名任何节点，故给空表。
 * ⚠ 两档跳转的 target 是**大屏**不是节点，同样给空表：混进来的话，
 * 选中某个节点时的联动页会因为 id 撞上而列出一条跟它毫无关系的规则。
 */
function actionTargets(action: InteractionAction): readonly string[] {
  if (action.type === 'closeModal') return []
  if (action.type === 'navigate' || action.type === 'navigateByValue') return []
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
export function ruleTouchesNode(
  rule: InteractionRule,
  nodeId: string,
): boolean {
  return (
    rule.source.nodeId === nodeId || actionTargets(rule.action).includes(nodeId)
  )
}

/**
 * 两档跳转之间互换时保住已挑的大屏；从别的动作换过来一律空着。
 * ⚠ 绝不拿 `fallbackTarget` 兜底——那是个**节点** id，塞进来就是一条跳去 404 的规则。
 */
function navigateFrom(current: InteractionAction): InteractionAction {
  if (current.type === 'navigate') return current
  if (current.type === 'navigateByValue') {
    return { type: 'navigate', target: current.routes[0]?.target ?? '' }
  }
  return { type: 'navigate', target: '' }
}

/**
 * 换成按值分流。
 * ⚠ 单目标换过来时把目标搬进第一条路由（值留空，由编辑面标成「永不命中」）：
 * 直接丢掉的话，用户刚挑好的目标会不声不响地没了。
 */
function navigateByValueFrom(current: InteractionAction): InteractionAction {
  if (current.type === 'navigateByValue') return current
  if (current.type === 'navigate' && current.target !== '') {
    return {
      type: 'navigateByValue',
      routes: [{ value: '', target: current.target }],
    }
  }
  return { type: 'navigateByValue', routes: [] }
}

/** 显隐三档共用一张目标表。 */
function visibilityFrom(
  type: 'show' | 'hide' | 'toggle',
  current: InteractionAction,
): InteractionAction {
  return { type, targets: 'targets' in current ? current.targets : [] }
}

/**
 * 换动作类型后的新动作：同族能沿用的沿用（显隐三档共用一张目标表，
 * 互斥切换换来换去保住已配的组，两档跳转保住已挑的大屏），其余给空。
 * @param fallbackTarget 弹窗缺省落在哪个节点上；没有节点时给空串
 */
export function actionForType(
  type: InteractionActionType,
  current: InteractionAction,
  fallbackTarget: string,
): InteractionAction {
  if (type === 'show' || type === 'hide' || type === 'toggle') {
    return visibilityFrom(type, current)
  }
  if (type === 'setActive') {
    return { type, groups: current.type === 'setActive' ? current.groups : [] }
  }
  if (type === 'openModal') {
    return {
      type,
      target: current.type === 'openModal' ? current.target : fallbackTarget,
    }
  }
  if (type === 'navigate') return navigateFrom(current)
  if (type === 'navigateByValue') return navigateByValueFrom(current)
  return { type: 'closeModal' }
}
