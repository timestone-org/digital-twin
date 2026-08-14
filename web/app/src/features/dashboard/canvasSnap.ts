/**
 * @fileoverview 画布吸附的纯算术：像素步进/虚拟栅格两种模式、方向键步长、
 * 智能参考线（边线对齐）与栅格导引背景。配置持久化在 `chromeJson.editor` 下，
 * 运行时渲染永不读取——栅格只是编辑器的吸附辅助，不是布局模型。
 */
import type { DesignSize, ModuleRect, NodeBox } from '@dt/runtime'

/** 吸附配置，持久化于 `chromeJson.editor.snap`。 */
export interface SnapConfig {
  /** `grid` 吸附虚拟栅格线；`px` 吸附固定像素步进。 */
  mode: 'grid' | 'px'
  /** `px` 模式的步进；`grid` 模式忽略。 */
  step: number
  /** 总开关；关掉即自由像素放置。 */
  enabled: boolean
  /** 智能参考线：命中时优先于步进吸附；按住 Alt 时与步进一并失效。 */
  guides: boolean
}

/** 编辑器虚拟栅格，持久化于 `chromeJson.editor.grid`。 */
export interface EditorGridConfig {
  cols: number
  rows: number
  marginX: number
  marginY: number
}

export const DEFAULT_SNAP_STEP = 8
export const SNAP_STEP_PRESETS: readonly number[] = [1, 5, 8, 10]

export const GRID_COLS_DEFAULT = 24
export const GRID_ROWS_DEFAULT = 30
export const GRID_MARGIN_DEFAULT = 8
export const GRID_COLS_MIN = 12
export const GRID_COLS_MAX = 96
export const GRID_ROWS_MIN = 12
export const GRID_ROWS_MAX = 120
export const GRID_MARGIN_MIN = 0
export const GRID_MARGIN_MAX = 24

/**
 * 智能吸附的**屏幕**像素阈值；除以舞台缩放才是设计像素阈值。
 * ⚠ 不换算的话，缩得越小吸附圈在屏幕上就越小，缩到 25% 时基本吸不上。
 */
export const SMART_SNAP_SCREEN_PX = 6

function clampInt(
  value: unknown,
  fallback: number,
  low: number,
  high: number,
): number {
  const n = Math.round(Number(value))
  if (!Number.isFinite(n)) return fallback
  return Math.min(high, Math.max(low, n))
}

/** 归一化吸附配置，容错脏数据；缺省 grid + 步进 8 + 开 + 参考线开。 */
export function normalizeSnapConfig(
  raw?: Partial<SnapConfig> | null,
): SnapConfig {
  return {
    mode: raw?.mode === 'px' ? 'px' : 'grid',
    step: clampInt(raw?.step, DEFAULT_SNAP_STEP, 1, 512),
    enabled: raw?.enabled !== false,
    guides: raw?.guides !== false,
  }
}

/** 归一化虚拟栅格配置，越界值夹回。 */
export function normalizeEditorGrid(
  raw?: Partial<EditorGridConfig> | null,
): EditorGridConfig {
  return {
    cols: clampInt(raw?.cols, GRID_COLS_DEFAULT, GRID_COLS_MIN, GRID_COLS_MAX),
    rows: clampInt(raw?.rows, GRID_ROWS_DEFAULT, GRID_ROWS_MIN, GRID_ROWS_MAX),
    marginX: clampInt(
      raw?.marginX,
      GRID_MARGIN_DEFAULT,
      GRID_MARGIN_MIN,
      GRID_MARGIN_MAX,
    ),
    marginY: clampInt(
      raw?.marginY,
      GRID_MARGIN_DEFAULT,
      GRID_MARGIN_MIN,
      GRID_MARGIN_MAX,
    ),
  }
}

/** 栅格线的像素周期与起始偏移：pitch = (边长 − margin) / 格数。 */
function gridPitch(
  design: DesignSize,
  grid: EditorGridConfig,
): { px: number; py: number; offX: number; offY: number } {
  return {
    px: grid.cols > 0 ? (design.width - grid.marginX) / grid.cols : 0,
    py: grid.rows > 0 ? (design.height - grid.marginY) / grid.rows : 0,
    offX: grid.marginX,
    offY: grid.marginY,
  }
}

/** 单坐标吸到最近的「offset + k·pitch」栅格线；pitch ≤ 0 时只夹非负。 */
function snapToLine(value: number, pitch: number, offset: number): number {
  if (pitch <= 0) return Math.max(0, value)
  return offset + Math.round((value - offset) / pitch) * pitch
}

/** 一次吸附要看的三样东西；`free` 为真时整套吸附让位。 */
export interface SnapContext {
  design: DesignSize
  grid: EditorGridConfig
  snap: SnapConfig
  /** Alt 拖拽或关吸附：边不吸附，缺省为否。 */
  free?: boolean
}

