/**
 * @fileoverview 检查器写入的撤销合并键：同一个实体的同一组字段连续改，合成一帧撤销。
 */
import type { TwinConfig } from '@dt/twin-config'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 两份对象里取值不同的那些键，排好序。 */
function changedKeys(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)])
  return [...keys]
    .filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]))
    .sort()
}

/**
 * 一个实体集合里改了哪些实体的哪些字段；增删或重排给 null（结构性改动不合并）。
 * @param section 集合名
 * @param before 改之前
 * @param after 改之后
 */
function listChanges(
  section: string,
  before: readonly unknown[],
  after: readonly unknown[],
): string[] | null {
  if (before.length !== after.length) return null
  const parts: string[] = []
  for (const [index, item] of after.entries()) {
    const prev = before[index]
    if (prev === item) continue
    if (!isRecord(prev) || !isRecord(item) || prev['id'] !== item['id'])
      return null
    const id = typeof item['id'] === 'string' ? item['id'] : String(index)
    parts.push(`${section}:${id}:${changedKeys(prev, item).join(',')}`)
  }
  return parts
}

/**
 * 检查器这一笔写入的合并键；同一个实体的同一组字段连续写入时相同。
 * 增删、重排或什么都没变时给 null，调用方按普通写入记一帧。
 * ⚠ 输入框每敲一个字发一次：不合并的话改个名要撤十几下，还会把早先的改动挤出撤销栈。
 * @param before 写入前的配置
 * @param patch 检查器发上来的整段替换
 */
export function inspectorMergeKey(
  before: TwinConfig,
  patch: Partial<TwinConfig>,
): string | null {
  const parts: string[] = []
  for (const [section, next] of Object.entries(patch)) {
    const prev: unknown = Reflect.get(before, section)
    if (prev === next) continue
    if (Array.isArray(prev) && Array.isArray(next)) {
      const changes = listChanges(section, prev, next)
      if (changes === null) return null
      parts.push(...changes)
    } else if (isRecord(prev) && isRecord(next)) {
      parts.push(`${section}:${changedKeys(prev, next).join(',')}`)
    } else {
      parts.push(section)
    }
  }
  return parts.length === 0 ? null : `inspect|${parts.sort().join('|')}`
}
