/**
 * @fileoverview 新建染色规则与新建档位的模板。
 *
 * ⚠ 缺省值只有 `normalizeParts` 那一份：在这里抄一遍的话，抄的那份一旦与它
 * 不一致，新建的规则会在「存一次再读回来」之后悄悄变样。
 */
import {
  DEFAULT_TINT_GRADIENT,
  type TwinPartTint,
  type TwinTintStop,
} from '@dt/twin-config'

/** 新规则里预置的两档：开关量点位最常见的一对。 */
const SEED_STOPS: readonly TwinTintStop[] = [
  {
    id: 'stop-1',
    match: 'equals',
    from: null,
    to: null,
    equals: '0',
    color: '--state-danger',
    label: '停机',
  },
  {
    id: 'stop-2',
    match: 'equals',
    from: null,
    to: null,
    equals: '1',
    color: '--state-success',
    label: '运行',
  },
]

/**
 * 一条新的染色规则。
 * ⚠ 预置两档而不是空表：开了开关却什么都没有，用户会以为开关没生效。
 */
export function newTintRule(): TwinPartTint {
  return {
    mode: 'stops',
    stops: SEED_STOPS.map((stop) => ({ ...stop })),
    gradient: { ...DEFAULT_TINT_GRADIENT },
    fallback: '',
  }
}

/**
 * 一档新的取色，id 在同一条规则里不重名。
 * ⚠ 重名的两档在 `v-for` 的 key 上会撞，表现是「改这一档，另一档跟着变」。
 * @param stops 这条规则现有的档位
 */
export function blankTintStop(stops: readonly TwinTintStop[]): TwinTintStop {
  const taken = new Set(stops.map((stop) => stop.id))
  let serial = stops.length + 1
  while (taken.has(`stop-${serial}`)) serial += 1
  return {
    id: `stop-${serial}`,
    match: 'range',
    from: null,
    to: null,
    equals: '',
    color: '',
    label: '',
  }
}