/** 单坐标按配置吸附；`free`（Alt 拖拽）或总开关关闭时原样返回。 */
export function snapEdge(
  value: number,
  axis: 'x' | 'y',
  ctx: SnapContext,
): number {
  const { snap } = ctx
  if (ctx.free === true || !snap.enabled) return value
  if (snap.mode === 'px') {
    const step = snap.step > 0 ? snap.step : 1
    return Math.round(value / step) * step
  }
  const pitch = gridPitch(ctx.design, ctx.grid)
  return axis === 'x'
    ? snapToLine(value, pitch.px, pitch.offX)
    : snapToLine(value, pitch.py, pitch.offY)
}

/** 像素点吸附：palette 落点与拖动落点用。 */
export function snapPoint(
  x: number,
  y: number,
  ctx: SnapContext,
): { x: number; y: number } {
  return { x: snapEdge(x, 'x', ctx), y: snapEdge(y, 'y', ctx) }
}

/** 方向键微调的步长：grid = 一格、px = 步进、关吸附 = 1px。Alt 精调由调用方走 1px。 */
export function snapStep(
  design: DesignSize,
  grid: EditorGridConfig,
  snap: SnapConfig,
): { x: number; y: number } {
  if (!snap.enabled) return { x: 1, y: 1 }
  if (snap.mode === 'px') {
    const step = snap.step > 0 ? snap.step : 1
    return { x: step, y: step }
  }
  const pitch = gridPitch(design, grid)
  return { x: pitch.px > 0 ? pitch.px : 1, y: pitch.py > 0 ? pitch.py : 1 }
}

/** resize 各方向对几何的作用轴：-1 动起始边、1 动结束边、0 不动。 */
export interface ResizeDir {
  x: -1 | 0 | 1
  y: -1 | 0 | 1
}

/**
 * 按方向把**正在移动的那条边**吸附后换算出新几何；不钳越界，调用方再夹。
 * @param free Alt 拖拽或关吸附时为真，边不吸附
 */
export function applyResize(input: {
  start: NodeBox
  dir: ResizeDir
  dx: number
  dy: number
  minW: number
  minH: number
  design: DesignSize
  grid: EditorGridConfig
  snap: SnapConfig
  free?: boolean
}): NodeBox {
  const { start, dir, dx, dy, minW, minH, design } = input
  const ctx: SnapContext = {
    design,
    grid: input.grid,
    snap: input.snap,
    free: input.free ?? false,
  }
  let { x, y, w, h } = start
  if (dir.x === 1) {
    const right = snapEdge(start.x + start.w + dx, 'x', ctx)
    w = Math.max(minW, Math.min(right - start.x, design.width - start.x))
  } else if (dir.x === -1) {
    const rawLeft = snapEdge(start.x + dx, 'x', ctx)
    const left = Math.min(Math.max(0, rawLeft), start.x + start.w - minW)
    w = start.x + start.w - left
    x = left
  }
  if (dir.y === 1) {
    const bottom = snapEdge(start.y + start.h + dy, 'y', ctx)
    h = Math.max(minH, Math.min(bottom - start.y, design.height - start.y))
  } else if (dir.y === -1) {
    const rawTop = snapEdge(start.y + dy, 'y', ctx)
    const top = Math.min(Math.max(0, rawTop), start.y + start.h - minH)
    h = start.y + start.h - top
    y = top
  }
  return { x, y, w, h }
}

/** 参与比对的三条线开关：[起始边, 中线, 结束边]；resize 时只开正在动的那条。 */
export type EdgeMask = [boolean, boolean, boolean]
export const EDGE_ALL: EdgeMask = [true, true, true]

/** 命中的参考线（画布绝对坐标）：`v` 的 pos 是 x、跨度是 y，`h` 反之。 */
export interface GuideLine {
  orientation: 'v' | 'h'
  pos: number
  from: number
  to: number
}

/** 每轴阈值内最近命中的修正量；未命中为 null。 */
export interface SmartSnapHit {
  dx: number | null
  dy: number | null
}

function edgesX(rect: ModuleRect): [number, number, number] {
  return [rect.left, rect.left + rect.width / 2, rect.left + rect.width]
}

function edgesY(rect: ModuleRect): [number, number, number] {
  return [rect.top, rect.top + rect.height / 2, rect.top + rect.height]
}

/**
 * 单轴上阈值内最近的修正量：移动矩形的三条线与每个候选的三条线两两比对。
 * @param movingEdges 移动矩形在该轴的三条线
 * @param targetEdges 每个候选在该轴的三条线
 * @param mask 参与比对的线开关
 * @param threshold 吸附阈值（设计像素）
 */
