/**
 * @fileoverview 权限判定（纯集合运算）。
 * ⚠ 这是**闸 3**，永远不是安全边界——它只决定「给不给点」，后端仍会拦。
 * 任何隐藏按钮的地方都要记得这句。
 */

/** 是否持有全部给定权限码。空需求视为满足。 */
export function hasAll(
  held: ReadonlySet<string>,
  required: readonly string[],
): boolean {
  return required.every((code) => held.has(code))
}

/** 是否持有其中任意一个。⚠ 空需求视为**不**满足。 */
export function hasAny(
  held: ReadonlySet<string>,
  required: readonly string[],
): boolean {
  return required.some((code) => held.has(code))
}

/** 按模式判定。`mode` 与后端 `match_mode` 同名同义。 */
export function isAllowed(
  held: ReadonlySet<string>,
  required: readonly string[],
  mode: 'all' | 'any' = 'all',
): boolean {
  if (required.length === 0) return true
  return mode === 'any' ? hasAny(held, required) : hasAll(held, required)
}
