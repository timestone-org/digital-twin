/**
 * @fileoverview 散点四态的画幅算料：抽样后的点、理想对角线、横向参考线与 ±σ 带、
 * 双轴刻度、图下那行结论。四态共用同一把尺子，只有参考几何与轴的绑法不同。
 *
 * ⚠ 逻辑放在这里而不是组件里，是因为退化分支（空序列 / 全等值 / 超上限抽样 /
 * 参考线落在数据之外）只有当纯函数才测得到——挂载测试量不出一个点的位置。
 */
import { grouped, niceNumber } from './numbers'
import type { Bounds } from './svgScale'
import { bounds, niceTicks, project } from './svgScale'

/** 四态：真值对预测 / 残差诊断 / 按行序或时间的序列 / 正态 QQ。 */
export type ScatterMode = 'pairs' | 'residual' | 'series' | 'qq'

export type ScatterPoint = readonly [number, number]

export type ScatterDraw = 'dots' | 'line' | 'both'

/** 一路序列；`isBefore` 那一路画成空心描边，即规格 §7 的「之前」。 */
export interface ScatterSeries {
  name: string
  points: readonly ScatterPoint[]
  draw?: ScatterDraw
  isBefore?: boolean
}

/** 一条横向参考线：零残差线、累计重要性的 80% 线都走它。 */
export interface ScatterRule {
  at: number
  label: string
  intent: 'reference' | 'threshold'
}

/** 纵向的一条带：±1σ 走它。 */
export interface ScatterBand {
  low: number
  high: number
  label: string
}

export interface ScatterInput {
  mode: ScatterMode
  series: readonly ScatterSeries[]
  rules: readonly ScatterRule[]
  band: ScatterBand | null
}

/** 标记形状：颜色之外的第二重编码，三种轮着来。 */
export type ScatterShape = 'circle' | 'square' | 'diamond'

interface SeriesView {
  key: string
  name: string
  /** 样式档：`before` 是空心描边，`t0`–`t5` 是系列色轮。 */
  tone: string
  shape: ScatterShape
  dotsPath: string
  linePoints: string
}

interface RuleView {
  key: string
  intent: ScatterRule['intent']
  top: number
  labelTop: number
  text: string
}

interface BandView {
  top: number
  height: number
  labelTop: number
  label: string
}

/** 一根刻度：`at` 是它在画幅上的坐标，不是刻度值本身。 */
interface TickView {
  key: string
  at: number
  text: string
}

interface DiagonalView {
  x1: number
  y1: number
  x2: number
  y2: number
}

export interface ScatterView {
  viewBox: string
  /** 画幅四条边：左、右、上、横轴。 */
  plot: { left: number; right: number; top: number; baseline: number }
  series: SeriesView[]
  /** 理想线；只有两轴同尺的 pairs 与 qq 有。 */
  diagonal: DiagonalView | null
  drawnRules: RuleView[]
  /** 落在这段数据之外的参考线：不画到框外去，改成图下一行字。 */
  strayRules: RuleView[]
  band: BandView | null
  xTicks: TickView[]
  yTicks: TickView[]
  hasLegend: boolean
  /** 一个点都没有：这一步压根没有散点可画。 */
  isBlank: boolean
  summary: string
  sampledNote: string
}

/** 画幅（SVG 用户坐标）。 */
const WIDTH = 360
const HEIGHT = 182
const PAD_LEFT = 38
const PAD_RIGHT = 8
const PAD_TOP = 14
/** 横轴那条线的纵坐标。 */
const BASELINE = 148
const DOT_R = 2.2
/** 一路序列最多画这么多点。 */
const MAX_POINTS = 500
/** 系列色轮有这么多档，多出来的绕回去。 */
const TONES = 6
const SHAPES: readonly ScatterShape[] = ['circle', 'square', 'diamond']
/** 参考线贴着上边框时标签改摆到线下面。 */
const LABEL_KEEPOUT = 10

/** 把值折进画幅的两把尺子。 */
interface Scale {
  x: (value: number) => number
  y: (value: number) => number
}

/**
 * 等距抽样到上限以内。
 *
 * ⚠ 不能头切：时序数据上头切等于只看最早那一段，异方差与漂移正好在后半段。
 * Args: points（非有限值直接丢掉）。
 */
