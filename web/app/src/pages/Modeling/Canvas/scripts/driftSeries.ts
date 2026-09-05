/**
 * @fileoverview 按时刻分格的那种 `breakdown`（残差随时间）折成一路序列。
 *
 * ⚠ 这一档必须画成序列而不是横条：横条把每一格的行名印成一串裸 ISO 时刻，且
 * 条与条之间没有时间距离——工况切换造成的整段偏移正是要靠时间轴才看得出来
 * （MODELING_RESULT_VIEW_DESIGN §5-22）。
 * ⚠ 横轴走「距起点的多少个单位」而不是毫秒时间戳：刻度按数字排版，毫秒会印成
 * 一串 1.75e12 那样谁也读不出来的数。起点与单位写在轴名上。
 */
import { formatLocalMinute } from '@dt/ui'

import { grouped } from './numbers'
import { recordOf } from './reportBlocks'
import type { ScatterSeries } from './scatterGeometry'

type Item = Record<string, unknown>

/** 逐项那一串；读不成数组就是一项都没有。Args: value。 */
function itemsOf(value: unknown): Item[] {
  return (Array.isArray(value) ? value : []).map((one) => recordOf(one))
}

/** 一格：这一段时间里的那个数。 */
interface DriftPoint {
  since: number
  value: number
}

/** 折好的一张图：一路序列 + 两根轴的名字 + 图下那句口径。 */
export interface DriftView {
  series: readonly ScatterSeries[]
  xLabel: string
  yLabel: string
  note: string
}

/** 横轴的档：一格跨得越久，单位越大。 */
interface Unit {
  readonly name: string
  readonly ms: number
}

const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

// 这一档的每一格都是一段时间里的均值（后端 `evalstats.py::_drift_rows`）
const Y_LABEL = '每格的均值'

const FINEST: Unit = { name: '秒', ms: SECOND }

/** 从细到粗；整段跨得下哪一档就用哪一档。 */
const UNITS: readonly Unit[] = [
  FINEST,
  { name: '分钟', ms: MINUTE },
  { name: '小时', ms: HOUR },
  { name: '天', ms: DAY },
]

/** 一格上那两个数都读得出来才算数；读不出来的那一格不画，也不折成 0。 */
function pointsOf(items: readonly Item[]): DriftPoint[] {
  const kept: DriftPoint[] = []
  for (const item of items) {
    const since = item['since']
    const value = item['value']
    if (typeof since !== 'number' || !Number.isFinite(since)) continue
    if (typeof value !== 'number' || !Number.isFinite(value)) continue
    kept.push({ since, value })
  }
  return kept
}

/**
 * 这一块是不是按时刻分格的。
 *
 * ⚠ 认的是逐项带的键而不是标题：标题是给人读的一句话，改一个字就换一张画法的
 * 话，这条接线早晚会哑掉，而哑掉的样子是时间轴退回成一排裸 ISO 串的横条。
 * Args: payload。
 */
export function isDrift(payload: Item): boolean {
  const [first] = itemsOf(payload['items'])
  if (first === undefined) return false
  return typeof first['since'] === 'number' && 'value' in first
}

/** 整段跨度该用哪一档单位；跨度为 0 时用最细的那一档。Args: span。 */
function unitOf(span: number): Unit {
  let picked = FINEST
  for (const unit of UNITS) {
    if (span >= unit.ms) picked = unit
  }
  return picked
}

/**
 * 把一块按时刻分格的数折成一路序列。
 *
 * ⚠ 一格都读不出来时给 null：那时这一块该退回原来的横条画法，画一张空图与
 * 「这一步本来就没有这张图」在屏幕上长得一模一样。
 * Args: payload；name 这一路叫什么。
 */
export function buildDrift(payload: Item, name: string): DriftView | null {
  const points = pointsOf(itemsOf(payload['items']))
  const first = points[0]
  const last = points[points.length - 1]
  if (first === undefined || last === undefined) return null
  const unit = unitOf(last.since - first.since)
  return {
    series: [
      {
        name,
        points: points.map(
          (one) => [(one.since - first.since) / unit.ms, one.value] as const,
        ),
        draw: 'both',
      },
    ],
    xLabel: `距 ${formatLocalMinute(first.since)} 的${unit.name}数`,
    yLabel: Y_LABEL,
    note: `${grouped(points.length)} 格，每格一个均值；起点 ${formatLocalMinute(first.since)}（本地时）`,
  }
}
