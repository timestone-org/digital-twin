/**
 * @fileoverview 把 publisher 推来的条目解成 `PointSample`。
 * 条目形状由 platform-server 的 `apps/collect/services/point_frames.py` 定：
 * `{nodeKey, state, value, timestampMs, quality}`，**`error` 档不带 value**。
 *
 * ⚠ 逐字段窄化，不写 `as`：推送方与前端各改各的时，断言会让错形状一路流进
 * 渲染层，最后崩在某个深层组件里，而不是在这里说「这条条目形状不对」。
 * ⚠ 认不出来的条目直接丢，但**丢也要丢得干净**——绝不退化成一个 value 为
 * undefined 的 `ok`，那与「现场报了空值」长得一模一样。
 */
import type { PointQuality, PointSample } from '@dt/contracts'
import { POINT_QUALITIES } from '@dt/contracts'

/** 解出来的一条：点位身份 + 读数。 */
export interface DecodedPoint {
  nodeKey: string
  sample: PointSample
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function toQuality(raw: unknown): PointQuality {
  // ⚠ 认不出的质量位按 uncertain：按 good 处理等于替现场担保，按 bad 又会把
  // 一批本来可用的读数全打成不可用
  return POINT_QUALITIES.find((quality) => quality === raw) ?? 'uncertain'
}

/**
 * 解一条条目。
 * @param item 推送条目
 */
export function decodePointItem(item: unknown): DecodedPoint | null {
  if (!isRecord(item)) return null
  const nodeKey = item.nodeKey
  const state = item.state
  if (typeof nodeKey !== 'string' || nodeKey === '') return null
  if (state === 'error') {
    const reason = item.errorMessage
    return {
      nodeKey,
      sample: {
        state: 'error',
        errorMessage: typeof reason === 'string' ? reason : '点位取不到值',
      },
    }
  }
  // ⚠ 'stale' 也按有值收下：推送方仍可能带着这一档（旧标签页、回滚窗口），
  // 而整条丢掉会让那个点位在屏上凭空消失，比原样显示它的值糟得多
  if (state !== 'ok' && state !== 'stale') return null
  const timestampMs = item.timestampMs
  if (typeof timestampMs !== 'number' || !Number.isFinite(timestampMs)) {
    return null
  }
  return {
    nodeKey,
    sample: {
      state: 'ok',
      value: item.value,
      timestampMs,
      quality: toQuality(item.quality),
    },
  }
}

/**
 * 解一整帧的 `payload`：`{ items: [...] }`。
 * @param payload data 帧的载荷
 */
export function decodePointItems(payload: unknown): DecodedPoint[] {
  if (!isRecord(payload)) return []
  const items = payload.items
  if (!Array.isArray(items)) return []
  const decoded: DecodedPoint[] = []
  for (const item of items) {
    const one = decodePointItem(item)
    if (one !== null) decoded.push(one)
  }
  return decoded
}

/**
 * 一张大屏的推送主题。
 * @param dashboardId 大屏 id
 */
export function dashboardTopic(dashboardId: string): string {
  return `dashboard:${dashboardId}`
}

/**
 * 一张**公开**大屏的推送主题：拿公开令牌换来的那个别名。
 * ⚠ 它不是 `dashboard:{id}`：公开面拿不到大屏 id（ADR-0014），服务端按票据
 * 把真主题换成这个别名，帧发出来时也用它（ADR-0021）。写成真主题的话订阅会
 * 被拒，而页面只表现为「永远没有值」。
 * @param publicToken 公开令牌，就是地址里的那一段
 */
export function publicTopic(publicToken: string): string {
  return `public:${publicToken}`
}

/**
 * 一个采集数据源的推送主题，与 platform-server 的 `apps/collect/services/
 * topics.py` 同形。
 * ⚠ 与 `dashboardTopic` 是两个前缀、两个推送方：写串了 hub 会以「主题未登记」
 * 拒订，而页面只表现为「永远没有值」。
 * @param sourceId 数据源 id
 */
export function collectTopic(sourceId: string): string {
  return `collect:${sourceId}`
}