function sampled(points: readonly ScatterPoint[]): {
  kept: ScatterPoint[]
  total: number
} {
  const clean = points.filter(
    ([x, y]) => Number.isFinite(x) && Number.isFinite(y),
  )
  if (clean.length <= MAX_POINTS) return { kept: clean, total: clean.length }
  const stride = (clean.length - 1) / (MAX_POINTS - 1)
  const kept: ScatterPoint[] = []
  for (let index = 0; index < MAX_POINTS; index += 1) {
    const point = clean[Math.round(index * stride)]
    if (point !== undefined) kept.push(point)
  }
  return { kept, total: clean.length }
}

/** 一个标记的路径。整路序列拼成一个 `<path>`，五百个点也只落一个节点。 */
function marker(shape: ScatterShape, left: number, top: number): string {
  const x = Number(left.toFixed(2))
  const y = Number(top.toFixed(2))
  const wide = DOT_R * 2
  if (shape === 'square') {
    return `M${x - DOT_R},${y - DOT_R}h${wide}v${wide}h${-wide}Z`
  }
  if (shape === 'diamond') {
    return `M${x},${y - DOT_R}L${x + DOT_R},${y}L${x},${y + DOT_R}L${x - DOT_R},${y}Z`
  }
  return `M${x - DOT_R},${y}a${DOT_R},${DOT_R} 0 1,0 ${wide},0a${DOT_R},${DOT_R} 0 1,0 ${-wide},0`
}

/** 这一路要不要画线；⚠ 只有一个点的折线在 SVG 上什么都不画，会静默消失。 */
function drawOf(
  one: ScatterSeries,
  mode: ScatterMode,
  count: number,
): ScatterDraw {
  const wanted = one.draw ?? (mode === 'series' ? 'line' : 'dots')
  return wanted === 'line' && count < 2 ? 'dots' : wanted
}

/** 抽样之后的一路序列：画出来的那些点，加上抽样前的总数。 */
interface Prepared {
  one: ScatterSeries
  kept: ScatterPoint[]
  total: number
}

function prepare(series: readonly ScatterSeries[]): Prepared[] {
  return series.map((one) => {
    const { kept, total } = sampled(one.points)
    return { one, kept, total }
  })
}

function seriesOf(
  ready: readonly Prepared[],
  mode: ScatterMode,
  scale: Scale,
): SeriesView[] {
  const views: SeriesView[] = []
  let ordinal = 0
  ready.forEach(({ one, kept }, index) => {
    if (kept.length === 0) return
    const draw = drawOf(one, mode, kept.length)
    const shape = SHAPES[ordinal % SHAPES.length] ?? 'circle'
    const tone = one.isBefore === true ? 'before' : `t${ordinal % TONES}`
    if (one.isBefore !== true) ordinal += 1
    const spots = kept.map(([x, y]) => [scale.x(x), scale.y(y)] as const)
    views.push({
      key: `${index}:${one.name}`,
      name: one.name,
      tone,
      shape,
      dotsPath:
        draw === 'line'
          ? ''
          : spots.map(([x, y]) => marker(shape, x, y)).join(''),
      linePoints:
        draw === 'dots'
          ? ''
          : spots.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' '),
    })
  })
  return views
}

/** 残差态自带一条零线：不画它就看不出系统性偏差偏到哪一边。 */
function rulesOf(input: ScatterInput): ScatterRule[] {
  if (input.mode !== 'residual') return [...input.rules]
  return [{ at: 0, label: '零残差', intent: 'reference' }, ...input.rules]
}

function placeRules(
  rules: readonly ScatterRule[],
  at: Bounds,
  scale: Scale,
): { drawn: RuleView[]; stray: RuleView[] } {
  const drawn: RuleView[] = []
  const stray: RuleView[] = []
  rules.forEach((rule, index) => {
    const top = scale.y(rule.at)
    const tight = top < PAD_TOP + LABEL_KEEPOUT
    const view: RuleView = {
      key: `${index}:${rule.label}`,
      intent: rule.intent,
      top,
      labelTop: top + (tight ? 9 : -3),
      text: `${rule.label} ${niceNumber(rule.at)}`,
    }
    if (rule.at >= at.low && rule.at <= at.high) drawn.push(view)
    else stray.push(view)
  })
  return { drawn, stray }
}

