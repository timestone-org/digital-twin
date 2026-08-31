/**
 * @fileoverview 联动那一半的客户端工具：读整份规则表、写一条、删一条，外加改
 * 节点的初始显隐——弹窗与显隐类规则要的正是后面那半。
 *
 * ⚠ 规则住在**元数据轴**（大屏级 `chromeJson.interactions`），那条轴没有撤销栈：
 * 节点树上的每一笔用户按一次 Ctrl+Z 都退得回来，这一批退不回来。所以删一条时
 * 把整条原样交还，用户反悔时照着再写一次就是撤销。
 *
 * ⚠ 校验从严。规则是一只自由 JSON：源节点根本不发那个事件、目标节点已经被删、
 * 跳转目标填成画布节点 id——三样都存得下去、都不报错，画面上一律表现成
 * 「点了没反应」。模型看不见右栏，它只有回执，所以每一类都要翻成一句能读的错。
 */
import type {
  AssistantToolCall,
  DashboardNodePayload,
  InteractionAction,
  InteractionEventName,
  InteractionRule,
} from '@dt/contracts'
import { INTERACTION_EVENTS } from '@dt/contracts'

import { newClientUuid } from '@/api/idempotency'
import { parseInteractionAction } from '@/features/dashboard/interactionRules'
import { nodeLabelOf } from '@/features/dashboard/nodeLabel'
import type { SurfaceSnapshot } from '@/features/ai/surfaces'
import {
  isEventName,
  isInteractiveSource,
  ruleSummary,
  supportedEventsOf,
} from './interactionOptions'
import type { MetaSurfaceDeps } from './aiSurfaceTypes'

/** 这一半实现了哪些工具。⚠ 与技能清单里声明的名字逐字相同。 */
export const INTERACTION_TOOLS = [
  'dashboard.read_interactions',
  'dashboard.write_interaction',
  'dashboard.remove_interaction',
  'dashboard.set_visible',
] as const

/** 每条写回执都要带的那一句：这条轴退不回来。 */
const NO_UNDO = '联动规则不在撤销栈上，用户按 Ctrl+Z 退不回这一步；改完说给他听'

/** 跑一个联动工具；认不出名字给 null，由调用方接着往下问。 */
export function runInteraction(
  deps: MetaSurfaceDeps,
  call: AssistantToolCall,
): SurfaceSnapshot | null {
  if (call.name === 'dashboard.read_interactions') return readRules(deps)
  if (call.name === 'dashboard.write_interaction') return writeRule(deps, call)
  if (call.name === 'dashboard.remove_interaction') return dropRule(deps, call)
  if (call.name === 'dashboard.set_visible') return setVisible(deps, call)
  return null
}

/**
 * 整份规则表，外加「谁能当触发源、各自发得出什么事件」。
 * ⚠ 能当源的那一份必须给：`hostClickable` 与 `emitsInteractions` 两个标记都不在
 * 服务端的模块目录里，模型只凭模块名猜不出一块纯装饰的图片配了规则也不会触发。
 */
function readRules(deps: MetaSurfaceDeps): SurfaceSnapshot {
  const labelOf = labelReader(deps)
  return {
    rules: deps.chrome.rules.value.map((rule) => ({
      rule_id: rule.id,
      source_node_id: rule.source.nodeId,
      event: rule.source.event,
      action: rule.action,
      summary: ruleSummary(rule, labelOf),
      problems: problemsOf(deps, rule),
    })),
    sources: deps.editor.nodes.value
      .filter((node) => isInteractiveSource(node, deps.getManifest))
      .map((node) => ({
        node_id: node.id,
        label: nodeLabelOf(node, deps.getManifest),
        module_type: node.moduleType,
        events: [...supportedEventsOf(deps.getManifest(node.moduleType))],
      })),
    note:
      '`sources` 之外的画布节点当触发源配了也永远不触发，它们只能当目标。' +
      '`problems` 非空的那几条现在就是哑的，先修它再加新的。',
  }
}

