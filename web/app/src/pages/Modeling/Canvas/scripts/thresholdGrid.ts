/**
 * @fileoverview 阈值网格的取料：把后端给的每档四格计数折成滑杆能查的表，以及
 * 站定一档之后的混淆矩阵与四个指标（结果展示规格 §13.3）。
 *
 * ⚠ 查表不重算：前端手上只有抽样过的散点，拿它现算的指标与同屏那几张卡对不上
 * 账。这里做的是「查第几行」与「四个整数怎么折成四个比率」，一个概率都不重算。
 * ⚠ 分母为 0 的比率一律给 null：判成正类的一行都没有时精确率是无定义，写成 0
 * 会被读成「判成正类的全错了」。
 */
import { grouped, niceNumber } from './numbers'
import { probabilityItemsOf } from './reportBlocks'
import type { StatItem } from './statCards'

type Item = Record<string, unknown>

/** 两行两列的行列名：矩阵与卡片共用一副说法。 */
export const POSITIVE_LABEL = '正类'
export const NEGATIVE_LABEL = '负类'

/** 网格上的一档：一个阈值与它上面判对判错的四格。 */
export interface ThresholdRow {
  /** 后端已经排好版的写法（三位小数），两处印的是同一个串。 */
  text: string
  threshold: number
  truePositive: number
  falsePositive: number
  trueNegative: number
  falseNegative: number
}

/** 一整张网格，连它默认停在哪一档。 */
export interface ThresholdGrid {
  /** 按阈值从低到高：滑杆往右推就是把门槛抬高。 */
  rows: ThresholdRow[]
  /** 打分那一刀：判成正类的行里最低的那个概率；null = 一行都没判成正类。 */
  trainedThreshold: number | null
  /** 默认停在第几档；网格是空的时候是 0。 */
  trainedSeat: number
  /** 默认那一档正好就是打分那一刀，不是就近找的。 */
  isExact: boolean
}

/** 网格两端那两档，摆在轨道底下当尺子。 */
export interface ThresholdEnds {
  low: string
  high: string
}

/** 站定一档之后屏幕上那几样。 */
export interface ThresholdStand {
  text: string
  labels: readonly string[]
  matrix: number[][]
  cards: StatItem[]
  summary: string
  /** 离打分时那个阈值有多远，以及那意味着什么。 */
  offset: string
}

const EMPTY_STAND: ThresholdStand = {
  text: '',
  labels: [],
  matrix: [],
  cards: [],
  summary: '这一块一档阈值都没有',
  offset: '',
}

/** 分母为 0 就是无定义。Args: top, bottom。 */
function ratio(top: number, bottom: number): number | null {
  return bottom === 0 ? null : top / bottom
}

/** 一档四格齐全才要；缺一个整数的那一档整档不要，不补 0。Args: payload。 */
function rowsOf(payload: Item): ThresholdRow[] {
  const found: ThresholdRow[] = []
  for (const item of probabilityItemsOf(payload)) {
    const { threshold, truePositive, falsePositive } = item
    const { trueNegative, falseNegative } = item
    if (threshold === null || truePositive === null) continue
    if (falsePositive === null || trueNegative === null) continue
    if (falseNegative === null) continue
    found.push({
      text: item.name,
      threshold,
      truePositive,
      falsePositive,
      trueNegative,
      falseNegative,
    })
  }
  return found.sort((left, right) => left.threshold - right.threshold)
}

/** 离打分那一刀最近的一档。Args: rows, trained。 */
function nearestSeat(
  rows: readonly ThresholdRow[],
  trained: number | null,
): number {
  if (rows.length === 0) return 0
  if (trained === null) return rows.length - 1
  let seat = 0
  let best = Number.POSITIVE_INFINITY
  for (const [index, row] of rows.entries()) {
    const gap = Math.abs(row.threshold - trained)
    if (gap < best) {
      best = gap
      seat = index
    }
  }
  return seat
}

