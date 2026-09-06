/**
 * @fileoverview 时间带的画幅算料：一条轴上的若干行、每行的占用段与断档、
 * 轴上的时刻标签、图下那几行结论。
 *
 * ⚠ 轴的上下界不走 `svgScale.bounds`：它在全等值时按「自身量级的一半」撑开，
 * 那条规则套到毫秒时间戳上会把一个瞬时点撑成半个纪元。这里按固定量撑。
 * ⚠ 时刻一律**本地时**显示（后端给的是 UTC RFC3339），换算走 `@dt/ui` 那一份，
 * 就地各写一遍必然静默差出一个时区。
 */
import { formatLocalMinute } from '@dt/ui'

import { grouped, percentText } from './numbers'
import type { Bounds } from './svgScale'
import { niceTicks, project } from './svgScale'

/** 轴量的是时刻还是行序。取数覆盖按时刻画，交叉验证的折按行区间画。 */
export type TimelineScale = 'time' | 'index'

/** 段的语义：主段 / 第二段（测试集）/ 「之前」（请求区间）/ 打乱重排。 */
export type TimelineTone = 'primary' | 'secondary' | 'requested' | 'shuffled'

export interface TimelineSegment {
  since: number
  until: number
  label: string
  tone: TimelineTone
}

export interface TimelineRow {
  name: string
  segments: readonly TimelineSegment[]
  /** 段与段之间的空隙画成断档。占用条要，切分与折的两色条不要。 */
  showGaps?: boolean
}

export interface TimelineInput {
  scale: TimelineScale
  rows: readonly TimelineRow[]
  /** 请求区间：轴至少要盖住它，实际比它短多少才看得出来。 */
  span: { low: number; high: number } | null
}

interface BarView {
  key: string
  left: number
  width: number
  /** 样式档：四种语义加上算出来的 `gap`。 */
  tone: string
  label: string
  title: string
}

interface RowView {
  key: string
  name: string
  fullName: string
  top: number
  labelTop: number
  bars: BarView[]
  gaps: BarView[]
}

/** 图例一项：语义 + 那一档在这份数据里叫什么。 */
interface LegendView {
  key: string
  tone: string
  text: string
}

/** 一根刻度：`at` 是它在画幅上的坐标，不是刻度值本身。 */
interface TickView {
  key: string
  at: number
  text: string
}

export interface TimelineView {
  viewBox: string
  /** 画幅四条边：左（名字列右缘）、右、上、横轴。 */
  plot: { left: number; right: number; top: number; baseline: number }
  rowHeight: number
  rows: RowView[]
  xTicks: TickView[]
  legend: LegendView[]
  /** 一行都没有：这一步压根没有时间带可画。 */
  isBlank: boolean
  summary: string
  notes: string[]
}

/** 画幅（SVG 用户坐标）。 */
const WIDTH = 360
const PAD_LEFT = 62
const PAD_RIGHT = 8
const PAD_TOP = 10
const ROW_H = 12
const ROW_GAP = 6
/** 横轴离最后一行这么远。 */
const AXIS_GAP = 6
/** 横轴下面留给刻度文字的高度。 */
const AXIS_ROOM = 16
/** 一个瞬时段也要看得见。 */
const MIN_BAR = 1
/** 最多画这么多行、每行最多这么多段。 */
const MAX_ROWS = 24
const MAX_SEGMENTS = 200
/** 名字列放得下这么多个字。 */
const NAME_CHARS = 7
/** 想要几根刻度。 */
const TICK_COUNT = 4
/** 刻度根数上限，防止步长算歪时空转。 */
const MAX_TICKS = 32

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
/** 时刻轴的步长只从这个梯子上挑，落在整分整时整天上才读得出来。 */
const STEPS: readonly number[] = [
  MINUTE,
  5 * MINUTE,
  15 * MINUTE,
  30 * MINUTE,
  HOUR,
  3 * HOUR,
  6 * HOUR,
  12 * HOUR,
  DAY,
  2 * DAY,
  7 * DAY,
  14 * DAY,
  30 * DAY,
  90 * DAY,
  180 * DAY,
  365 * DAY,
]
/** 这一档往上只写到月，再往下依次是日、日+时分、时分。 */
const MONTH_STEP = 300 * DAY
const STAMP_STEP = 6 * HOUR

