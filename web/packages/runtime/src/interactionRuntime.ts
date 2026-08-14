/**
 * @fileoverview 节点联动的运行时引擎：显隐/互斥切换/节点弹窗。
 *
 * 铁律：运行时态与持久态严格分离——
 * 持久初始显隐是 `isVisible`（入库），联动产生的显隐是易失覆盖态（永不入库），
 * 最终可见性 = 覆盖态 ?? 持久态；弹窗同属易失态，换大屏或重新 init 即关闭。
 *
 * 宿主页面创建实例并 provide；渲染层 inject 后把控件的 `interaction` 事件转发
 * `dispatch`。没有 provider（编辑器画布、独立渲染）就是静默 no-op。
 */
import { reactive, shallowRef, type InjectionKey, type ShallowRef } from 'vue'
import type {
  InteractionAction,
  InteractionEvent,
  InteractionEventName,
  InteractionRule,
  InteractionSetActiveAction,
  InteractionShowAction,
} from '@dt/contracts'

/** 参与联动的一个节点：id 与它的持久初始显隐。 */
export interface InteractionNode {
  nodeId: string
  isVisible: boolean
}

/** 进场时要重放的初始选中（分段切换的当前值），让互斥组一开屏就成立。 */
export interface InitialSelection {
  nodeId: string
  value: string
}

/** 当前浮起的节点弹窗。 */
export interface ActiveModal {
  /** 弹窗内容根节点 id，连同整棵子树一起渲染。 */
  nodeId: string
  /** 空串 = 不渲染标题栏。 */
  title: string
}

export interface InteractionRuntime {
  /** 重新装载规则与节点；易失显隐态与弹窗一并清零。 */
  init(
    rules: readonly InteractionRule[],
    nodes: readonly InteractionNode[],
    initialSelections?: readonly InitialSelection[],
  ): void
  /** 控件上抛事件 → 命中规则 → 改运行时显隐 / 开关弹窗。 */
  dispatch(sourceNodeId: string, event: InteractionEvent): void
  /** 节点当前可见性：易失覆盖优先，回退持久初始态；不认识的节点算可见。 */
  isVisible(nodeId: string): boolean
  /** 当前浮起的弹窗；null = 无。 */
  readonly activeModal: ShallowRef<ActiveModal | null>
  /** 关闭当前弹窗，幂等。 */
  closeModal(): void
  /**
   * 该节点是否真配了以它为 source 的规则（可按事件名过滤）。
   * 渲染层据此推导 `meta.interactive`——配了规则才摆出可点击外观，
   * 避免「模块可点但没配规则 → 点了没反应」。
   */
  hasRules(sourceNodeId: string, event?: InteractionEventName): boolean
}

export const INTERACTION_KEY: InjectionKey<InteractionRuntime> =
  Symbol('dt-interaction')

/**
 * 丢弃 setActive 规则里 value 已不在源控件选项集内的陈旧组。
 * ⚠ 不清的话：分段切换删掉某选项后，互斥语义会拿「当前值 ≠ 陈旧组值」
 * 把那组目标错误隐藏。保存前与运行时 init 前各 reconcile 一次。
 * @param itemsOf 源节点当前的选项键；不是分段切换或找不到时给 null（规则不动）
 */
export function reconcileSetActiveGroups(
  rules: readonly InteractionRule[],
  itemsOf: (sourceNodeId: string) => readonly string[] | null,
): InteractionRule[] {
  return rules.map((rule) => {
    if (rule.action.type !== 'setActive') return rule
    const keys = itemsOf(rule.source.nodeId)
    if (keys === null) return rule
    const valid = new Set(keys)
    return {
      ...rule,
      action: {
        type: 'setActive',
        groups: rule.action.groups.filter((group) => valid.has(group.value)),
      },
    }
  })
}

/** 一个联动实例的全部状态。 */
interface RuntimeState {
  /** 易失显隐覆盖：nodeId → 布尔；缺席回退持久态。 */
  overrides: Record<string, boolean>
  /** 规则表响应式：hasRules 在渲染期被读，init 换表后可点击外观要跟着重算。 */
  rules: ShallowRef<readonly InteractionRule[]>
  activeModal: ShallowRef<ActiveModal | null>
  nodes: readonly InteractionNode[]
}

function persistedVisible(state: RuntimeState, nodeId: string): boolean {
  return state.nodes.find((node) => node.nodeId === nodeId)?.isVisible ?? true
}