function bandOf(band: ScatterBand | null, scale: Scale): BandView | null {
  if (band === null || !(band.high > band.low)) return null
  const top = scale.y(band.high)
  return {
    top,
    height: scale.y(band.low) - top,
    labelTop: top - 2,
    label: band.label,
  }
}

/** 两轴的上下界；pairs 与 qq 必须同尺，否则那条对角线什么也不代表。 */
function axesOf(
  input: ScatterInput,
  ready: readonly Prepared[],
): { x: Bounds; y: Bounds } {
  const xs: number[] = []
  const ys: number[] = []
  for (const { kept } of ready) {
    for (const [x, y] of kept) {
      xs.push(x)
      ys.push(y)
    }
  }
  if (input.mode === 'pairs' || input.mode === 'qq') {
    const both = bounds([...xs, ...ys])
    return { x: both, y: both }
  }
  const extra = input.mode === 'residual' ? [0] : []
  if (input.band !== null) extra.push(input.band.low, input.band.high)
  return { x: bounds(xs), y: bounds([...ys, ...extra]) }
}

function ticksOf(
  values: readonly number[],
  place: (value: number) => number,
): TickView[] {
  return values.map((value, index) => ({
    key: `${index}:${value}`,
    at: place(value),
    text: niceNumber(value),
  }))
}

/** 图下那行给所有人看的结论（规格 P6）。 */
function summaryOf(
  input: ScatterInput,
  drawn: number,
  at: { x: Bounds; y: Bounds },
): string {
  if (drawn === 0) return '共 0 个点'
  const count = `共 ${grouped(drawn)} 个点`
  if (input.mode === 'pairs' || input.mode === 'qq') {
    const range = `${niceNumber(at.x.low)} ~ ${niceNumber(at.x.high)}`
    return `${count}；两轴同尺 ${range}，对角线是理想线`
  }
  const across = `横轴 ${niceNumber(at.x.low)} ~ ${niceNumber(at.x.high)}`
  const up = `纵轴 ${niceNumber(at.y.low)} ~ ${niceNumber(at.y.high)}`
  return `${count}；${across}，${up}`
}

/**
 * 把一份散点数据折成画幅上的几何。
 *
 * ⚠ 抽样发生在定界之前：画出来的那些点自己说了算，免得轴的两端挂着一个
 * 根本没画的极值。
 * Args: input。
 */
export function scatterGeometry(input: ScatterInput): ScatterView {
  const right = WIDTH - PAD_RIGHT
  const ySpan = PAD_TOP + BASELINE
  const ready = prepare(input.series)
  const at = axesOf(input, ready)
  const scale: Scale = {
    x: (value) => project(value, at.x, right + PAD_LEFT, PAD_LEFT),
    y: (value) => ySpan - project(value, at.y, ySpan, PAD_TOP),
  }
  const views = seriesOf(ready, input.mode, scale)
  const rules = placeRules(rulesOf(input), at.y, scale)
  const same = input.mode === 'pairs' || input.mode === 'qq'
  let drawn = 0
  let total = 0
  for (const { kept, total: all } of ready) {
    if (kept.length === 0) continue
    drawn += kept.length
    total += all
  }
  return {
    viewBox: `0 0 ${WIDTH} ${HEIGHT}`,
    plot: { left: PAD_LEFT, right, top: PAD_TOP, baseline: BASELINE },
    series: views,
    diagonal: same
      ? {
          x1: scale.x(at.x.low),
          y1: scale.y(at.y.low),
          x2: scale.x(at.x.high),
          y2: scale.y(at.y.high),
        }
      : null,
    drawnRules: rules.drawn,
    strayRules: rules.stray,
    band: bandOf(input.band, scale),
    xTicks: ticksOf(niceTicks(at.x, 4), scale.x),
    yTicks: ticksOf(niceTicks(at.y, 4), scale.y),
    hasLegend: views.length > 1 || views.some((one) => one.tone === 'before'),
    isBlank: drawn === 0,
    summary: summaryOf(input, drawn, at),
    sampledNote:
      total > drawn
        ? `点太多，等距抽了 ${grouped(drawn)} 个画出来（原 ${grouped(total)} 个）——不是只画最早那一段`
        : '',
  }
}