/** 归一化之后的一段：起止已经摆正，`merged` 记着它代表了原来的几段。 */
interface Span {
  since: number
  until: number
  label: string
  tone: TimelineTone
  merged: number
}

/** 起止摆正、非有限值丢掉。⚠ 颠倒的区间不报错，只会画出负宽度的条。 */
function tidy(segments: readonly TimelineSegment[]): Span[] {
  const spans: Span[] = []
  for (const one of segments) {
    if (!Number.isFinite(one.since) || !Number.isFinite(one.until)) continue
    spans.push({
      since: Math.min(one.since, one.until),
      until: Math.max(one.since, one.until),
      label: one.label,
      tone: one.tone,
      merged: 1,
    })
  }
  return spans.sort((left, right) => left.since - right.since)
}

/** 同语义且首尾相接或重叠的两段并成一段，否则断档会算出负数。 */
function fused(spans: readonly Span[]): Span[] {
  const kept: Span[] = []
  for (const one of spans) {
    const last = kept[kept.length - 1]
    if (
      last !== undefined &&
      last.tone === one.tone &&
      one.since <= last.until
    ) {
      last.until = Math.max(last.until, one.until)
      last.merged += one.merged
      continue
    }
    kept.push({ ...one })
  }
  return kept
}

/** 超上限时留最长的那些：两端都还在，整段的跨度才不会缩水。 */
function capped(spans: readonly Span[]): Span[] {
  if (spans.length <= MAX_SEGMENTS) return [...spans]
  const lengthOf = (one: Span): number => one.until - one.since
  return [...spans]
    .sort((left, right) => lengthOf(right) - lengthOf(left))
    .slice(0, MAX_SEGMENTS)
    .sort((left, right) => left.since - right.since)
}

/** 不分语义地并一遍，用来算断档与覆盖率。 */
function merged(spans: readonly Span[]): Span[] {
  return fused(spans.map((one) => ({ ...one, tone: 'primary' as const })))
}

/** 占用段之外的那些空隙，含首尾两头。 */
function gapsOf(spans: readonly Span[], at: Bounds): Span[] {
  const gaps: Span[] = []
  const blank = (since: number, until: number): Span => ({
    since,
    until,
    label: '断档',
    tone: 'primary',
    merged: 1,
  })
  let edge = at.low
  for (const one of merged(spans)) {
    if (one.since > edge) gaps.push(blank(edge, one.since))
    edge = Math.max(edge, one.until)
  }
  if (edge < at.high) gaps.push(blank(edge, at.high))
  return gaps
}

/**
 * 轴的上下界；全等值时按固定量撑开。
 *
 * Args: values、scale（时刻按一分钟撑，行序按一行撑）。
 */
function axisOf(values: readonly number[], scale: TimelineScale): Bounds {
  let low = Number.POSITIVE_INFINITY
  let high = Number.NEGATIVE_INFINITY
  for (const value of values) {
    if (!Number.isFinite(value)) continue
    low = Math.min(low, value)
    high = Math.max(high, value)
  }
  const reach = scale === 'time' ? MINUTE : 1
  if (low > high) return { low: 0, high: reach }
  if (high > low) return { low, high }
  return { low: low - reach / 2, high: high + reach / 2 }
}

/** 时刻轴的步长：梯子上挑不到就一路翻倍。 */
function stepOf(span: number): number {
  for (const step of STEPS) {
    if (span / step <= TICK_COUNT) return step
  }
  let step = STEPS[STEPS.length - 1] ?? DAY
  while (span / step > TICK_COUNT) step *= 2
  return step
}

