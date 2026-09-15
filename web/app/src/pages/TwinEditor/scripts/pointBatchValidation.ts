/** @fileoverview 批量替换前核对目标点位，最多四路并发，只读采集目录。 */
import { listPoints } from '@/api/collect'
export interface PointValidation {
  key: string
  valid: boolean
  message: string
}
const SOURCE_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
async function validatePoint(
  key: string,
  signal: AbortSignal,
): Promise<PointValidation> {
  const separator = key.indexOf(':')
  const sourceId = key.slice(0, separator)
  const code = key.slice(separator + 1)
  if (separator < 0 || !SOURCE_ID.test(sourceId) || code === '')
    return { key, valid: false, message: '无法识别目标点位身份' }
  for (let page = 1; page <= 5; page += 1) {
    signal.throwIfAborted()
    const result = await listPoints(
      { sourceId, q: code, page, size: 100 },
      signal,
    )
    const point = result.items.find((point) => point.node_key === key)
    if (point !== undefined)
      return { key, valid: true, message: point.name || point.code }
    if (page * result.size >= result.total)
      return { key, valid: false, message: '目标点位不存在' }
  }
  return { key, valid: false, message: '匹配结果过多，无法确认目标点位' }
}
export async function validateReplacementPoints(
  keys: readonly string[],
  signal: AbortSignal,
): Promise<PointValidation[]> {
  const unique = [...new Set(keys)]
  if (unique.length > 200)
    throw new Error('一次最多校验200个不同点位，请缩小范围')
  const results: PointValidation[] = []
  for (let index = 0; index < unique.length; index += 4) {
    signal.throwIfAborted()
    results.push(
      ...(await Promise.all(
        unique.slice(index, index + 4).map((key) => validatePoint(key, signal)),
      )),
    )
  }
  return results
}