/**
 * 新增或改一条规则：给了 `rule_id` 就改那一条，不给就新建。
 * ⚠ 先选中源节点——右栏的联动页按选中项过滤，用户得看见助手在动哪一条。
 */
function writeRule(
  deps: MetaSurfaceDeps,
  call: AssistantToolCall,
): SurfaceSnapshot {
  const rules = deps.chrome.rules.value
  const ruleId = optionalText(call, 'rule_id')
  const at = ruleId === null ? -1 : rules.findIndex((one) => one.id === ruleId)
  if (ruleId !== null && at < 0) {
    throw new Error(`没有 ${ruleId} 这条联动规则，先读一次规则表`)
  }
  const source = nodeOf(deps, textArg(call, 'source_node_id'))
  const event = eventOf(deps, call, source)
  const action = actionOf(deps, call)
  const rule: InteractionRule = {
    id: ruleId ?? newClientUuid(),
    source: { nodeId: source.id, event },
    action,
  }
  deps.editor.select(source.id)
  deps.editor.flush()
  deps.chrome.setInteractions(
    at < 0 ? [...rules, rule] : rules.map((one, i) => (i === at ? rule : one)),
  )
  return {
    ok: true,
    rule_id: rule.id,
    is_new: at < 0,
    summary: ruleSummary(rule, labelReader(deps)),
    warnings: warningsOf(deps, action),
    note: NO_UNDO,
  }
}

/** 删一条规则。⚠ 整条原样交还：这条轴没有撤销栈，交还的这份就是回退的依据。 */
function dropRule(
  deps: MetaSurfaceDeps,
  call: AssistantToolCall,
): SurfaceSnapshot {
  const rules = deps.chrome.rules.value
  const ruleId = textArg(call, 'rule_id')
  const found = rules.find((one) => one.id === ruleId)
  if (found === undefined) {
    throw new Error(`没有 ${ruleId} 这条联动规则，先读一次规则表`)
  }
  deps.chrome.setInteractions(rules.filter((one) => one.id !== ruleId))
  return {
    ok: true,
    removed: {
      rule_id: found.id,
      source_node_id: found.source.nodeId,
      event: found.source.event,
      action: found.action,
    },
    note: `${NO_UNDO}；用户反悔就照 removed 原样再写一次`,
  }
}

/** 改一个画布节点保存下来的初始显隐。 */
function setVisible(
  deps: MetaSurfaceDeps,
  call: AssistantToolCall,
): SurfaceSnapshot {
  const node = nodeOf(deps, textArg(call, 'node_id'))
  const isVisible = boolArg(call, 'is_visible')
  deps.editor.select(node.id)
  deps.editor.flush()
  deps.actions.toggleVisible(node.id, isVisible)
  return {
    ok: true,
    node_id: node.id,
    is_visible: isVisible,
    // 显隐走的是节点树那条轴，与规则不同——这一步撤得回来，别把两者说成一样
    note: '这一步在撤销栈上；联动只改运行时显隐，落库的初始值仍是这一格',
  }
}

/** 一条存量规则此刻哪里是哑的；空表 = 这条能触发。 */
function problemsOf(
  deps: MetaSurfaceDeps,
  rule: InteractionRule,
): readonly string[] {
  const found: string[] = []
  const source = deps.editor.nodes.value.find(
    (one) => one.id === rule.source.nodeId,
  )
  if (source === undefined) return ['源节点已被删，这条规则永远不触发']
  if (!isInteractiveSource(source, deps.getManifest)) {
    found.push('源模块既不整块可点也不上抛交互事件，这条规则永远不触发')
  } else if (
    !supportedEventsOf(deps.getManifest(source.moduleType)).includes(
      rule.source.event,
    )
  ) {
    found.push(`源模块发不出「${rule.source.event}」事件`)
  }
  const missing = missingTargets(deps, rule.action)
  if (missing.length > 0) found.push(`目标节点已被删：${missing.join('、')}`)
  return found
}