function nearestDiffOnAxis(
  movingEdges: readonly number[],
  targetEdges: readonly (readonly number[])[],
  mask: EdgeMask,
  threshold: number,
): number | null {
  let best: number | null = null
  for (const edges of targetEdges) {
    for (let line = 0; line < 3; line += 1) {
      const from = movingEdges[line]
      if (mask[line] !== true || from === undefined) continue
      for (const to of edges) {
        const diff = to - from
        if (Math.abs(diff) > threshold) continue
        if (best === null || Math.abs(diff) < Math.abs(best)) best = diff
      }
    }
  }
  return best
}

/**
 * 智能吸附：把移动矩形的三条线与每个候选的三条线两两比对，
 * 每轴取阈值内绝对值最小的差作修正量。候选集由调用方限定为同父兄弟加本层边界。
 */
export function smartSnap(
  moving: ModuleRect,
  targets: readonly ModuleRect[],
  threshold: number,
  maskX: EdgeMask = EDGE_ALL,
  maskY: EdgeMask = EDGE_ALL,
): SmartSnapHit {
  return {
    dx: nearestDiffOnAxis(
      edgesX(moving),
      targets.map(edgesX),
      maskX,
      threshold,
    ),
    dy: nearestDiffOnAxis(
      edgesY(moving),
      targets.map(edgesY),
      maskY,
      threshold,
    ),
  }
}

/** 一条轴的收集口径：比对哪三条线，参考线又该跨多长。 */
interface GuideAxis {
  orientation: 'v' | 'h'
  /** 参与比对的三条线。 */
  edgesOf: (rect: ModuleRect) => [number, number, number]
  /** 参考线要覆盖的跨度，取**另一**轴的起止。 */
  spanOf: (rect: ModuleRect) => [number, number]
}

const VERTICAL_AXIS: GuideAxis = {
  orientation: 'v',
  edgesOf: edgesX,
  spanOf: (rect) => [rect.top, rect.top + rect.height],
}

const HORIZONTAL_AXIS: GuideAxis = {
  orientation: 'h',
  edgesOf: edgesY,
  spanOf: (rect) => [rect.left, rect.left + rect.width],
}

/** 同位置的多条命中并成一条：位置按半像素取整做键，跨度取并集。 */
function putGuide(lines: Map<number, GuideLine>, guide: GuideLine): void {
  const key = Math.round(guide.pos * 2)
  const current = lines.get(key)
  if (current === undefined) {
    lines.set(key, guide)
    return
  }
  current.from = Math.min(current.from, guide.from)
  current.to = Math.max(current.to, guide.to)
}

/** 收集一条轴上「精确共线」的参考线。 */
function collectOnAxis(
  axis: GuideAxis,
  rect: ModuleRect,
  targets: readonly ModuleRect[],
  eps: number,
  mask: EdgeMask,
): GuideLine[] {
  const lines = new Map<number, GuideLine>()
  const rectEdges = axis.edgesOf(rect)
  const [rectFrom, rectTo] = axis.spanOf(rect)
  for (const target of targets) {
    const [targetFrom, targetTo] = axis.spanOf(target)
    for (let line = 0; line < 3; line += 1) {
      const from = rectEdges[line]
      if (mask[line] !== true || from === undefined) continue
      for (const to of axis.edgesOf(target)) {
        if (Math.abs(to - from) > eps) continue
        putGuide(lines, {
          orientation: axis.orientation,
          pos: to,
          from: Math.min(rectFrom, targetFrom),
          to: Math.max(rectTo, targetTo),
        })
      }
    }
  }
  return [...lines.values()]
}

/**
 * 收集吸附后矩形与候选集「精确共线」的参考线用于渲染；
 * 同位置的多条命中并成一条，跨度取移动矩形与全部命中目标的并集。
 */
export function collectGuides(
  rect: ModuleRect,
  targets: readonly ModuleRect[],
  eps = 0.5,
  maskX: EdgeMask = EDGE_ALL,
  maskY: EdgeMask = EDGE_ALL,
): GuideLine[] {
  return [
    ...collectOnAxis(VERTICAL_AXIS, rect, targets, eps, maskX),
    ...collectOnAxis(HORIZONTAL_AXIS, rect, targets, eps, maskY),
  ]
}

/** CSS repeating-gradient 画吸附导引背景用的周期与偏移。 */
export function gridGuide(
  design: DesignSize,
  grid: EditorGridConfig,
  snap: SnapConfig,
): { colPeriod: number; rowPeriod: number; offsetX: number; offsetY: number } {
  if (snap.mode === 'px') {
    const step = snap.step > 0 ? snap.step : 1
    return { colPeriod: step, rowPeriod: step, offsetX: 0, offsetY: 0 }
  }
  const pitch = gridPitch(design, grid)
  return {
    colPeriod: pitch.px,
    rowPeriod: pitch.py,
    offsetX: pitch.offX,
    offsetY: pitch.offY,
  }
}
