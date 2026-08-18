/**
 * @fileoverview 采集运行态的文案与色档。
 *
 * ⚠ 「配置说它该采」（`is_enabled`）与「它此刻真在采」（`runtime.state`）是两
 * 件事，这里只翻译后者。把两者合成一个状态灯，是现场最常见的一种误判：
 * 停用的源看起来「离线」，而启用但连不上的源看起来「正常」。
 */
import type { CollectSourceRuntime, DtIntent } from '@dt/contracts'

export interface StateLook {
  label: string
  intent: DtIntent
}

const LOOKS: Record<string, StateLook> = {
  online: { label: '采集中', intent: 'success' },
  connecting: { label: '连接中', intent: 'warning' },
  offline: { label: '已断开', intent: 'danger' },
  // ⚠ 与 offline 分开：这一档是「采集器压根没接手过它」，多半是 collector
  // 没起来；显示成「已断开」会把人指去查现场，而现场根本没问题
  unknown: { label: '未接管', intent: 'neutral' },
}

const FALLBACK: StateLook = { label: '未知', intent: 'neutral' }

/**
 * 一个运行态的长相。
 * @param state 后端给的状态字面量
 */
export function stateLook(state: string): StateLook {
  return LOOKS[state] ?? FALLBACK
}

const CATEGORY_LABELS: Record<string, string> = {
  transient: '网络抖动',
  config: '配置有误',
  auth: '认证被拒',
}

/**
 * 把运行态里的报错写成一句能给人看的话；没有错就返回 null。
 *
 * ⚠ `error_detail` 是异常类型名不是原文，直接摆出来没人看得懂，所以前面必须
 * 带上归类——归类才决定去查什么（网络 / 配置 / 凭据）。
 * @param runtime 采集运行态
 */
export function errorSummary(runtime: CollectSourceRuntime): string | null {
  const { error_category: category, error_detail: detail } = runtime
  if (category === null && detail === null) return null
  const label = category === null ? '采集异常' : CATEGORY_LABELS[category]
  return detail === null ? (label ?? '采集异常') : `${label}（${detail}）`
}

/**
 * 配置的点位数与采集侧真挂上的点位数对不上时的提示；对得上返回 null。
 *
 * ⚠ 这个差额是「配了但没订上」的那些点位，它不会引发任何报错——不显式说出来
 * 就只能靠一个个点位去发现哪些永远没有值。
 * @param configured 配置了多少个
 * @param runtime 采集运行态
 */
export function missingPoints(
  configured: number,
  runtime: CollectSourceRuntime,
): number | null {
  if (runtime.state !== 'online') return null
  const gap = configured - runtime.point_count
  return gap > 0 ? gap : null
}
