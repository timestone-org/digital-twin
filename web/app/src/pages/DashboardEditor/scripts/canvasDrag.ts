/**
 * @fileoverview 画布拖动的算术与监听装配：8 向缩放、多选整体位移、吸附与参考线、
 * 换父时的坐标换算。一律按**本层**设计像素算，屏幕位移由调用方先除掉生效倍率。
 * ⚠ 吸附阈值也要除倍率：不除的话缩到 25% 时吸附圈在屏幕上只剩四分之一，基本吸不上。
 */

import type { Ref } from 'vue'

import type { DesignSize, ModuleRect, NodeBox } from '@dt/runtime'

import { clampRect } from '@/features/dashboard/canvasAlign'
import type { NodeGeometry } from '@/features/dashboard/editorDoc'
import {
  applyResize,
  collectGuides,
  smartSnap,
  snapPoint,
  SMART_SNAP_SCREEN_PX,
  type EdgeMask,
  type EditorGridConfig,
  type GuideLine,
  type ResizeDir,
  type SmartSnapHit,
  type SnapConfig,
} from '@/features/dashboard/canvasSnap'

/** 起手时认定「真的在拖」的位移下限（设计像素）：原地单击不算拖动。 */
const MOVED_EPS_PX = 0.5

export type DragKind = 'move' | 'resize'

/** 一个被拖的节点：几何是**本层**局部值，原点与边界用来做绝对坐标换算与夹边。 */
export interface DragItem {
  nodeId: string
  parentId: string | null
  start: NodeBox
  /** 本层原点在画布上的绝对坐标。 */
  originX: number
  originY: number
  /** 本层边界：顶层是设计尺寸，容器内是容器内容区尺寸。 */
  layer: DesignSize
  minW: number
  minH: number
  /** 钉位节点：不许移动、不许换父，宽与 x 被钉住。 */
  isPinned: boolean
}

/** 换父的落点：目标层的原点（绝对）与边界；`parentId` 为 null 即顶层。 */
export interface DropTarget {
  parentId: string | null
  originX: number
  originY: number
  layer: DesignSize
}

/** 一次拖动会话的起手状态。 */
export interface DragSession {
  kind: DragKind
  dir: ResizeDir
  clientX: number
  clientY: number
  /** 被按住的那个节点：吸附、参考线与换父都以它为准。 */
  anchor: DragItem
  /** 一起动的节点：多选整体拖动时是全部最上层选中根，其余情形只有锚点。 */
  items: readonly DragItem[]
  /** 拖动子树的全部 id：参考线候选与换父命中都要排除它们。 */
  excluded: ReadonlySet<string>
  /** 参考线候选矩形（画布绝对坐标）。 */
  candidates: readonly ModuleRect[]
  snap: SnapConfig
  grid: EditorGridConfig
  /** 起手时锚点已在多选集里：原地单击要收敛成单选。 */
  wasMulti: boolean
  moved: boolean
}

/** 一帧的结果：各节点的新几何（本层局部）与要画的参考线。 */
export interface DragResult {
  rects: Map<string, NodeBox>
  guides: GuideLine[]
}

/** 一次指针位移，位移已折算成设计像素。 */
export interface DragInput {
  dx: number
  dy: number
  /** Alt 拖拽：本次不吸附也不出参考线。 */
  free: boolean
  /** Shift 拖拽：移动锁主轴、缩放按起手宽高比锁定；逐事件读，可中途切换。 */
  constrain?: boolean
  /** 智能吸附阈值（设计像素）。 */
  threshold: number
}

export interface CanvasDragOptions {
  /** 当前生效倍率：屏幕位移与吸附阈值都要除它。 */
  scale: () => number
  /** 落点所在的层；算不出指针坐标时为 null。 */
  dropTargetAt: (
    at: { clientX: number; clientY: number },
    excluded: ReadonlySet<string>,
  ) => DropTarget | null
  /**
   * 单节点几何变了。
   * @param isContinuous 拖动过程中为真，松手那一下为假——撤销栈据它决定合不合并
   */
  onChange: (
    nodeId: string,
    geometry: NodeGeometry,
    isContinuous: boolean,
  ) => void
  /** 多选整体拖动：一帧一批。 */
  onChangeBatch: (
    changes: Map<string, NodeGeometry>,
    isContinuous: boolean,
  ) => void
  onReparent: (
    nodeId: string,
    parentId: string | null,
    geometry: NodeGeometry,
  ) => void
  /** 多选集里原地单击：收敛成单选它。 */
  onCollapse: (nodeId: string) => void
}

