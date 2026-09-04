/**
 * @fileoverview 直方图的画幅算料：柱、参考线、离轴柱、正态曲线、刻度与结论那行字。
 *
 * ⚠ 逻辑放在这里而不是组件里，是因为退化分支（空箱 / 全零 / 计数极不均衡 /
 * 参考线落在数据之外）只有当纯函数才测得到——挂载测试量不出一根柱的高度。
 */
import { grouped, niceNumber, percentText } from './numbers'
import type { Bounds } from './svgScale'
import { bounds, niceTicks, project } from './svgScale'

/** 一根柱：这个区间里落了多少行，其中多少行被丢弃或被裁剪。 */
export interface HistogramBin {
  low: number
  high: number
  count: number
  dropped?: number
}

/** 一条参考竖线：阈值、分位界、零误差线都走它。 */
export interface HistogramMark {
  at: number
  label: string
  intent: 'danger' | 'warning' | 'info'
}

/** 数轴上没有位置的那一类行（因空值被丢的那些）。 */
export interface OffAxisBar {
  label: string
  count: number
}

/** 正态参考曲线的两个参数。 */
export interface NormalCurve {
  mean: number
  sd: number
}

export interface HistogramInput {
  bins: readonly HistogramBin[]
  marks: readonly HistogramMark[]
  offAxis: OffAxisBar | null
  curve: NormalCurve | null
  droppedLabel: string
}

interface BarView {
  key: string
  left: number
  width: number
  keptTop: number
  keptHeight: number
  dropTop: number
  dropHeight: number
  title: string
}

interface MarkView {
  key: string
  intent: HistogramMark['intent']
  left: number
  labelLeft: number
  anchor: 'start' | 'end'
  /** 标签这一行的基线，与 `lineTop` 一同随错行上移。 */
  labelTop: number
  lineTop: number
  text: string
}

/** 一根刻度：`at` 是它在画幅上的坐标，不是刻度值本身。 */
interface TickView {
  key: string
  at: number
  text: string
}

interface OffAxisView {
  label: string
  left: number
  width: number
  top: number
  height: number
  title: string
}

export interface HistogramView {
  viewBox: string
  /** 画幅四条边：左、右（离轴柱那一栏在它右边）、上、横轴。 */
  plot: { left: number; right: number; top: number; baseline: number }
  bars: BarView[]
  drawnMarks: MarkView[]
  /** 落在这段数据之外的参考线：不画到框外去，改成图下一行字。 */
  strayMarks: MarkView[]
  curvePoints: string
  offAxis: OffAxisView | null
  xTicks: TickView[]
  yTicks: TickView[]
  hasDropped: boolean
  /** 一根柱也没有、离轴柱也没有：这一步压根没有分布可画。 */
  isBlank: boolean
  summary: string
}

/** 画幅（SVG 用户坐标）。 */
const WIDTH = 360
const HEIGHT = 182
const PAD_LEFT = 34
const PAD_RIGHT = 6
const PAD_TOP = 12
/** 横轴那条线的纵坐标。 */
const BASELINE = 148
/** 离轴柱独占的那一栏。 */
const OFF_AXIS_WIDTH = 48
const BAR_GAP = 1
/** 非零计数至少这么高。 */
const MIN_BAR = 1
const CURVE_STEPS = 48
/** 标签与自己那条线之间的横向留白。 */
const LABEL_GAP = 3
/** 两个标签之间至少留这么宽，挨得比这更近就换一行摆。 */
const LABEL_CLEAR = 4
/** 标签最多错开这么多行；再多就摞到柱区里去了。 */
const MAX_LABEL_ROW = 1
/** 错开一行往上让这么高，画幅顶部跟着让出同样多。 */
const ROW_STEP = 9
/** 估宽用：7px 字号（见 `HistogramChart` 的 `text`）下全角一个字的宽度。 */
const GLYPH = 7
/** 半角（数字、拉丁字母、空格）按这么宽估。 */
const HALF_GLYPH = 3.9
/** 全角起点：这个码位往上按一个字宽算。 */
const WIDE_FROM = 0x2e80

/** 横向那把尺子：标签避让只用得着它，纵向要等标签排完行才定得下来。 */
interface Across {
  right: number
  x: (value: number) => number
}

/** 把值折进画幅的两把尺子。 */
interface Scale extends Across {
  y: (count: number) => number
}

/** 这根柱里真正算被丢弃的行数：负数与超过总数的都夹回去。 */
function droppedOf(bin: HistogramBin): number {
  return Math.min(Math.max(bin.dropped ?? 0, 0), Math.max(bin.count, 0))
}

/** 一段柱的高度；非零计数至少留 `MIN_BAR`，免得 1 比 1000 时整段消失。 */
function heightOf(count: number, scale: Scale): number {
  return count > 0 ? Math.max(MIN_BAR, BASELINE - scale.y(count)) : 0
}