/** 这一档步长的时刻写到哪一位；跨年时日期档补上年份。 */
function textOf(stamp: number, step: number, crossesYear: boolean): string {
  const full = formatLocalMinute(stamp)
  if (step >= MONTH_STEP) return full.slice(0, 7)
  if (step >= DAY) return crossesYear ? full.slice(0, 10) : full.slice(5, 10)
  if (step >= STAMP_STEP) return full.slice(5, 16)
  return full.slice(11, 16)
}

/** 时刻刻度落在**本地时**的整点上：按 UTC 切出来的「整天」在东八区差 8 小时。 */
function timeTicks(at: Bounds, place: (value: number) => number): TickView[] {
  const step = stepOf(at.high - at.low)
  const shift = new Date(at.low).getTimezoneOffset() * MINUTE
  const year = (stamp: number): string => formatLocalMinute(stamp).slice(0, 4)
  const crossesYear = year(at.low) !== year(at.high)
  const tick = (stamp: number, index: number): TickView => ({
    key: `${index}:${stamp}`,
    at: place(stamp),
    text: textOf(stamp, step, crossesYear),
  })
  const ticks: TickView[] = []
  const first = Math.ceil((at.low - shift) / step) * step + shift
  for (let index = 0; index < MAX_TICKS; index += 1) {
    const stamp = first + index * step
    if (stamp > at.high) break
    ticks.push(tick(stamp, index))
  }
  // ⚠ 界内一根都排不下时给起点本身，不给空数组——空数组会让轴上一个字都没有
  return ticks.length > 0 ? ticks : [tick(at.low, 0)]
}

function indexTicks(at: Bounds, place: (value: number) => number): TickView[] {
  return niceTicks(at, TICK_COUNT).map((value, index) => ({
    key: `${index}:${value}`,
    at: place(value),
    text: grouped(Math.round(value)),
  }))
}

/** 一个时刻/行序写全了是什么样。 */
function fullText(value: number, scale: TimelineScale): string {
  if (scale === 'index') return `第 ${grouped(Math.round(value))} 行`
  return formatLocalMinute(value)
}

function barsOf(
  spans: readonly Span[],
  scale: TimelineScale,
  place: (value: number) => number,
  as: { prefix: string; tone?: string },
): BarView[] {
  return spans.map((one, index) => {
    const left = place(one.since)
    const tail = one.merged > 1 ? ` 等 ${grouped(one.merged)} 段` : ''
    const range = `${fullText(one.since, scale)} ~ ${fullText(one.until, scale)}`
    return {
      key: `${as.prefix}:${index}:${one.since}`,
      left,
      width: Math.max(MIN_BAR, place(one.until) - left),
      tone: as.tone ?? one.tone,
      label: one.label,
      title: `${one.label}${tail}：${range}`,
    }
  })
}

/** 这一行覆盖了轴的百分之多少。 */
function coverageOf(spans: readonly Span[], at: Bounds): number {
  const whole = at.high - at.low
  if (!(whole > 0)) return 0
  let covered = 0
  for (const one of merged(spans)) {
    covered += Math.min(one.until, at.high) - Math.max(one.since, at.low)
  }
  return (Math.max(covered, 0) / whole) * 100
}

/** 图下那几行给所有人看的结论（规格 P6）。 */
function noteOf(
  row: TimelineRow,
  spans: readonly Span[],
  gaps: readonly Span[],
  at: Bounds,
): string {
  if (row.showGaps !== true) return ''
  if (spans.length === 0) return `${row.name}：整段一行数据都没有`
  if (gaps.length === 0) return `${row.name}：整段都有数据`
  const share = percentText(coverageOf(spans, at))
  return `${row.name}：覆盖 ${share}，${grouped(gaps.length)} 段断档`
}

/** 图例只列这份数据里真出现过的那几档。 */
function legendOf(rows: readonly RowView[]): LegendView[] {
  const seen = new Map<string, LegendView>()
  for (const row of rows) {
    for (const bar of [...row.bars, ...row.gaps]) {
      const key = `${bar.tone}:${bar.label}`
      if (!seen.has(key))
        seen.set(key, { key, tone: bar.tone, text: bar.label })
    }
  }
  return [...seen.values()]
}

