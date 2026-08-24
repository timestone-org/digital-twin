/**
 * @fileoverview 运行态场景工具里能提纯的那一半：颜色图例、截图文件名、剖切平面、
 * 场景内搜索、两点测距。不碰 three、不碰 DOM、不读时钟——时间戳由调用方喂进来。
 */
import { flowKindColor, flowKindToken } from './flowColors'
import { tintStopText } from './partTint'
import type {
  TwinFlowLink,
  TwinHierNode,
  TwinPart,
  TwinPartTint,
} from './types'

/** 图例分组。 */
export const TWIN_LEGEND_GROUPS = ['能量流', '部件染色'] as const
export type TwinLegendGroup = (typeof TWIN_LEGEND_GROUPS)[number]

/** 图例一条：一个颜色加它代表什么。 */
export interface TwinLegendEntry {
  group: TwinLegendGroup
  /** 颜色含义（能源种类 / 这一档代表什么）。 */
  label: string
  /** 主题 token 名；没有就是 null，调用方直接用 `color`。 */
  token: string | null
  /** 内置色，token 取不出时的兜底。 */
  color: string
}

/**
 * 把场景里的颜色语义归集成一份图例。
 *
 * ⚠ 同一个含义只列一次：十条能流共用一套种类、几十个部件共用一套染色档位都是
 * 常态，逐条列出来的图例没法看。
 * ⚠ 没写种类的流、没写说明的档位照样进图例——档位那一侧有 `tintStopText` 按
 * 条件拼一句兜底，而「一个没有任何说明的色块」等于没有图例。
 *
 * @param flows 归一化后的能量流
 * @param parts 归一化后的部件，取它们的状态染色档位
 */
export function collectSceneLegend(
  flows: readonly TwinFlowLink[],
  parts: readonly TwinPart[],
): TwinLegendEntry[] {
  const out: TwinLegendEntry[] = []
  const seen = new Set<string>()
  const push = (entry: TwinLegendEntry): void => {
    const key = `${entry.group}\u0000${entry.label}\u0000${entry.color}${entry.token ?? ''}`
    if (entry.label === '' || seen.has(key)) return
    seen.add(key)
    out.push(entry)
  }
  for (const flow of flows) {
    const label = flow.kind.trim()
    push({
      group: '能量流',
      label,
      token: flowKindToken(label),
      color: flowKindColor(label),
    })
  }
  for (const part of parts) {
    for (const swatch of tintSwatches(part.tint)) push(swatch)
  }
  return out
}

/**
 * 颜色规格拆成图例要的两半。
 * ⚠ token 取不出时留 `transparent`、不猜一个色：猜的那个色会让「token 名写错了」
 * 看起来像「配对了」，而图例正是用来核对这件事的地方。
 */
function swatchOf(spec: string, label: string): TwinLegendEntry {
  const isToken = spec.startsWith('--')
  return {
    group: '部件染色',
    label,
    token: isToken ? spec : null,
    color: isToken ? 'transparent' : spec,
  }
}

/** 一条染色规则摊成图例条目；没配规则或没配颜色的档位不出现。 */
function tintSwatches(tint: TwinPartTint | null): TwinLegendEntry[] {
  if (tint === null) return []
  if (tint.mode === 'gradient') {
    const { min, max, from, to } = tint.gradient
    return [swatchOf(from, String(min)), swatchOf(to, String(max))]
  }
  return tint.stops
    .filter((stop) => stop.color !== '')
    .map((stop) => swatchOf(stop.color, tintStopText(stop)))
}

/**
 * 截图文件名：`<标题>-<时间戳>.png`。
 *
 * ⚠ 标题里的空白与路径/保留字符一律换成 `-`：留着它们在部分系统上会存盘失败，
 * 或者更糟——落到别的目录去。标题为空时回退 `twin-scene`，绝不产出以 `-` 开头
 * 的裸时间戳文件名。
 * @param title 场景标题
 * @param stamp 时间戳字符串（由调用方给，纯函数不读时钟）
 */
