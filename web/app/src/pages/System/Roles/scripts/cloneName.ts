/**
 * @fileoverview 克隆角色时的名称建议。
 *
 * ⚠ 这只是便利，不是校验：`existing` 只有当前这一页已加载的角色名，列表是
 * 分页的，重名判不全。唯一性由后端 409「角色名已被占用」保证，前端原样显示。
 */

/** 在 `base` 后补 `_copy` / `_copy2`…，跳过 `existing` 里已被占用的。 */
export function suggestCloneName(
  base: string,
  existing: readonly string[],
): string {
  const taken = new Set(existing)
  if (!taken.has(`${base}_copy`)) return `${base}_copy`
  let ordinal = 2
  while (taken.has(`${base}_copy${ordinal}`)) ordinal += 1
  return `${base}_copy${ordinal}`
}
