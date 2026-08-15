/**
 * @fileoverview 归一化共用的几个原语：三元组、实体 id、列表、闭合联合。
 *
 * ⚠ 归一化只管形状——缺字段给缺省、非法值丢弃、非有限数按缺省顶上，从不抛错。
 * 形状之外的错（重复 id、悬空引用）交给 `collectTwinConfigIssues` 响亮报出。
 */
import { clamp, finiteOr, toArray, trimmedString } from './sanitize'
import type { Vec3 } from './types'

export const ORIGIN: Vec3 = [0, 0, 0]

/** 三元组；缺位与非有限数逐位回退。 */
export function vec3(value: unknown, fallback: Vec3): Vec3 {
  const items = toArray(value)
  return [
    finiteOr(items[0], fallback[0]),
    finiteOr(items[1], fallback[1]),
    finiteOr(items[2], fallback[2]),
  ]
}

/**
 * 实体 id：缺失或空白时按下标铸一个，同一份输入永远得到同一个 id。
 * ⚠ 不用随机 id：铸出来的 id 必须可复现，否则归一化跑两遍结果就不同，
 * 而数组绑定的文档序对齐正是靠「跑两遍一样」成立的。
 */
export function entityId(value: unknown, prefix: string, index: number): string {
  const id = trimmedString(value)
  return id === '' ? `${prefix}-${index}` : id
}

/** 逐项归一，产出 null 的丢掉。 */
export function normalizeList<T>(
  raw: unknown,
  each: (item: unknown, index: number) => T | null,
): T[] {
  const out: T[] = []
  toArray(raw).forEach((item, index) => {
    const normalized = each(item, index)
    if (normalized !== null) out.push(normalized)
  })
  return out
}

/**
 * 闭合联合的取值；不在集合里一律回落。
 * ⚠ 回落而不是丢弃：丢弃会让这个键从输出里消失，而幂等要求输出没有 `undefined`。
 */
export function oneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  return allowed.find((item) => item === value) ?? fallback
}

/** 取有限数并夹进区间。 */
export function clampedOr(
  value: unknown,
  fallback: number,
  low: number,
  high: number,
): number {
  return clamp(finiteOr(value, fallback), low, high)
}

/** 布尔；缺省由调用方给——`enabled` 缺省关，`visible` 缺省开，两者不能共用一个口径。 */
export function boolOr(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}
