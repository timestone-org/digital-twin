/**
 * @fileoverview 左栏一行长什么样。
 * ⚠ 住在 `.ts` 而不是那个 `.vue` 里：`.vue` 的具名类型导出只有 vue-tsc 解析得出来，
 * typescript-eslint 眼里它是 `any`，于是读它字段的地方全被判成 unsafe。
 */
export interface StructureRow {
  key: string
  /** 部件行给部件名，格行给格名。 */
  label: string
  /** 部件行留空，格行给单位；空串则不画第二行。 */
  note: string
  icon: string
}
