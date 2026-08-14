/**
 * @fileoverview 从 `chromeJson.interactions` 读联动规则：JSONB 是无类型的，
 * 逐条校验形状，坏条目丢弃、好条目保留——一条脏规则不该把整屏联动拖哑。
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

function parseAction(raw: unknown): InteractionAction | null {
  if (!isRecord(raw)) return null
  const type = raw.type
  if (type === 'show' || type === 'hide' || type === 'toggle') {
    return parseVisibility(type, raw)
  }
  if (type === 'setActive') return parseSetActive(raw)
  if (type === 'openModal') return parseOpenModal(raw)
  if (type === 'closeModal') return { type: 'closeModal' }
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
  const action = parseAction(raw.action)
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
