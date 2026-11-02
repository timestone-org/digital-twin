/** @fileoverview 校验上下文 SSE 载荷，拒绝不完整或不合法的使用率。 */
import type { AssistantContextUsage } from '@dt/contracts'

const TOKEN_COUNT = new Intl.NumberFormat('zh-CN')

/** 生成使用率、压缩状态和辅助说明。
 * @param usage 当前模型上下文
 */
export function contextUsageText(usage: AssistantContextUsage | null): {
  label: string
  status: string
  detail: string
} {
  if (usage === null) {
    return {
      label: '上下文 —',
      status: '发送消息后更新',
      detail: '尚未获取当前模型的上下文用量',
    }
  }
  const status = compressionStatus(usage)
  const label = `${usage.is_estimated ? '上下文约' : '上下文'} ${Math.round(usage.percent)}%`
  const prefix = usage.is_estimated ? '估算上下文' : '模型报告用量'
  const counts = `${TOKEN_COUNT.format(usage.used_tokens)} / ${TOKEN_COUNT.format(usage.max_tokens)}`
  return { label, status, detail: `${prefix} ${counts} tokens；${status}` }
}

/** 生成压缩状态说明。
 * @param usage 当前模型上下文
 */
function compressionStatus(usage: AssistantContextUsage): string {
  if (usage.state === 'compressing') return '正在自动压缩…'
  if (usage.compression_count > 0)
    return `已自动压缩 ${usage.compression_count} 次`
  return '接近上限时自动压缩'
}

/** 读取一份完整的模型输入预算。
 * @param data SSE 载荷
 */
export function readContextUsage(
  data: Record<string, unknown>,
): AssistantContextUsage | null {
  const {
    used_tokens,
    max_tokens,
    percent,
    is_estimated,
    state,
    compression_count,
  } = data
  if (
    !isCount(used_tokens) ||
    !isCount(max_tokens) ||
    max_tokens === 0 ||
    !isPercent(percent) ||
    typeof is_estimated !== 'boolean' ||
    !isState(state) ||
    !isCount(compression_count)
  )
    return null
  return {
    used_tokens,
    max_tokens,
    percent,
    is_estimated,
    state,
    compression_count,
  }
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

/** 校验有限的百分比。
 * @param value 待验证值
 */
function isPercent(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 100
  )
}

function isState(value: unknown): value is AssistantContextUsage['state'] {
  return value === 'ready' || value === 'compressing' || value === 'compressed'
}
