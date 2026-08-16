/**
 * @fileoverview 数据源表单的选项常量与 options_json 的拆合。
 *
 * ⚠ 安全模式/安全策略存进 `options_json`（`security_mode` / `security_policy`
 * 两个键）：驱动按自身能力消费，暂不支持的取值只存不生效。表单接管这两个键，
 * 其余键留给通用的键值编辑器——拆合必须走这里，两处各拆一份就会互相覆盖。
 */
import type { DtSelectOption } from '@dt/contracts'

export const READ_MODES: readonly DtSelectOption[] = [
  { value: 'subscribe', label: '订阅（推荐）' },
  { value: 'poll', label: '轮询' },
]

/** 与 OPC UA 规范对齐的安全选项；取值原样进 options_json。 */
export const SECURITY_MODES: readonly DtSelectOption[] = [
  'None',
  'Sign',
  'SignAndEncrypt',
].map((value) => ({ value, label: value }))

export const SECURITY_POLICIES: readonly DtSelectOption[] = [
  'None',
  'Basic128Rsa15',
  'Basic256',
  'Basic256Sha256',
  'Aes128_Sha256_RsaOaep',
  'Aes256_Sha256_RsaPss',
].map((value) => ({ value, label: value }))

/** options_json 里被表单接管的两个键。 */
const MANAGED_OPTION_KEYS = ['security_mode', 'security_policy'] as const

export interface SplitOptions {
  mode: string
  policy: string
  rest: Record<string, string>
}

/**
 * 把 options_json 拆成「安全两键 + 其余」。
 * @param all 库里的完整 options_json
 */
export function splitOptions(all: Record<string, string>): SplitOptions {
  const rest: Record<string, string> = {}
  for (const [key, value] of Object.entries(all)) {
    if (!MANAGED_OPTION_KEYS.some((managed) => managed === key)) {
      rest[key] = value
    }
  }
  return {
    mode: all['security_mode'] ?? 'None',
    policy: all['security_policy'] ?? 'None',
    rest,
  }
}

/**
 * 合并回完整的 options_json。
 * @param rest 其余键值
 * @param mode 安全模式
 * @param policy 安全策略
 */
export function mergeOptions(
  rest: Record<string, string>,
  mode: string,
  policy: string,
): Record<string, string> {
  return { ...rest, security_mode: mode, security_policy: policy }
}