/**
 * 一整张网格。
 *
 * ⚠ 默认那一档是**就近**找的，且 `isExact` 照实说：后端会把打分那一刀强行留在
 * 网格上，留不住时（旧结果、或那一次一行都没判成正类）只能就近站，而就近那一
 * 档的四格与 ② 区那张指标卡不是同一组数，界面上得说清楚。
 * Args: payload 这一块的 payload；trained 打分那一刀的阈值。
 */
export function buildThresholdGrid(
  payload: Item,
  trained: number | null,
): ThresholdGrid {
  const rows = rowsOf(payload)
  const seat = nearestSeat(rows, trained)
  const found = rows[seat]
  return {
    rows,
    trainedThreshold: trained,
    trainedSeat: seat,
    isExact:
      found !== undefined &&
      trained !== null &&
      Math.abs(found.threshold - trained) < Number.EPSILON,
  }
}

/**
 * 这一档的四个指标。
 *
 * ⚠ 中文名写在这里、卡片按「列名」档摆：走指标档的话卡片会去查阈值表给这几个
 * 数染色，而 ② 区同样这四个数是不染色的——同一个语义在一屏上不能有两种冷暖。
 * Args: row。
 */
function cardsOf(row: ThresholdRow): StatItem[] {
  const total =
    row.truePositive + row.falsePositive + row.trueNegative + row.falseNegative
  const guessed = row.truePositive + row.falsePositive
  const real = row.truePositive + row.falseNegative
  const both = 2 * row.truePositive + row.falsePositive + row.falseNegative
  return [
    {
      key: 'accuracy',
      label: '准确率',
      value: ratio(row.truePositive + row.trueNegative, total),
    },
    {
      key: 'precision',
      label: '精确率',
      value: ratio(row.truePositive, guessed),
    },
    { key: 'recall', label: '召回率', value: ratio(row.truePositive, real) },
    { key: 'f1', label: 'F1', value: ratio(2 * row.truePositive, both) },
  ]
}

/**
 * 离打分那一刀有多远。
 *
 * ⚠ 不许写成「打分时用的是 X」：X 是从打分帧反推的——判成正类的行里最低的那个
 * 概率，与用户配的那个超参可以不是同一个数（配 0.5、反推得 0.541），照那么说
 * 用户会去找一个自己从没填过的值。
 * Args: row, grid。
 */
function offsetOf(row: ThresholdRow, grid: ThresholdGrid): string {
  const trained = grid.trainedThreshold
  if (trained === null) {
    return '这一次打分一行都没判成正类，没有可比的阈值'
  }
  const gap = row.threshold - trained
  const at = `打分那一刀切在 ${niceNumber(trained)}`
  if (gap === 0) return `${at}，就停在这一档上：四个数与上面那张指标卡同源`
  const way = gap > 0 ? '高' : '低'
  const more = gap > 0 ? '判成正类的行更少' : '判成正类的行更多'
  return `${at}，这里${way}了 ${niceNumber(Math.abs(gap))}：门槛${way}了，${more}`
}

/**
 * 站定一档：混淆矩阵、四个指标与两行说明。
 *
 * Args: grid, seat 第几档。
 */
export function standAt(grid: ThresholdGrid, seat: number): ThresholdStand {
  const row = grid.rows[seat]
  if (row === undefined) return EMPTY_STAND
  const total =
    row.truePositive + row.falsePositive + row.trueNegative + row.falseNegative
  const right = row.truePositive + row.trueNegative
  return {
    text: row.text,
    labels: [POSITIVE_LABEL, NEGATIVE_LABEL],
    matrix: [
      [row.truePositive, row.falseNegative],
      [row.falsePositive, row.trueNegative],
    ],
    cards: cardsOf(row),
    summary: `阈值 ${row.text}：共 ${grouped(total)} 行，判对 ${grouped(right)} 行，判成正类 ${grouped(row.truePositive + row.falsePositive)} 行`,
    offset: offsetOf(row, grid),
  }
}

/** 网格两端那两档的写法；空网格给两个空串。Args: grid。 */
export function endsOf(grid: ThresholdGrid): ThresholdEnds {
  const low = grid.rows[0]
  const high = grid.rows[grid.rows.length - 1]
  if (low === undefined || high === undefined) return { low: '', high: '' }
  return { low: low.text, high: high.text }
}
