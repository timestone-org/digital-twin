/**
 * @fileoverview 模块配置的读取原语：`config` 到组件手里是 `Record<string, unknown>`，
 * 每个模块只读自己 `configSchema` 声明过的键，读出来立刻收窄成确定类型。
 */
import type { ConfigField } from '@dt/contracts'

/**
 * 文本。
 * @param raw 配置里读出来的原值
 * @param fallback 非字符串时的回退
 */
export function readText(raw: unknown, fallback = ''): string {
  return typeof raw === 'string' ? raw : fallback
}

/**
 * 布尔。⚠ 只认真正的 `true`：`'true'` 这种字符串一律按 false，
 * 否则「配置里存了字符串」这种脏数据会让开关看起来是开着的。
 * @param raw 配置里读出来的原值
 * @param fallback 非布尔时的回退
 */
export function readBoolean(raw: unknown, fallback = false): boolean {
  return typeof raw === 'boolean' ? raw : fallback
}

/**
 * 有限数；NaN 与 ±Infinity 按缺失处理。
 * @param raw 配置里读出来的原值
 * @param fallback 取不到有限数时的回退
 */
export function readNumber(raw: unknown, fallback: number): number {
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : fallback
}

function isRecord(raw: unknown): raw is Record<string, unknown> {
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw)
}

/**
 * 子对象；数组与 null 都不算对象。
 * @param raw 配置里读出来的原值
 */
export function readRecord(raw: unknown): Record<string, unknown> {
  return isRecord(raw) ? raw : {}
}

/** 引用型缺省逐份复制，免得所有节点共享同一个对象、谁就地改一下全体跟着变。 */
function copy(value: unknown): unknown {
  return typeof value === 'object' && value !== null
    ? structuredClone(value)
    : value
}

/**
 * 把 `configSchema` 声明的缺省摊成一份配置。
 * ⚠ 只取字段自己的 `default`，不递归进 `fields`：`object` 字段声明的是**整块**缺省，
 * 再从子字段拼一份就有了第二个形状，两份必然漂。
 * @param fields 模块清单里的配置字段
 */
export function configDefaults(
  fields: readonly ConfigField[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const field of fields) {
    if (field.default !== undefined) out[field.key] = copy(field.default)
  }
  return out
}