/** 拖动几何浮标的数据：移动示 x,y、缩放示 w×h；left/top 是锚点矩形的画布绝对位置。 */
export interface DragReadout {
  kind: DragKind
  x: number
  y: number
  w: number
  h: number
  left: number
  top: number
}

export interface CanvasDrag {
  isDragging: Ref<boolean>
  guides: Ref<GuideLine[]>
  /** 拖动中的实时几何读数；没在拖（或还没拖出位移）为 null。 */
  readout: Ref<DragReadout | null>
  /** 拖动经过的容器：画高亮描边提示这一松手会落进去。 */
  hoverContainerId: Ref<string | null>
  start: (session: DragSession) => void
  /** 卸载时摘监听。组件用 onUnmounted 自动调，测试可以手动调。 */
  stop: () => void
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), Math.max(low, high))
}

/** 本层局部几何 → 画布绝对矩形。 */
function absRect(item: DragItem, box: NodeBox): ModuleRect {
  return {
    left: item.originX + box.x,
    top: item.originY + box.y,
    width: box.w,
    height: box.h,
  }
}

/** 位移是否已经大到该算「拖动」而不是「单击」。 */
export function hasMoved(dx: number, dy: number): boolean {
  return Math.abs(dx) > MOVED_EPS_PX || Math.abs(dy) > MOVED_EPS_PX
}

/** 一帧的新几何。 */
export function computeDrag(
  session: DragSession,
  input: DragInput,
): DragResult {
  if (session.kind === 'move') return moveDrag(session, input)
  return input.constrain === true
    ? ratioResize(session, input)
    : resizeDrag(session, input)
}

/** 一根轴吸附后的落点：参考线命中优先，未命中退回步进吸附。 */
function snappedAxis(
  raw: number,
  hitDelta: number | null,
  stepped: number,
): number {
  return hitDelta === null ? stepped : raw + hitDelta
}

/**
 * 位移一帧：参考线命中的轴优先吸边线，未命中的轴退回步进吸附；
 * 锚点吸完的净位移原样施加到其余项，各自再夹回自己那一层。
 * Shift 锁主轴：位移绝对值大的轴生效，另一轴回起点（起点值原样保留，绕过吸附）。
 */
function moveDrag(session: DragSession, input: DragInput): DragResult {
  const anchor = session.anchor
  const smartOn = !input.free && session.snap.guides
  const constrained = input.constrain === true
  const lockY = constrained && Math.abs(input.dx) >= Math.abs(input.dy)
  const lockX = constrained && !lockY
  const rawX = anchor.start.x + (lockX ? 0 : input.dx)
  const rawY = anchor.start.y + (lockY ? 0 : input.dy)
  const raw: NodeBox = {
    x: rawX,
    y: rawY,
    w: anchor.start.w,
    h: anchor.start.h,
  }
  const hit: SmartSnapHit = smartOn
    ? smartSnap(absRect(anchor, raw), session.candidates, input.threshold)
    : { dx: null, dy: null }
  const stepped = snapPoint(rawX, rawY, {
    design: anchor.layer,
    grid: session.grid,
    snap: session.snap,
    free: input.free,
  })
  const placed = clampRect(
    {
      x: lockX ? anchor.start.x : snappedAxis(rawX, hit.dx, stepped.x),
      y: lockY ? anchor.start.y : snappedAxis(rawY, hit.dy, stepped.y),
      w: anchor.start.w,
      h: anchor.start.h,
    },
    anchor.layer,
    anchor.start.w,
    anchor.start.h,
  )
  return {
    rects: spreadDelta(session, placed),
    guides: smartOn
      ? collectGuides(absRect(anchor, placed), session.candidates)
      : [],
  }
}

