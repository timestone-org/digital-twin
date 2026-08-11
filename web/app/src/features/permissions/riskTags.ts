/**
 * @fileoverview 权限档位的风险标。勾选器与只读清单共用这一张表——
 * 两份表必然漂移，抽一次比对两遍便宜。
 */

import type { DtIntent, PermissionKind } from '@dt/contracts'

export interface RiskTag {
  label: string
  intent: DtIntent
}

/** 只标风险档；view / manage 不打标，免得整页都是标签反而看不出重点。 */
const RISK_TAGS: Record<PermissionKind, RiskTag | null> = {
  view: null,
  manage: null,
  operate: { label: '操作', intent: 'warning' },
  admin: { label: '高危', intent: 'danger' },
}

/** 这一档要不要打风险标。 */
export function hasRisk(kind: PermissionKind): boolean {
  return RISK_TAGS[kind] !== null
}

/** 风险标的取值。调用前先用 `hasRisk` 判，免得返回类型带上 null。 */
export function riskTag(kind: PermissionKind): RiskTag {
  return RISK_TAGS[kind] ?? { label: '', intent: 'neutral' }
}
