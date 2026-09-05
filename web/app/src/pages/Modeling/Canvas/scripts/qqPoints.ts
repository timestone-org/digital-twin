/**
 * @fileoverview 正态 QQ 那一块的取料：把后端给的分位点折成散点元件 qq 态要的
 * 一路点，并把「点偏离对角线偏成什么样」读成一句给所有人看的话。
 *
 * ⚠ 这一档必须画成点对对角线：横条只印得出每个分位上的残差值，而 QQ 要回答的
 * 是「实测分位比正态分位远多少」——两个数之差在一排横条上根本不出现
 * （MODELING_RESULT_VIEW_DESIGN §5-22）。
 * ⚠ 结论按**尺度比**下，不按偏离的绝对值：残差的量纲随目标列走，同一个「偏了
 * 0.3」在温度上无关紧要、在功率因数上是整条分布错位。
 */
import { grouped } from './numbers'
import { recordOf } from './reportBlocks'
import type { ScatterSeries } from './scatterGeometry'

type Item = Record<string, unknown>

/** 一个分位点：正态给的那个数、实测的那个数、它在分布上的位置。 */
interface QqPoint {
  expected: number
  value: number
  ratio: number
}

/** 折好的一张图：一路点 + 两根轴的名字 + 图下那句结论。 */
export interface QqView {
  series: readonly ScatterSeries[]
  xLabel: string
  yLabel: string
  note: string
}

const X_LABEL = '正态分位（同均值同方差）'
const Y_LABEL = '实测残差分位'
const SERIES_NAME = '残差分位'

/** 中段取这两个分位之间那一截。 */
const LOW_QUARTILE = 0.25
const HALF = 0.5
const HIGH_QUARTILE = 0.75
/** 两端比中段撑开或收紧超过这个比例才算肉眼看得出来。 */
const FATTER = 0.3
/** 上下半段长度差占整段的这个比例才算偏。 */
const LEANING = 0.3
/** 少于这么多个点就不画：一个点连不成一条趋势。 */
const MIN_POINTS = 2

const NEAR_LINE =
  '点基本贴着对角线：残差接近正态，没有哪一头单独拖出一串离谱的大错'
/** ⚠ 量不出形状时不许退成「接近正态」：那是一句凭空替读者下的结论。 */
const UNREADABLE = '这几个分位点量不出形状：实测分位没有跨度，看不出偏向哪一边'
const HEAVY_TAILS =
  '两端翘出对角线、中段反而贴得紧：尾巴比正态厚——有少数几行错得特别离谱，而偏均值与离散度这两个数把它们摊平了'
const LIGHT_TAILS =
  '两端往对角线里收、中段反而撑得开：尾巴比正态薄——误差挤在一个大致固定的幅度里，没有越错越离谱的那一段'
const SKEW_HIGH =
  '点列往上弯，上半段比下半段拖得长：残差右偏——预测偏小的那几行，错得比偏大的狠得多'
const SKEW_LOW =
  '点列往下弯，下半段比上半段拖得长：残差左偏——预测偏大的那几行，错得比偏小的狠得多'

/** 逐项那一串；读不成数组就是一项都没有。Args: value。 */
function itemsOf(value: unknown): Item[] {
  return (Array.isArray(value) ? value : []).map((one) => recordOf(one))
}

/** 一项上的一个数；读不出来给 null。Args: item, key。 */
function numberOf(item: Item, key: string): number | null {
  const value = item[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** 三个数都读得出来才算一个点；读不出来的那一项不画，也不折成 0。Args: items。 */
function pointsOf(items: readonly Item[]): QqPoint[] {
  const kept: QqPoint[] = []
  for (const item of items) {
    const expected = numberOf(item, 'expected')
    const value = numberOf(item, 'value')
    const ratio = numberOf(item, 'ratio')
    if (expected === null || value === null || ratio === null) continue
    kept.push({ expected, value, ratio })
  }
  return kept.sort((one, other) => one.ratio - other.ratio)
}

/**
 * 这一块是不是正态 QQ。
 *
 * ⚠ 认的是逐项带的键而不是标题：标题是给人读的一句话，改一个字就换一张画法的
 * 话，这条接线早晚会哑掉，而哑掉的样子是几十个分位点摊成几十根横条。
 * Args: payload。
 */
export function isQq(payload: Item): boolean {
  const [first] = itemsOf(payload['items'])
  if (first === undefined) return false
  return 'expected' in first && 'ratio' in first && 'value' in first
}

/** 离某个分位最近的那个点。Args: points, ratio, fallback。 */
function nearest(
  points: readonly QqPoint[],
  ratio: number,
  fallback: QqPoint,
): QqPoint {
  return points.reduce(
    (best, one) =>
      Math.abs(one.ratio - ratio) < Math.abs(best.ratio - ratio) ? one : best,
    fallback,
  )
}

/** 这条点列的形状：中段与两端各自的尺度，以及上下半段谁更长。 */
interface Shape {
  /** 中段实测跨度 ÷ 正态在同一段上的跨度；1 就是与正态同尺。 */
  centre: number
  /** 两端实测跨度 ÷ 正态在两端上的跨度。 */
  tail: number
  /** 上半段比下半段长出整段的几成；正数是上半段更长。 */
  lean: number
}

/**
 * 量出这条点列的形状；量不出来时给 null。
 *
 * ⚠ 用比值而不是差值：正态那一侧的分位由这份残差自己的离散度定，两侧同乘一个
 * 单位换算之后比值不变，而差值会跟着量纲一起变。
 * Args: points。
 */
function shapeOf(points: readonly QqPoint[]): Shape | null {
  const first = points[0]
  const last = points[points.length - 1]
  if (first === undefined || last === undefined) return null
  const low = nearest(points, LOW_QUARTILE, first)
  const high = nearest(points, HIGH_QUARTILE, first)
  const mid = nearest(points, HALF, first)
  const centreSpan = high.expected - low.expected
  const tailSpan = last.expected - first.expected
  const width = last.value - first.value
  if (!(centreSpan > 0) || !(tailSpan > 0) || !(width > 0)) return null
  return {
    centre: (high.value - low.value) / centreSpan,
    tail: width / tailSpan,
    lean: (last.value + first.value - 2 * mid.value) / width,
  }
}

/** 点偏离对角线偏成了什么样，一句话。Args: points。 */
function verdictOf(points: readonly QqPoint[]): string {
  const shape = shapeOf(points)
  if (shape === null || !(shape.centre > 0) || !(shape.tail > 0)) {
    return UNREADABLE
  }
  if (shape.lean > LEANING) return SKEW_HIGH
  if (shape.lean < -LEANING) return SKEW_LOW
  const stretch = shape.tail / shape.centre
  if (stretch > 1 + FATTER) return HEAVY_TAILS
  if (stretch < 1 - FATTER) return LIGHT_TAILS
  return NEAR_LINE
}

/**
 * 把一块分位点折成一路散点。
 *
 * ⚠ 点不够两个时给 null：一个点连不成趋势，而画出来与「这一步本来就没有这张
 * 图」在屏幕上长得一模一样。
 * Args: payload。
 */
export function buildQq(payload: Item): QqView | null {
  const points = pointsOf(itemsOf(payload['items']))
  if (points.length < MIN_POINTS) return null
  return {
    series: [
      {
        name: SERIES_NAME,
        points: points.map((one) => [one.expected, one.value] as const),
        draw: 'dots',
      },
    ],
    xLabel: X_LABEL,
    yLabel: Y_LABEL,
    note: `${grouped(points.length)} 个分位点；${verdictOf(points)}`,
  }
}