/** 锚点的净位移摊到每个同行项上，各自夹回自己那一层。 */
function spreadDelta(
  session: DragSession,
  placed: NodeBox,
): Map<string, NodeBox> {
  const anchor = session.anchor
  const dx = placed.x - anchor.start.x
  const dy = placed.y - anchor.start.y
  const rects = new Map<string, NodeBox>()
  for (const item of session.items) {
    rects.set(
      item.nodeId,
      item.nodeId === anchor.nodeId
        ? placed
        : clampRect(
            {
              x: item.start.x + dx,
              y: item.start.y + dy,
              w: item.start.w,
              h: item.start.h,
            },
            item.layer,
            item.start.w,
            item.start.h,
          ),
    )
  }
  return rects
}

/** 缩放一帧：只有正在动的那条边参与吸附，参考线同样只比对那条边。 */
function resizeDrag(session: DragSession, input: DragInput): DragResult {
  const anchor = session.anchor
  const base = {
    start: anchor.start,
    dir: session.dir,
    dx: input.dx,
    dy: input.dy,
    minW: anchor.minW,
    minH: anchor.minH,
    design: anchor.layer,
    grid: session.grid,
    snap: session.snap,
  }
  const maskX: EdgeMask = [session.dir.x === -1, false, session.dir.x === 1]
  const maskY: EdgeMask = [session.dir.y === -1, false, session.dir.y === 1]
  const smartOn = !input.free && session.snap.guides
  let rect = applyResize({ ...base, free: input.free })
  if (smartOn) {
    const raw = applyResize({ ...base, free: true })
    const hit = smartSnap(
      absRect(anchor, raw),
      session.candidates,
      input.threshold,
      maskX,
      maskY,
    )
    rect = smartEdges(anchor, session.dir, raw, hit, rect)
  }
  const placed = pinnedBox(
    anchor,
    clampRect(rect, anchor.layer, anchor.minW, anchor.minH),
  )
  return {
    rects: new Map([[anchor.nodeId, placed]]),
    guides: smartOn
      ? collectGuides(
          absRect(anchor, placed),
          session.candidates,
          0.5,
          maskX,
          maskY,
        )
      : [],
  }
}

/** 钉位节点横向被钉死：x 恒 0、宽恒本层宽，只有高能改。 */
function pinnedBox(anchor: DragItem, rect: NodeBox): NodeBox {
  return anchor.isPinned ? { ...rect, x: 0, w: anchor.layer.width } : rect
}

/**
 * 主导维先定，另一维按起手宽高比导出；最小边先等比放大兜底，
 * 再按被钉住的对边等比缩回本层边界。位置：动起始边的把结束边钉在原处。
 */
function ratioBox(
  anchor: DragItem,
  dir: ResizeDir,
  raw: NodeBox,
  xLed: boolean,
): NodeBox {
  const start = anchor.start
  const ratio = start.w > 0 && start.h > 0 ? start.w / start.h : 1
  let w = xLed ? Math.max(raw.w, 1) : Math.max(raw.h, 1) * ratio
  let h = w / ratio
  const grow = Math.max(anchor.minW / w, anchor.minH / h, 1)
  w *= grow
  h *= grow
  const maxW = dir.x === -1 ? start.x + start.w : anchor.layer.width - start.x
  const maxH = dir.y === -1 ? start.y + start.h : anchor.layer.height - start.y
  const shrink = Math.min(maxW / w, maxH / h, 1)
  w *= shrink
  h *= shrink
  return {
    x: dir.x === -1 ? start.x + start.w - w : start.x,
    y: dir.y === -1 ? start.y + start.h - h : start.y,
    w,
    h,
  }
}

/**
 * Shift 缩放一帧：按**起手时**的宽高比锁定。主导轴 = 边手柄所在的轴，
 * 角手柄取相对位移（|d|/边长）更大的轴；吸附与参考线整套让位——吸完的边凑不出精确比例。
 */
