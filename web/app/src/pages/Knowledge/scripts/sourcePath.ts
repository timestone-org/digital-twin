/** @fileoverview 现有平台来源只支持数字页码，不接受台账记录游标接口。 */
export function isCursorPlatformPath(value: unknown): boolean {
  return (
    typeof value === 'string' &&
    /^\/api\/v1\/platform\/dataset-tables\/[^/]+\/records\/?$/.test(value)
  )
}
