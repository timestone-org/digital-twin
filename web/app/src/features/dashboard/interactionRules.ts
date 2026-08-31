/**
 * @fileoverview 从 `chromeJson.interactions` 读联动规则：JSONB 是无类型的，
 * 逐条校验形状，坏条目丢弃、好条目保留——一条脏规则不该把整屏联动拖哑。
 *
 * ⚠ 这个键名服务端也各写了一份：公开面按它把整段联动剥掉，免得跨屏跳转的
 * 目标（别的大屏的 id）随匿名载荷出门（`share_service.INTERACTIONS_CHROME_KEY`）。
 * 改名要两边一起改——漂开的表现是那边照常剥一个不存在的键，全程零报错。
 */
import type { InteractionAction, InteractionRule } from '@dt/contracts'
import { INTERACTION_EVENTS } from '@dt/contracts'

/** 规则在 chromeJson 里的键。 */
export const INTERACTIONS_CHROME_KEY = 'interactions'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseTargets(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null
  const targets = raw.filter((item): item is string => typeof item === 'string')
  return targets.length === raw.length ? targets : null
}

/** show / hide / toggle：只带一份目标表。 */
function parseVisibility(
  type: 'show' | 'hide' | 'toggle',
  raw: Record<string, unknown>,
): InteractionAction | null {
  const targets = parseTargets(raw.targets)
  return targets === null ? null : { type, targets }
}

/** setActive：逐组一个值加一份目标表；任一组坏形即整条丢弃。 */
function parseSetActive(
  raw: Record<string, unknown>,
): InteractionAction | null {
  if (!Array.isArray(raw.groups)) return null
  const groups: { value: string; targets: string[] }[] = []
  for (const item of raw.groups) {
    if (!isRecord(item) || typeof item.value !== 'string') return null
    const targets = parseTargets(item.targets)
    if (targets === null) return null
    groups.push({ value: item.value, targets })
  }
  return { type: 'setActive', groups }
}

/** openModal：目标必填，标题缺省时不写这个键。 */
function parseOpenModal(
  raw: Record<string, unknown>,
): InteractionAction | null {
  if (typeof raw.target !== 'string') return null
  return {
    type: 'openModal',
    target: raw.target,
    ...(typeof raw.title === 'string' ? { title: raw.title } : {}),
  }
}

/**
 * navigate：目标必须是字符串。
 * ⚠ 空串照常留着——那是「还没挑目标」，规则本身没坏。丢掉的话，加了一条
 * 还没挑完的规则、保存再打开它就消失了（`openModal` 的空目标同此口径）。
 */
function parseNavigate(raw: Record<string, unknown>): InteractionAction | null {
  return typeof raw.target === 'string'
    ? { type: 'navigate', target: raw.target }
    : null
}

/** navigateByValue：逐条路由要值与目标两样；坏一条整条丢。 */
function parseNavigateByValue(
  raw: Record<string, unknown>,
): InteractionAction | null {
  if (!Array.isArray(raw.routes)) return null
  const routes: { value: string; target: string }[] = []
  for (const item of raw.routes) {
    if (!isRecord(item)) return null
    if (typeof item.value !== 'string' || typeof item.target !== 'string') {
      return null
    }
    routes.push({ value: item.value, target: item.target })
  }
  return { type: 'navigateByValue', routes }
}

/**
 * 解析一个动作；形状不对给 null。
 * ⚠ 导出给助手那条路复用：另写一份校验必然与这一份漂开，而漂开的表现是
 * 助手写得进去、渲染侧读不出来，两侧都不报错。
 * @param raw 自由 JSON 里的一个动作
 */
export function parseInteractionAction(raw: unknown): InteractionAction | null {
  if (!isRecord(raw)) return null
  const type = raw.type
  if (type === 'show' || type === 'hide' || type === 'toggle') {
    return parseVisibility(type, raw)
  }
  if (type === 'setActive') return parseSetActive(raw)
  if (type === 'openModal') return parseOpenModal(raw)
  if (type === 'closeModal') return { type: 'closeModal' }
  if (type === 'navigate') return parseNavigate(raw)
  if (type === 'navigateByValue') return parseNavigateByValue(raw)
  return null
}

function parseRule(raw: unknown): InteractionRule | null {
  if (!isRecord(raw) || typeof raw.id !== 'string') return null
  const source = raw.source
  if (!isRecord(source) || typeof source.nodeId !== 'string') return null
  const event = source.event
  if (
    typeof event !== 'string' ||
    !(INTERACTION_EVENTS as readonly string[]).includes(event)
  ) {
    return null
  }
  const action = parseInteractionAction(raw.action)
  if (action === null) return null
  return {
    id: raw.id,
    source: {
      nodeId: source.nodeId,
      event: event as InteractionRule['source']['event'],
    },
    action,
  }
}

/** 解析整份规则表；不是数组或整体坏形一律给空表。 */
export function parseInteractionRules(
  chromeJson: Record<string, unknown>,
): InteractionRule[] {
  const raw = chromeJson[INTERACTIONS_CHROME_KEY]
  if (!Array.isArray(raw)) return []
  return raw
    .map(parseRule)
    .filter((rule): rule is InteractionRule => rule !== null)
}
