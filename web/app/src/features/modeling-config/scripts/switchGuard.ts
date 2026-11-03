/** @fileoverview 配置选项切换时阻止隐藏当前可见的错误与未应用草稿。 */
import type { ConfigStatus } from './configValues'
import { configError, fieldValue } from './configValues'
import type { FormField } from './schemaForm'
import { visibleFields } from './schemaForm'

export function hiddenInvalidField(
  fields: readonly FormField[],
  config: Record<string, unknown>,
  drafts: Readonly<Record<string, ConfigStatus>>,
  change: { key: string; value: unknown },
): FormField | undefined {
  const next = new Set(
    visibleFields(fields, { ...config, [change.key]: change.value }).map(
      (field) => field.key,
    ),
  )
  return visibleFields(fields, config).find(
    (field) =>
      !next.has(field.key) && hasIssue(field, config, drafts[field.key]),
  )
}
function hasIssue(
  field: FormField,
  config: Record<string, unknown>,
  draft: ConfigStatus | undefined,
): boolean {
  return (
    draft?.hasDraft === true ||
    Boolean(draft?.message) ||
    configError(field, fieldValue(field, config)) !== ''
  )
}
