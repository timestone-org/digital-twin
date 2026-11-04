/** @fileoverview 数据视图由调用方持有的多选配置。 */
export interface DtDataViewSelection<TRow extends { id: string }> {
  selectedIds: readonly string[]
  disabled?: boolean | undefined
  selectAllLabel?: string | undefined
  rowLabel?: ((row: TRow) => string) | undefined
}