export function screenshotFileName(title: string, stamp: string): string {
  const safe = title
    .trim()
    // 空白与各系统的路径 / 保留字符逐个列出（不用区间写法，免得多一个少一个看不出来）
    .replace(/[\s/\\:*?"<>|]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_TITLE_CHARS)
  return `${safe === '' ? 'twin-scene' : safe}-${stamp}.png`
}

/** 文件名里标题部分的长度上限。 */
const MAX_TITLE_CHARS = 60

/**
 * `2026-08-04T12:34:56.789Z` → `20260804-123456`。
 * @param iso ISO 时刻串
 */
export function screenshotStamp(iso: string): string {
  const matched = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/.exec(iso)
  if (matched === null) return 'unknown'
  const [, year, month, day, hour, minute, second] = matched
  return `${year}${month}${day}-${hour}${minute}${second}`
}

/** 剖切轴；`none` = 不剖切。 */
export const TWIN_CLIP_AXES = ['none', 'x', 'y', 'z'] as const
export type TwinClipAxis = (typeof TWIN_CLIP_AXES)[number]

/** 一个剖切平面的数学表达（与 three 的 `Plane(normal, constant)` 同形）。 */
export interface TwinClipPlane {
  normal: [number, number, number]
  constant: number
}

/**
 * 由「轴 + 归一化位置」算出剖切平面。
 *
 * ⚠ 位置用 [0,1] 而不是世界坐标：模型尺度从几米到几百米不等，让用户去猜一个
 * 世界坐标是不可用的；归一化之后滑块两端永远正好卡住包围盒两侧。
 *
 * 法向取轴的负方向（剖掉正向那半），`constant` 按 three 的约定为 `-normal·point`。
 * @param axis 剖切轴
 * @param ratio 沿轴的归一化位置 [0,1]；超界自动夹取
 * @param min 模型包围盒该轴的下界
 * @param max 模型包围盒该轴的上界
 * @returns `none` 或包围盒退化（max ≤ min）时给 null（= 不剖切）
 */
export function clipPlaneFor(
  axis: TwinClipAxis,
  ratio: number,
  min: number,
  max: number,
): TwinClipPlane | null {
  if (axis === 'none') return null
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return null
  const clamped = Number.isFinite(ratio) ? Math.min(1, Math.max(0, ratio)) : 0.5
  const at = min + (max - min) * clamped
  const normal: [number, number, number] =
    axis === 'x' ? [-1, 0, 0] : axis === 'y' ? [0, -1, 0] : [0, 0, -1]
  return { normal, constant: at }
}

/** 一条搜索命中。 */
export interface TwinSearchHit {
  kind: 'part' | 'hier' | 'node'
  /** 实体 id；`node` 档即节点名。 */
  id: string
  label: string
  /** 用于定位的节点名。 */
  nodes: readonly string[]
  /** 命中质量：0 = 前缀命中，1 = 子串命中（升序即相关性降序）。 */
  rank: number
}

/** 搜索结果默认条数上限。 */
const DEFAULT_SEARCH_LIMIT = 50

/** 搜索的取材：部件、钻取层级与模型里的节点名。 */
export interface TwinSearchSource {
  parts: readonly TwinPart[]
  hierNodes: readonly TwinHierNode[]
  namedNodes: readonly string[]
}

/** 前缀命中给 0、子串命中给 1、不命中给 -1。 */
function rankOf(text: string, query: string): number {
  const lower = text.toLowerCase()
  if (lower.startsWith(query)) return 0
  return lower.includes(query) ? 1 : -1
}

/**
 * 搜部件名 / 钻取节点名 / 模型节点名。
 *
 * 排序：前缀命中优先于子串命中，同档按「名字更短的更相关」（搜 `pump` 时 `Pump`
 * 该排在 `Pump_Assembly_Housing_01` 前面），最后按字典序保证结果稳定。
 *
 * ⚠ 截断时 `total` 仍是命中总数：调用方要如实告知「还有多少条没显示」，
 * 静默砍掉会让用户以为搜到的就这些。
 * @param query 搜索词；空白串给空结果
 * @param source 取材
 * @param limit 条数上限
 */
export function searchSceneEntities(
  query: string,
  source: TwinSearchSource,
  limit: number = DEFAULT_SEARCH_LIMIT,
): { hits: TwinSearchHit[]; total: number } {
  const needle = query.trim().toLowerCase()
  if (needle === '') return { hits: [], total: 0 }
  const hits: TwinSearchHit[] = []

  for (const [index, part] of source.parts.entries()) {
    const label = part.name === '' ? `部件 ${index + 1}` : part.name
    const rank = rankOf(label, needle)
    if (rank >= 0)
      hits.push({ kind: 'part', id: part.id, label, nodes: part.nodes, rank })
  }
  for (const node of source.hierNodes) {
    const rank = rankOf(node.name, needle)
    if (rank >= 0) {
      hits.push({
        kind: 'hier',
        id: node.id,
        label: node.name,
        nodes: node.nodes,
        rank,
      })
    }
  }
  for (const name of source.namedNodes) {
    const rank = rankOf(name, needle)
    if (rank >= 0)
      hits.push({ kind: 'node', id: name, label: name, nodes: [name], rank })
  }

  hits.sort(
    (a, b) =>
      a.rank - b.rank ||
      a.label.length - b.label.length ||
      a.label.localeCompare(b.label),
  )
  return { hits: hits.slice(0, limit), total: hits.length }
}

/** 距离大于它按整数显示。 */
const COARSE_DISTANCE = 100

/**
 * 两点直线距离的展示文本。
 *
 * ⚠ **不写单位**：世界单位是无量纲的（模型导出时定标，可能是米也可能是毫米），
 * 编一个「m」出来，在按毫米建模的图纸上就是错的。只按量级选小数位——毫米级
 * 模型上 0.5 与 0.503 不是一回事。
 * @param distance 世界单位下的距离
 */
export function formatMeasureDistance(distance: number): string {
  if (!Number.isFinite(distance) || distance < 0) return '—'
  if (distance >= COARSE_DISTANCE) return String(Math.round(distance))
  if (distance >= 1) return distance.toFixed(2).replace(/\.?0+$/, '')
  return distance.toFixed(3).replace(/\.?0+$/, '')
}

/**
 * 三维两点直线距离；任一坐标非有限时给 NaN（调用方按「测不出」处理）。
 * @param a 起点
 * @param b 终点
 */
export function measureDistance(
  a: readonly [number, number, number] | null,
  b: readonly [number, number, number] | null,
): number {
  if (a === null || b === null) return Number.NaN
  if (![...a, ...b].every((value) => Number.isFinite(value))) return Number.NaN
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
}