function barsOf(
  bins: readonly HistogramBin[],
  droppedLabel: string,
  scale: Scale,
): BarView[] {
  return bins.map((bin, at) => {
    const dropped = droppedOf(bin)
    const rows = Math.max(bin.count, 0)
    const keptHeight = heightOf(rows - dropped, scale)
    const dropHeight = heightOf(dropped, scale)
    const left = scale.x(bin.low)
    const range = `${niceNumber(bin.low)} ~ ${niceNumber(bin.high)}`
    const tail =
      dropped > 0 ? `，其中 ${grouped(dropped)} 行${droppedLabel}` : ''
    return {
      key: `${at}:${bin.low}:${bin.high}`,
      left,
      width: Math.max(1, scale.x(bin.high) - left - BAR_GAP),
      keptTop: BASELINE - keptHeight,
      keptHeight,
      dropTop: BASELINE - keptHeight - dropHeight,
      dropHeight,
      title: `${range}：${grouped(rows)} 行${tail}`,
    }
  })
}

/** 标签在画幅上大致多宽：全角一个字宽，半角半个字宽。 */
function textWidth(text: string): number {
  let wide = 0
  for (const glyph of text) {
    wide += (glyph.codePointAt(0) ?? 0) >= WIDE_FROM ? GLYPH : HALF_GLYPH
  }
  return wide
}

/** 一条线连同它标签占的横向区间；`row` 由避让那一趟填，-1 是不画字。 */
interface Slot {
  readonly mark: HistogramMark
  readonly key: string
  readonly left: number
  readonly labelLeft: number
  readonly anchor: 'start' | 'end'
  readonly from: number
  readonly to: number
  readonly text: string
  readonly inside: boolean
  row: number
}

/** 写不下就翻成右对齐；翻不翻由这条标签的实际宽度定，不是一个定死的边距。 */
function slotOf(
  mark: HistogramMark,
  index: number,
  at: Bounds,
  across: Across,
): Slot {
  const left = across.x(mark.at)
  const text = `${mark.label} ${niceNumber(mark.at)}`
  const wide = textWidth(text)
  const tight = left + LABEL_GAP + wide > across.right
  return {
    mark,
    key: `${index}:${mark.label}`,
    left,
    labelLeft: left + (tight ? -LABEL_GAP : LABEL_GAP),
    anchor: tight ? 'end' : 'start',
    from: tight ? left - LABEL_GAP - wide : left + LABEL_GAP,
    to: tight ? left - LABEL_GAP : left + LABEL_GAP + wide,
    text,
    inside: mark.at >= at.low && mark.at <= at.high,
    row: 0,
  }
}

/**
 * 标签避让：按左端排一遍，落进第一条塞得下的行；两行都塞不下的不画字，改由
 * 结论那行点名。
 *
 * ⚠ `clip_outlier` 这类算子一次给三条线是常态，只按「贴右边翻转」那一档摆，
 * 中间那条与右边那条一定叠成乱码。
 * Args: slots 画得出来的那几条，就地写回 `row`。
 */
function stagger(slots: readonly Slot[]): number {
  const ends: number[] = []
  for (const slot of [...slots].sort((one, two) => one.from - two.from)) {
    const seat = ends.findIndex((end) => end + LABEL_CLEAR <= slot.from)
    if (seat >= 0) {
      ends[seat] = slot.to
      slot.row = seat
    } else if (ends.length <= MAX_LABEL_ROW) {
      slot.row = ends.length
      ends.push(slot.to)
    } else {
      slot.row = -1
    }
  }
  return ends.length
}

/** 排完行才知道画幅顶部要让出多少，标签与线的纵坐标一起在这里落。 */
function markOf(slot: Slot, padTop: number): MarkView {
  const labelTop = padTop - 1 - Math.max(slot.row, 0) * ROW_STEP
  return {
    key: slot.key,
    intent: slot.mark.intent,
    left: slot.left,
    labelLeft: slot.labelLeft,
    anchor: slot.anchor,
    labelTop,
    lineTop: labelTop - 5,
    text: slot.row < 0 ? '' : slot.text,
  }
}

/** 正态参考曲线：与直方同一套坐标，按「总行数 × 箱宽 × 密度」折成计数。 */
function curveOf(
  input: HistogramInput,
  rows: number,
  at: Bounds,
  scale: Scale,
): string {
  const curve = input.curve
  if (
    curve === null ||
    !(curve.sd > 0) ||
    input.bins.length === 0 ||
    rows === 0
  )
    return ''
  const span = at.high - at.low
  const peak =
    (rows * (span / input.bins.length)) / (curve.sd * Math.sqrt(2 * Math.PI))
  const points: string[] = []
  for (let step = 0; step <= CURVE_STEPS; step += 1) {
    const value = at.low + (span * step) / CURVE_STEPS
    const away = (value - curve.mean) / curve.sd
    const count = peak * Math.exp(-(away * away) / 2)
    points.push(`${scale.x(value).toFixed(2)},${scale.y(count).toFixed(2)}`)
  }
  return points.join(' ')
}