function currentVisible(state: RuntimeState, nodeId: string): boolean {
  return state.overrides[nodeId] ?? persistedVisible(state, nodeId)
}

function knows(state: RuntimeState, nodeId: string): boolean {
  return state.nodes.some((node) => node.nodeId === nodeId)
}

/**
 * 事件携带值收成互斥比对用的键。
 * ⚠ 只有原始值有意义（选项键就是字符串）：空值与对象一律收成空串，
 * 比不中任何配了值的组，也就是整组隐藏。
 */
function selectedKey(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  return ''
}

/** 互斥切换：命中组的目标显示，其余组的目标隐藏。 */
function applySetActive(
  state: RuntimeState,
  action: InteractionSetActiveAction,
  event: InteractionEvent,
): void {
  const selected = selectedKey(event.value)
  for (const group of action.groups) {
    for (const target of group.targets) {
      if (knows(state, target)) {
        state.overrides[target] = group.value === selected
      }
    }
  }
}

/** show / hide / toggle：逐个目标改易失显隐。 */
function applyVisibility(
  state: RuntimeState,
  action: InteractionShowAction,
): void {
  for (const target of action.targets) {
    if (!knows(state, target)) continue
    if (action.type === 'show') state.overrides[target] = true
    else if (action.type === 'hide') state.overrides[target] = false
    else state.overrides[target] = !currentVisible(state, target)
  }
}

function applyAction(
  state: RuntimeState,
  action: InteractionAction,
  event: InteractionEvent,
): void {
  if (action.type === 'openModal') {
    // 目标已删或规则脏了就不开：一个空白浮层比「点了没反应」更糟
    if (knows(state, action.target)) {
      state.activeModal.value = {
        nodeId: action.target,
        title: action.title ?? '',
      }
    }
    return
  }
  if (action.type === 'closeModal') {
    state.activeModal.value = null
    return
  }
  if (action.type === 'setActive') {
    applySetActive(state, action, event)
    return
  }
  applyVisibility(state, action)
}

/** 进场重放：只重放 select 事件上的互斥组，让分段切换一开屏就成立。 */
function applyInitialSelections(
  state: RuntimeState,
  initialSelections: readonly InitialSelection[],
): void {
  for (const selection of initialSelections) {
    for (const rule of state.rules.value) {
      if (rule.source.event !== 'select') continue
      if (rule.action.type !== 'setActive') continue
      if (rule.source.nodeId !== selection.nodeId) continue
      applyAction(state, rule.action, {
        event: 'select',
        value: selection.value,
      })
    }
  }
}

function initIn(
  state: RuntimeState,
  nextRules: readonly InteractionRule[],
  nextNodes: readonly InteractionNode[],
  initialSelections: readonly InitialSelection[],
): void {
  state.rules.value = nextRules
  state.nodes = nextNodes
  // 清键但保留对象引用，维持既有的响应式订阅
  for (const key of Object.keys(state.overrides)) delete state.overrides[key]
  state.activeModal.value = null
  applyInitialSelections(state, initialSelections)
}

function dispatchIn(
  state: RuntimeState,
  sourceNodeId: string,
  event: InteractionEvent,
): void {
  for (const rule of state.rules.value) {
    if (rule.source.event !== event.event) continue
    if (rule.source.nodeId !== sourceNodeId) continue
    applyAction(state, rule.action, event)
  }
}

function hasRulesIn(
  state: RuntimeState,
  sourceNodeId: string,
  event?: InteractionEventName,
): boolean {
  return state.rules.value.some(
    (rule) =>
      (event === undefined || rule.source.event === event) &&
      rule.source.nodeId === sourceNodeId,
  )
}

/** 创建一个联动运行时实例；覆盖态与弹窗态只存内存。 */
export function createInteractionRuntime(): InteractionRuntime {
  const state: RuntimeState = {
    overrides: reactive<Record<string, boolean>>({}),
    rules: shallowRef<readonly InteractionRule[]>([]),
    activeModal: shallowRef<ActiveModal | null>(null),
    nodes: [],
  }

  return {
    init: (rules, nodes, initialSelections = []) => {
      initIn(state, rules, nodes, initialSelections)
    },
    dispatch: (sourceNodeId, event) => {
      dispatchIn(state, sourceNodeId, event)
    },
    isVisible: (nodeId) => currentVisible(state, nodeId),
    activeModal: state.activeModal,
    closeModal: () => {
      state.activeModal.value = null
    },
    hasRules: (sourceNodeId, event) => hasRulesIn(state, sourceNodeId, event),
  }
}