/** 动作点名了、但画布上已经没有的那几个节点。 */
function missingTargets(
  deps: MetaSurfaceDeps,
  action: InteractionAction,
): readonly string[] {
  const known = new Set(deps.editor.nodes.value.map((one) => one.id))
  return nodeTargetsOf(action).filter((id) => !known.has(id))
}

/**
 * 这个动作点名了哪些**画布节点**。
 * ⚠ 两档跳转的 target 是**大屏**不是节点，一律不算进来——按节点校验它，
 * 每一条跨屏跳转都会被判成「目标已被删」。
 */
function nodeTargetsOf(action: InteractionAction): readonly string[] {
  if (action.type === 'openModal') return [action.target]
  if (action.type === 'setActive') {
    return action.groups.flatMap((group) => group.targets)
  }
  if (
    action.type === 'show' ||
    action.type === 'hide' ||
    action.type === 'toggle'
  ) {
    return action.targets
  }
  return []
}

/** 落不成错、但多半不是用户要的那几件事。 */
function warningsOf(
  deps: MetaSurfaceDeps,
  action: InteractionAction,
): readonly string[] {
  if (action.type !== 'openModal') return []
  const target = deps.editor.nodes.value.find((one) => one.id === action.target)
  // 弹窗内容的真源是画布上那个节点，它同时还留在屏上的话，两处各画一份
  if (target === undefined || target.isVisible === false) return []
  return [
    `弹窗内容节点「${nodeLabelOf(target, deps.getManifest)}」此刻在屏上可见，` +
      '弹窗与画布会各画一份；用 dashboard.set_visible 把它设成初始隐藏',
  ]
}

/** 认领事件名：源模块发不出的一律拒收，配了也永远不触发。 */
function eventOf(
  deps: MetaSurfaceDeps,
  call: AssistantToolCall,
  source: DashboardNodePayload,
): InteractionEventName {
  const raw = textArg(call, 'event')
  if (!isEventName(raw)) {
    throw new Error(
      `没有 ${raw} 这个事件，只有 ${INTERACTION_EVENTS.join('、')}`,
    )
  }
  if (!isInteractiveSource(source, deps.getManifest)) {
    throw new Error(
      `${nodeLabelOf(source, deps.getManifest)} 不会上抛交互事件，` +
        '它只能当目标；能当触发源的那几个见 dashboard.read_interactions',
    )
  }
  const supported = supportedEventsOf(deps.getManifest(source.moduleType))
  if (!supported.includes(raw)) {
    throw new Error(
      `${nodeLabelOf(source, deps.getManifest)} 发不出「${raw}」，` +
        `它只发 ${supported.join('、')}；配了永远不触发`,
    )
  }
  return raw
}

/** 认领动作：形状先过渲染侧那份解析器，再逐档查它点名的东西在不在。 */
function actionOf(
  deps: MetaSurfaceDeps,
  call: AssistantToolCall,
): InteractionAction {
  const parsed = parseInteractionAction(call.arguments.action)
  if (parsed === null) {
    throw new Error(
      'action 的形状不对：show/hide/toggle 要 targets 数组、' +
        'setActive 要 groups、openModal 与 navigate 要 target、' +
        'navigateByValue 要 routes、closeModal 只要 type',
    )
  }
  checkAction(deps, parsed)
  return parsed
}

/** 逐档校验。`closeModal` 不指名任何东西，没什么可查。 */
function checkAction(deps: MetaSurfaceDeps, action: InteractionAction): void {
  if (action.type === 'closeModal') return
  if (action.type === 'openModal') {
    checkNodes(deps, [action.target])
    return
  }
  if (action.type === 'setActive') {
    checkValues(
      action.groups.map((group) => group.value),
      '互斥切换组',
    )
    checkNodes(
      deps,
      action.groups.flatMap((group) => group.targets),
    )
    return
  }
  if (action.type === 'navigate') {
    checkHandle(deps, action.target)
    return
  }
  if (action.type === 'navigateByValue') {
    checkValues(
      action.routes.map((route) => route.value),
      '按值跳转路由',
    )
    for (const route of action.routes) checkHandle(deps, route.target)
    return
  }
  if (action.targets.length === 0) {
    throw new Error('显隐类动作的 targets 不能为空，那条规则点了什么也不会发生')
  }
  checkNodes(deps, action.targets)
}