function offAxisOf(off: OffAxisBar | null, scale: Scale): OffAxisView | null {
  if (off === null || off.count <= 0) return null
  const height = heightOf(off.count, scale)
  return {
    label: off.label,
    left: WIDTH - PAD_RIGHT - OFF_AXIS_WIDTH + 12,
    width: OFF_AXIS_WIDTH - 24,
    top: BASELINE - height,
    height,
    title: `${off.label}：${grouped(off.count)} 行（不在这条轴上）`,
  }
}

function ticksOf(
  values: readonly number[],
  as: (value: number) => string,
  place: (value: number) => number,
): TickView[] {
  return values.map((value, index) => ({
    key: `${index}:${value}`,
    at: place(value),
    text: as(value),
  }))
}

/** 图下那行给所有人看的结论（规格 P6）。 */
function summaryOf(
  input: HistogramInput,
  rows: number,
  dropped: number,
  off: OffAxisView | null,
  crowded: readonly string[],
): string {
  const parts = [`轴上共 ${grouped(rows)} 行`]
  if (dropped > 0) {
    const share = percentText((dropped / rows) * 100)
    parts.push(`${input.droppedLabel} ${grouped(dropped)} 行（${share}）`)
  }
  if (off !== null) parts.push(off.title)
  // 挤掉的标签在这里点名，图上少一行字不等于这条线没了
  if (crowded.length > 0) {
    parts.push(`${crowded.join('、')} 与相邻的线挤在一处，标签没画在图上`)
  }
  return parts.join('；')
}

/**
 * 参考线的落位与画幅顶部要让出的高度：标签排了几行，顶部就让几行。
 * Args: marks 原样的那几条；at 数据的两端；across 横向那把尺子。
 */
function placeMarks(
  marks: readonly HistogramMark[],
  at: Bounds,
  across: Across,
): { inside: Slot[]; stray: Slot[]; padTop: number } {
  const slots = marks.map((mark, seat) => slotOf(mark, seat, at, across))
  const inside = slots.filter((slot) => slot.inside)
  return {
    inside,
    stray: slots.filter((slot) => !slot.inside),
    padTop: PAD_TOP + Math.max(stagger(inside) - 1, 0) * ROW_STEP,
  }
}

/** 这一屏的行数账：轴上一共几行、其中几行被丢弃。 */
function tallyOf(bins: readonly HistogramBin[]): {
  rows: number
  dropped: number
} {
  let rows = 0
  let dropped = 0
  for (const bin of bins) {
    rows += Math.max(bin.count, 0)
    dropped += droppedOf(bin)
  }
  return { rows, dropped }
}

/**
 * 把一份直方数据折成画幅上的几何。
 *
 * ⚠ 离轴柱与柱共用同一把纵向尺子：它一高，别的柱就该被压扁——同屏的行数账
 * 必须对得上，宁可挤也不许各画各的。
 * Args: input。
 */
export function histogramGeometry(input: HistogramInput): HistogramView {
  const off = input.offAxis
  const right =
    WIDTH - PAD_RIGHT - (off === null || off.count <= 0 ? 0 : OFF_AXIS_WIDTH)
  const at = bounds(input.bins.flatMap((bin) => [bin.low, bin.high]))
  const { rows, dropped } = tallyOf(input.bins)
  const tall = Math.max(
    1,
    ...input.bins.map((bin) => Math.max(bin.count, 0)),
    off === null ? 0 : off.count,
  )
  const across: Across = {
    right,
    x: (value) => project(value, at, right + PAD_LEFT, PAD_LEFT),
  }
  // 标签只吃横轴：先排出要几行，画幅顶部再按行数让位，柱子跟着矮下去
  const marks = placeMarks(input.marks, at, across)
  const padTop = marks.padTop
  const ySpan = padTop + BASELINE
  const scale: Scale = {
    ...across,
    y: (count) => ySpan - project(count, { low: 0, high: tall }, ySpan, padTop),
  }
  const offView = offAxisOf(off, scale)
  return {
    viewBox: `0 0 ${WIDTH} ${HEIGHT}`,
    plot: { left: PAD_LEFT, right, top: padTop, baseline: BASELINE },
    bars: barsOf(input.bins, input.droppedLabel, scale),
    drawnMarks: marks.inside.map((slot) => markOf(slot, padTop)),
    strayMarks: marks.stray.map((slot) => markOf(slot, padTop)),
    curvePoints: curveOf(input, rows, at, scale),
    offAxis: offView,
    xTicks: ticksOf(niceTicks(at, 4), niceNumber, scale.x),
    // ⚠ 纵轴量的是行数：小数刻度会印出「0.5 行」这种不存在的读数
    yTicks: ticksOf(
      niceTicks({ low: 0, high: tall }, 3).filter(Number.isInteger),
      grouped,
      scale.y,
    ),
    hasDropped: dropped > 0,
    isBlank: input.bins.length === 0 && offView === null,
    summary: summaryOf(
      input,
      rows,
      dropped,
      offView,
      marks.inside.filter((slot) => slot.row < 0).map((slot) => slot.text),
    ),
  }
}