function ratioResize(session: DragSession, input: DragInput): DragResult {
  const anchor = session.anchor
  const dir = session.dir
  const raw = applyResize({
    start: anchor.start,
    dir,
    dx: input.dx,
    dy: input.dy,
    minW: anchor.minW,
    minH: anchor.minH,
    design: anchor.layer,
    grid: session.grid,
    snap: session.snap,
    free: true,
  })
  const xLed =
    dir.y === 0 ||
    (dir.x !== 0 &&
      Math.abs(input.dx) * anchor.start.h >=
        Math.abs(input.dy) * anchor.start.w)
  const rect = ratioBox(anchor, dir, raw, xLed)
  const placed = pinnedBox(
    anchor,
    clampRect(rect, anchor.layer, anchor.minW, anchor.minH),
  )
  return { rects: new Map([[anchor.nodeId, placed]]), guides: [] }
}

/** 参考线命中时改写正在动的那条边，优先级高于步进吸附。 */
function smartEdges(
  anchor: DragItem,
  dir: ResizeDir,
  raw: NodeBox,
  hit: SmartSnapHit,
  rect: NodeBox,
): NodeBox {
  const start = anchor.start
  let out = rect
  if (hit.dx !== null && dir.x === 1) {
    const right = raw.x + raw.w + hit.dx
    const high = Math.max(anchor.minW, anchor.layer.width - start.x)
    out = { ...out, x: start.x, w: clamp(right - start.x, anchor.minW, high) }
  } else if (hit.dx !== null && dir.x === -1) {
    const left = clamp(raw.x + hit.dx, 0, start.x + start.w - anchor.minW)
    out = { ...out, x: left, w: start.x + start.w - left }
  }
  if (hit.dy !== null && dir.y === 1) {
    const bottom = raw.y + raw.h + hit.dy
    const high = Math.max(anchor.minH, anchor.layer.height - start.y)
    out = { ...out, y: start.y, h: clamp(bottom - start.y, anchor.minH, high) }
  } else if (hit.dy !== null && dir.y === -1) {
    const top = clamp(raw.y + hit.dy, 0, start.y + start.h - anchor.minH)
    out = { ...out, y: top, h: start.y + start.h - top }
  }
  return out
}

/**
 * 换父后的几何：节点的绝对位置换算成目标层的局部坐标，再按目标层吸附并夹回去。
 * @param input 锚点、松手那一帧的几何、落点目标层与吸附配置
 */
export function reparentGeometry(input: {
  anchor: DragItem
  rect: NodeBox
  target: DropTarget
  snap: SnapConfig
  grid: EditorGridConfig
  free: boolean
}): NodeBox {
  const { anchor, rect, target } = input
  const point = snapPoint(
    anchor.originX + rect.x - target.originX,
    anchor.originY + rect.y - target.originY,
    {
      design: target.layer,
      grid: input.grid,
      snap: input.snap,
      free: input.free,
    },
  )
  return clampRect(
    { x: point.x, y: point.y, w: rect.w, h: rect.h },
    target.layer,
    anchor.minW,
    anchor.minH,
  )
}

/** 一次拖动的运行态：组合式函数只持有它，动作都是下面这几个函数。 */
export interface DragRuntime {
  options: CanvasDragOptions
  isDragging: Ref<boolean>
  guides: Ref<GuideLine[]>
  readout: Ref<DragReadout | null>
  hoverContainerId: Ref<string | null>
  session: DragSession | null
  listeners: AbortController | null
}

/** 收掉这一次拖动：监听、会话与几处提示状态一起清干净。 */
export function stopDrag(runtime: DragRuntime): void {
  runtime.listeners?.abort()
  runtime.listeners = null
  runtime.session = null
  runtime.isDragging.value = false
  runtime.guides.value = []
  runtime.readout.value = null
  runtime.hoverContainerId.value = null
}

/** 这一帧的新几何：屏幕位移与吸附阈值都先除掉生效倍率。 */
function dragFrame(
  runtime: DragRuntime,
  current: DragSession,
  event: PointerEvent,
): DragResult {
  const raw = runtime.options.scale()
  const scale = raw > 0 ? raw : 1
  const dx = (event.clientX - current.clientX) / scale
  const dy = (event.clientY - current.clientY) / scale
  if (hasMoved(dx, dy)) current.moved = true
  return computeDrag(current, {
    dx,
    dy,
    free: event.altKey,
    constrain: event.shiftKey,
    threshold: SMART_SNAP_SCREEN_PX / scale,
  })
}

