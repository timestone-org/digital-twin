/** @fileoverview 当前账号在本标签页的 Word 导入恢复记录，不保存文档与凭据。 */
export interface ImportRecovery {
  jobId: string
  name: string
  code: string
}
function key(userId: string): string {
  return `dt.report-import:${encodeURIComponent(userId)}`
}
function boundedText(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 1000
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function validJob(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 100
}
function isRecovery(value: unknown): value is ImportRecovery {
  if (!isRecord(value)) return false
  return (
    validJob(value['jobId']) &&
    boundedText(value['name']) &&
    boundedText(value['code'])
  )
}
export function readImportRecovery(
  userId: string | null,
): ImportRecovery | null {
  if (!userId) return null
  try {
    const raw = window.sessionStorage.getItem(key(userId))
    const value: unknown = raw === null ? null : JSON.parse(raw)
    return isRecovery(value)
      ? { jobId: value.jobId, name: value.name, code: value.code }
      : null
  } catch {
    return null
  }
}
export function writeImportRecovery(
  userId: string | null,
  recovery: ImportRecovery | null,
): boolean {
  if (!userId) return false
  try {
    if (recovery)
      window.sessionStorage.setItem(key(userId), JSON.stringify(recovery))
    else window.sessionStorage.removeItem(key(userId))
    return true
  } catch {
    return false
  }
}
