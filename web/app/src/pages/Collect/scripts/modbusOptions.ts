/**
 * @fileoverview Modbus TCP 连接参数的提交前校验，与采集侧 modbus_tcp/driver.py 的
 * `KNOWN_OPTIONS` 与取值范围同口径。不在这里拦，写错的键要等采集进程接手时才以
 * 「配置有误」离线，离表单已经很远了。
 */

/** 整数参数与它的允许范围（含两端）。 */
const INTEGER_OPTIONS: Readonly<Record<string, readonly [number, number]>> = {
  device_id: [0, 247],
  max_registers_per_request: [1, 125],
  max_bits_per_request: [1, 2000],
  max_requests_per_cycle: [1, 8],
}
const ORDER_OPTIONS = new Set(['byte_order', 'word_order'])

/** 表单提示里列出的可配参数名。 */
export const MODBUS_OPTION_KEYS: readonly string[] = [
  ...Object.keys(INTEGER_OPTIONS),
  ...ORDER_OPTIONS,
]

/** 一个参数的不合规原因；合规给 null。@param key 参数名 @param value 取值 */
function optionProblem(key: string, value: string): string | null {
  const range = INTEGER_OPTIONS[key]
  if (range !== undefined) {
    const [min, max] = range
    const number = Number(value.trim())
    if (!/^\d+$/.test(value.trim()) || number < min || number > max)
      return `连接参数 ${key} 须是 ${min}–${max} 的整数`
    return null
  }
  if (ORDER_OPTIONS.has(key))
    return value === 'big' || value === 'little'
      ? null
      : `连接参数 ${key} 只能是 big 或 little`
  return `不支持的连接参数 ${key}，可用的有：${MODBUS_OPTION_KEYS.join('、')}`
}

/**
 * 校验全部连接参数，返回第一条不合规原因。
 * @param options 连接参数
 */
export function validateModbusOptions(
  options: Readonly<Record<string, string>>,
): string | null {
  for (const [key, value] of Object.entries(options)) {
    const problem = optionProblem(key, value)
    if (problem !== null) return problem
  }
  return null
}
