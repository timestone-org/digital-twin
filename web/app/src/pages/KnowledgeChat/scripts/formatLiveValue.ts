/** @fileoverview 对话实时读数的显示格式。 */
export function formatLiveValue(value: unknown, decimals = 2): string {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value.toFixed(decimals) : '—'
  }
  if (value === null) return 'null'
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'object') return JSON.stringify(value)
  return typeof value === 'string' ? value : '—'
}
