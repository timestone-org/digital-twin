/**
 * @fileoverview 模块运行状态：把「渲染失败 / 必绑槽没配 / 各档槽的计数 /
 * 实时通道连接态」折成一个 `ModuleStatus` 的优先级阶梯，纯函数。
 * ⚠ 对来源类型**无感知**：只数各档槽有几个，不认识具体是哪种来源——
 * 认了的话，加一种来源就要改这台状态机（docs/DASHBOARD_DESIGN.md §5.5）。
 */
import type {
  BindingSpec,
  BindingView,
  ModuleConnectionState,
  ModuleStatus,
} from '@dt/contracts'

import type { ModuleValuesTally } from './moduleValues'

export interface ModuleStatusInput {
  /** 渲染抛错或异步加载失败。 */
  hasRenderError?: boolean
  /** 必绑槽里一条来源都没配的个数。 */
  unboundRequiredCount: number
  tally: ModuleValuesTally
  /**
   * 实时通道此刻的连接态；设计态与独立渲染时缺席。
   * ⚠ 缺席不等于断开：没有通道的地方（编辑器画布、独立挂载）永不降 `stale`，
   * 否则编辑器里每一格都会挂上一枚说不通的角标。
   */
  connectionState?: ModuleConnectionState
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
  bindings: readonly BindingView[],
): number {
  const fieldKeys = bindings.map((binding) => binding.fieldKey)
  return specs.filter(
    (spec) => spec.isRequired === true && !isConfigured(spec.key, fieldKeys),
  ).length
}

/** 通道不通：只有 `open` 算通，握手期与重连期屏上挂的都是最后已知值。 */
function isChannelDown(state: ModuleConnectionState | undefined): boolean {
  return state !== undefined && state !== 'open'
}

/**
 * 折成单一状态，高优先级在前：
 * 渲染失败 → 必绑没配 → 有槽取不到 → 有槽在等首帧 → 绑了但一个值都没有 →
 * 通道断了但屏上还挂着推来的值 → 正常。
 * ⚠ `stale` 排在最后一档不是随手排的：没配来源、取不到、还没首帧都是**这一格
 * 自己**的硬问题，说它们比说「可能过期」有用；而一个值都没有时该盖整格说加载／
 * 空态，只标一句「可能过期」等于把空格说成有数据。
 * @param input 渲染失败标记、必绑缺口、各档槽计数与通道连接态
 */
export function computeModuleStatus(input: ModuleStatusInput): ModuleStatus {
  const { tally } = input
  if (input.hasRenderError === true) return 'error'
  if (input.unboundRequiredCount > 0) return 'unbound'
  if (tally.error > 0) return 'error'
  if (tally.pending > 0) return 'loading'
  if (tally.bound > 0 && tally.ok === 0) return 'empty'
  if (tally.sampled > 0 && isChannelDown(input.connectionState)) return 'stale'
  return 'connected'
}

/**
 * 这一格要不要盖整格状态浮层。
 *
 * ⚠ 读的是清单上的自述，不是模块类型：按类型分支的话，第三方的多点位模块
 * 永远得不到这条待遇，而且既不报错也不失败（DASHBOARD_DESIGN §5.3 陷阱 ③）。
 * ⚠ `unbound` 那一档照盖：必绑槽一条来源都没配时，模块连布局都摆不出来，
 * 让它自己画等于画一片空白。
 * ⚠ `stale` 那一档也照放行，但它**不盖整格**（浮层自己画成右上角一枚角标）：
 * 通道断了是整条链路的事，不是某一格的事，逐格交代的模块自己也说不出来。
 * @param ownsStatusDisplay 模块自报「逐格状态我自己交代」
 * @param status 折出来的整块状态
 */
export function showsStatusOverlay(
  ownsStatusDisplay: boolean,
  status: ModuleStatus,
): boolean {
  return !ownsStatusDisplay || status === 'unbound' || status === 'stale'
}
