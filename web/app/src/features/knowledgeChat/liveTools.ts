/** @fileoverview 点位工具的参数校验、真实配置解析与卡片回执。 */
import type { AssistantToolCall } from '@dt/contracts'
import { getSource, listPoints } from '@/api/collect'
import { BizError } from '@/api/client'
import { searchCollectPoints } from '@/api/collectSearch'
import { readObject, type RunnerStep } from '@/features/ai/turnLoop'

export const POINT_QUERY_MAX_CHARS = 80
export const SEARCH_POINTS = 'collect.search_points'
export const WATCH_POINT = 'collect.watch_point'
export const LIVE_TOOLS = [SEARCH_POINTS, WATCH_POINT] as const
const NODE_KEY =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
const SOURCE_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export interface LivePoint {
  kind: 'collect.live.v1'
  node_key: string
  name: string
  source_name: string
  unit: string | null
}

/** 重新读取配置，点位身份只能精确匹配。 */
export async function resolveLivePoint(
  nodeKey: string,
  signal?: AbortSignal,
): Promise<LivePoint> {
  if (!NODE_KEY.test(nodeKey)) throw new Error('点位身份格式不正确，请重新查找')
  const [sourceId = '', code = ''] = nodeKey.split(':')
  const source = await getSource(sourceId, signal)
  signal?.throwIfAborted()
  // 编码过滤可命中多个前缀，分页有界扫描到精确身份。
  const pages = Math.min(10, Math.ceil(source.point_count / 200))
  for (let page = 1; page <= Math.max(1, pages); page += 1) {
    const found = await listPoints(
      { sourceId, q: code, page, size: 200 },
      signal,
    )
    signal?.throwIfAborted()
    const point = found.items.find((one) => one.node_key === nodeKey)
    if (point !== undefined) {
      if (!source.is_enabled)
        throw new Error('这个数据源尚未启用，请先在采集配置中启用')
      return {
        kind: 'collect.live.v1',
        node_key: nodeKey,
        name: point.name,
        source_name: source.name,
        unit: point.unit,
      }
    }
    if (page * found.size >= found.total) break
  }
  throw new Error('点位已不存在，请重新查找')
}

/** 运行只读工具，持续读数不回填给模型。 */
export async function runLiveTool(
  call: AssistantToolCall,
  signal?: AbortSignal,
): Promise<string> {
  signal?.throwIfAborted()
  if (call.name === WATCH_POINT) {
    const key = call.arguments.node_key
    if (typeof key !== 'string') throw new Error('需要搜索结果中的点位身份')
    return JSON.stringify(await resolveLivePoint(key, signal))
  }
  if (call.name !== SEARCH_POINTS) throw new Error('不支持这个采集工具')
  const { query, source } = searchArguments(call.arguments)
  await requireSearchSource(source, signal)
  const result = await searchCollectPoints(query.trim(), source, signal)
  signal?.throwIfAborted()
  return JSON.stringify({
    ...result,
    items: result.items.map((one) => ({
      ...one,
      description: one.description?.slice(0, 160) ?? null,
    })),
  })
}

/** 只从校验过的回执恢复卡片，拒绝截断文本和任意模型正文。 */
export function parseLivePoint(raw: unknown): LivePoint | null {
  if (typeof raw !== 'string' || raw.length > 1500) return null
  try {
    const value: unknown = JSON.parse(raw)
    return pointFromRecord(readObject(value))
  } catch {
    return null
  }
}

export function livePointOfStep(step: RunnerStep): LivePoint | null {
  return step.name === WATCH_POINT && step.state === 'succeeded'
    ? parseLivePoint(step.output)
    : null
}

function searchArguments(arguments_: Record<string, unknown>) {
  const query = arguments_.query
  const source = sourceFilter(arguments_.source_id)
  if (typeof query !== 'string' || !query.trim())
    throw new Error('请提供设备名、编号和测量量等查询关键词')
  if (query.trim().length > POINT_QUERY_MAX_CHARS)
    throw new Error(
      '查询过长：请重新提炼2–6个关键词，最多80字，例如「动力换热 2#阀门 开度」。不要附带用途、权限或背景描述。',
    )
  return { query, source }
}

function pointFromRecord(row: Record<string, unknown>): LivePoint | null {
  if (
    row.kind !== 'collect.live.v1' ||
    typeof row.node_key !== 'string' ||
    !NODE_KEY.test(row.node_key)
  )
    return null
  if (typeof row.name !== 'string' || typeof row.source_name !== 'string')
    return null
  if (row.unit !== null && typeof row.unit !== 'string') return null
  return {
    kind: 'collect.live.v1',
    node_key: row.node_key,
    name: row.name,
    source_name: row.source_name,
    unit: row.unit,
  }
}

function sourceFilter(given: unknown): string | undefined {
  if (given === undefined || given === null || given === '') return undefined
  if (
    typeof given !== 'string' ||
    !SOURCE_ID.test(given) ||
    given === '00000000-0000-0000-0000-000000000000'
  ) {
    throw new Error(
      '数据源身份无效：未知数据源时请传null或省略source_id，不要编造UUID或用全零UUID表示全部',
    )
  }
  return given
}

async function requireSearchSource(
  source: string | undefined,
  signal?: AbortSignal,
): Promise<void> {
  if (source === undefined) return
  try {
    await getSource(source, signal)
    signal?.throwIfAborted()
  } catch (error) {
    if (error instanceof BizError && error.status === 404) {
      throw new Error(
        '指定的数据源不存在。若用户没有限定数据源，请省略source_id或传null重新搜索',
      )
    }
    throw error
  }
}