/** 目标节点必须在这一屏上。 */
function checkNodes(deps: MetaSurfaceDeps, targets: readonly string[]): void {
  const known = new Set(deps.editor.nodes.value.map((one) => one.id))
  const missing = targets.filter((id) => !known.has(id))
  if (missing.length > 0) {
    throw new Error(`画布上没有这些节点：${missing.join('、')}`)
  }
}

/**
 * 按值分派的那两档：值不能空，也不能重。
 * ⚠ 空值那条**永远不命中**——运行期把不带值的事件一律挡掉了，正是为了防止
 * 整块可点的模块随手一点就换屏。重复值只有第一条生效，后面那条是死配置。
 */
function checkValues(values: readonly string[], what: string): void {
  if (values.length === 0) throw new Error(`${what}一条都没有，配了不会有效果`)
  if (values.some((value) => value === '')) {
    throw new Error(
      `${what}的值不能留空：不带值的事件一律不派发，留空即永不命中`,
    )
  }
  const seen = new Set<string>()
  const repeated = new Set<string>()
  for (const value of values) {
    if (seen.has(value)) repeated.add(value)
    seen.add(value)
  }
  if (repeated.size > 0) {
    throw new Error(
      `${what}的值重复了：${[...repeated].join('、')}；` +
        '同一个值只有第一条生效',
    )
  }
}

/**
 * 跳转目标是**大屏句柄**，不是画布节点。
 * ⚠ 单拎出来拦一次：填成节点 id 是这一档最常见的错，而它存得下去、也不报错，
 * 点下去只会跳到一张不存在的大屏。目标 id 从 `dashboards.list` 取。
 */
function checkHandle(deps: MetaSurfaceDeps, handle: string): void {
  if (handle === '') {
    throw new Error('跳转目标不能留空，先用 dashboards.list 挑一张大屏')
  }
  if (deps.editor.nodes.value.some((one) => one.id === handle)) {
    throw new Error(
      `${handle} 是这一屏上的画布节点，不是大屏 id；` +
        '跳转目标要的是另一张大屏，用 dashboards.list 取',
    )
  }
}

/** 规则摘要里的显示名；节点已删时回落 id，否则那条悬空规则没法辨认。 */
function labelReader(deps: MetaSurfaceDeps): (nodeId: string) => string {
  return (nodeId) => {
    const node = deps.editor.nodes.value.find((one) => one.id === nodeId)
    return node === undefined ? nodeId : nodeLabelOf(node, deps.getManifest)
  }
}

function nodeOf(deps: MetaSurfaceDeps, nodeId: string): DashboardNodePayload {
  const node = deps.editor.nodes.value.find((one) => one.id === nodeId)
  if (node === undefined) throw new Error(`画布上没有 ${nodeId} 这个节点`)
  return node
}

function boolArg(call: AssistantToolCall, name: string): boolean {
  const given = call.arguments[name]
  if (typeof given !== 'boolean') {
    throw new Error(`${call.name} 的 ${name} 必须是真假值`)
  }
  return given
}

function textArg(call: AssistantToolCall, name: string): string {
  const given = call.arguments[name]
  if (typeof given !== 'string' || given === '') {
    throw new Error(`${call.name} 少了参数 ${name}`)
  }
  return given
}

function optionalText(call: AssistantToolCall, name: string): string | null {
  const given = call.arguments[name]
  return typeof given === 'string' && given !== '' ? given : null
}
