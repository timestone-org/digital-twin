/**
 * @fileoverview 模块运行状态：把「渲染失败 / 必绑槽没配 / 各档槽的计数」折成
 * 一个 `ModuleStatus` 的优先级阶梯，纯函数。
 * ⚠ 对来源类型**无感知**：只数各档槽有几个，不认识具体是哪种来源——
 * 认了的话，加一种来源就要改这台状态机（docs/DASHBOARD_DESIGN.md §5.5）。
 */
import type { BindingPayload, BindingSpec, ModuleStatus } from '@dt/contracts'

import type { ModuleValuesTally } from './moduleValues'

export interface ModuleStatusInput {
  /** 渲染抛错或异步加载失败。 */
  hasRenderError?: boolean
  /** 必绑槽里一条来源都没配的个数。 */
  unboundRequiredCount: number
  tally: ModuleValuesTally
}

/** 这个槽键配过来源没有：数组槽 `rows[0].value` 算配过了 `rows`。 */
function isConfigured(key: string, fieldKeys: readonly string[]): boolean {
  return fieldKeys.some(
    (fieldKey) =>
      fieldKey === key ||
      fieldKey.startsWith(`${key}[`) ||
      fieldKey.startsWith(`${key}.`),
  )
}

/**
 * 数清单里必绑却没配来源的槽。
 * @param specs 模块清单声明的绑定槽
 * @param bindings 该节点已配的绑定
 */
export function countUnboundRequired(
  specs: readonly BindingSpec[],
  bindings: readonly BindingPayload[],
): number {
  const fieldKeys = bindings.map((binding) => binding.fieldKey)
  return specs.filter(
    (spec) => spec.isRequired === true && !isConfigured(spec.key, fieldKeys),
  ).length
}

/**
 * 折成单一状态，高优先级在前：
 * 渲染失败 → 必绑没配 → 有槽取不到 → 有槽陈旧 → 有槽在等首帧 → 绑了但一个值都没有 → 正常。
 * @param input 渲染失败标记、必绑缺口与各档槽计数
 */
export function computeModuleStatus(input: ModuleStatusInput): ModuleStatus {
  const { tally } = input
  if (input.hasRenderError === true) return 'error'
  if (input.unboundRequiredCount > 0) return 'unbound'
  if (tally.error > 0) return 'error'
  // 陈旧排在等首帧之前：手里有旧值时用户该看到的是「这是旧的」，不是「正在加载」
  if (tally.stale > 0) return 'stale'
  if (tally.pending > 0) return 'loading'
  if (tally.bound > 0 && tally.ok === 0) return 'empty'
  return 'connected'
}
