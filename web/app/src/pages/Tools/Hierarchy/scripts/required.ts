/** @fileoverview 已校验图内部的关联完整性检查。 */
export function required<T>(value: T | undefined | null): T {
  if (value === undefined || value === null)
    throw new Error('图内部关联缺失，请重新生成')
  return value
}