function shortName(name: string): string {
  return name.length > NAME_CHARS ? `${name.slice(0, NAME_CHARS)}…` : name
}

/** 每行归一化之后的段：`all` 是并完重叠的段数，`kept` 是真画出来的那些。 */
interface RowSpans {
  all: number
  kept: Span[]
}

function spansOf(row: TimelineRow): RowSpans {
  const clean = fused(tidy(row.segments))
  return { all: clean.length, kept: capped(clean) }
}

/** 所有行共用的那把尺子与写法。 */
interface Frame {
  scale: TimelineScale
  at: Bounds
  place: (value: number) => number
}

function rowViewOf(
  row: TimelineRow,
  spans: RowSpans,
  index: number,
  frame: Frame,
): { view: RowView; notes: string[] } {
  const gaps = row.showGaps === true ? gapsOf(spans.kept, frame.at) : []
  const top = PAD_TOP + index * (ROW_H + ROW_GAP)
  const notes: string[] = []
  const note = noteOf(row, spans.kept, gaps, frame.at)
  if (note !== '') notes.push(note)
  if (spans.all > spans.kept.length) {
    notes.push(
      `${row.name}：段太多，最短的那些没画（合并重叠后共 ${grouped(spans.all)} 段，画了 ${grouped(spans.kept.length)} 段）`,
    )
  }
  return {
    view: {
      key: `${index}:${row.name}`,
      name: shortName(row.name),
      fullName: row.name,
      top,
      labelTop: top + ROW_H - 3,
      bars: barsOf(spans.kept, frame.scale, frame.place, {
        prefix: `b${index}`,
      }),
      gaps: barsOf(gaps, frame.scale, frame.place, {
        prefix: `g${index}`,
        tone: 'gap',
      }),
    },
    notes,
  }
}

/**
 * 把一份时间带数据折成画幅上的几何。
 *
 * ⚠ 所有行共用一把横向尺子：分开算的话「测试段是不是真的在训练段之后」
 * 这个问题就问不出来了。
 * Args: input。
 */
export function timelineGeometry(input: TimelineInput): TimelineView {
  const right = WIDTH - PAD_RIGHT
  const rows = input.rows.slice(0, MAX_ROWS)
  const tidied = rows.map(spansOf)
  const edges = tidied.flatMap(({ kept }) =>
    kept.flatMap((one) => [one.since, one.until]),
  )
  if (input.span !== null) edges.push(input.span.low, input.span.high)
  const at = axisOf(edges, input.scale)
  const frame: Frame = {
    scale: input.scale,
    at,
    place: (value) => project(value, at, right + PAD_LEFT, PAD_LEFT),
  }
  const notes: string[] = []
  const views: RowView[] = rows.map((row, index) => {
    const built = rowViewOf(
      row,
      tidied[index] ?? { all: 0, kept: [] },
      index,
      frame,
    )
    notes.push(...built.notes)
    return built.view
  })
  if (input.rows.length > rows.length) {
    notes.push(`还有 ${grouped(input.rows.length - rows.length)} 行没有画出来`)
  }
  const baseline =
    PAD_TOP + Math.max(rows.length, 1) * (ROW_H + ROW_GAP) - ROW_GAP + AXIS_GAP
  const hasBars = tidied.some(({ kept }) => kept.length > 0)
  const range = `${fullText(at.low, input.scale)} ~ ${fullText(at.high, input.scale)}`
  return {
    viewBox: `0 0 ${WIDTH} ${baseline + AXIS_ROOM}`,
    plot: { left: PAD_LEFT, right, top: PAD_TOP, baseline },
    rowHeight: ROW_H,
    rows: views,
    xTicks:
      input.scale === 'time'
        ? timeTicks(at, frame.place)
        : indexTicks(at, frame.place),
    legend: legendOf(views),
    isBlank: rows.length === 0 || (!hasBars && input.span === null),
    summary:
      input.scale === 'time' ? `轴上 ${range}（本机时区）` : `轴上 ${range}`,
    notes,
  }
}