/** 这一帧的浮标数据；锚点矩形不在结果里（不该发生）时为 null。 */
function readoutOf(
  session: DragSession,
  result: DragResult,
): DragReadout | null {
  const rect = result.rects.get(session.anchor.nodeId)
  if (rect === undefined) return null
  return {
    kind: session.kind,
    x: rect.x,
    y: rect.y,
    w: rect.w,
    h: rect.h,
    left: session.anchor.originX + rect.x,
    top: session.anchor.originY + rect.y,
  }
}

function reportDrag(
  runtime: DragRuntime,
  current: DragSession,
  rects: Map<string, NodeBox>,
  isContinuous: boolean,
): void {
  if (current.items.length > 1) {
    runtime.options.onChangeBatch(rects, isContinuous)
    return
  }
  const rect = rects.get(current.anchor.nodeId)
  if (rect !== undefined) {
    runtime.options.onChange(current.anchor.nodeId, rect, isContinuous)
  }
}

/** 落点命中的新父层；不换父时为 null。批量拖动与钉位节点一律不换父。 */
function dropOf(
  runtime: DragRuntime,
  current: DragSession,
  event: PointerEvent,
): DropTarget | null {
  if (current.kind !== 'move' || current.items.length !== 1) return null
  if (current.anchor.isPinned) return null
  const target = runtime.options.dropTargetAt(event, current.excluded)
  if (target === null || target.parentId === current.anchor.parentId) {
    return null
  }
  return target
}

function onDragMove(runtime: DragRuntime, event: PointerEvent): void {
  const current = runtime.session
  if (current === null) return
  const result = dragFrame(runtime, current, event)
  runtime.guides.value = result.guides
  // 原地未动不出浮标：单击不该闪一下读数
  runtime.readout.value = current.moved ? readoutOf(current, result) : null
  runtime.hoverContainerId.value =
    dropOf(runtime, current, event)?.parentId ?? null
  reportDrag(runtime, current, result.rects, true)
}

function onDragFinish(
  runtime: DragRuntime,
  event: PointerEvent,
  isCancelled: boolean,
): void {
  const current = runtime.session
  if (current === null) return
  const result = dragFrame(runtime, current, event)
  // 原地单击：什么都没动，别记一笔撤销
  if (current.kind === 'move' && !current.moved) {
    if (current.wasMulti) runtime.options.onCollapse(current.anchor.nodeId)
    stopDrag(runtime)
    return
  }
  const target = isCancelled ? null : dropOf(runtime, current, event)
  const rect = result.rects.get(current.anchor.nodeId)
  if (target !== null && rect !== undefined) {
    const { anchor, snap, grid } = current
    const free = event.altKey
    runtime.options.onReparent(
      anchor.nodeId,
      target.parentId,
      reparentGeometry({ anchor, rect, target, snap, grid, free }),
    )
  } else {
    reportDrag(runtime, current, result.rects, false)
  }
  stopDrag(runtime)
}

/** 起一次拖动：先收掉上一次，再把这一次的监听挂上。 */
export function startDrag(runtime: DragRuntime, next: DragSession): void {
  stopDrag(runtime)
  const controller = new AbortController()
  runtime.listeners = controller
  runtime.session = next
  runtime.isDragging.value = true
  listenDrag(controller, {
    move: (event) => onDragMove(runtime, event),
    finish: (event, isCancelled) => onDragFinish(runtime, event, isCancelled),
  })
}

/** 一次拖动的三个 window 监听，生死全交给传进来的 controller。 */
export function listenDrag(
  controller: AbortController,
  handlers: {
    move: (event: PointerEvent) => void
    finish: (event: PointerEvent, isCancelled: boolean) => void
  },
): void {
  const { signal } = controller
  window.addEventListener('pointermove', handlers.move, { signal })
  window.addEventListener(
    'pointerup',
    (event: PointerEvent) => handlers.finish(event, false),
    { signal },
  )
  // ⚠ pointercancel 也要收尾：系统抢走指针时不会再发 pointerup
  window.addEventListener(
    'pointercancel',
    (event: PointerEvent) => handlers.finish(event, true),
    { signal },
  )
}
