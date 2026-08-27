/**
 * @fileoverview 画布上一次指针手势的状态机：`pointerdown → pointermove → pointerup`
 * 一条，平移、拖节点、拖端点与拐点、框选、连线预览、标注绘制与八向缩放共用它。
 *
 * ⚠ 手势期间只做纯变更（`onMove` 写草稿），松手才由 `onEnd` 落一次 `commit`：拖一个
 * 节点会走几百个 `pointermove`，逐帧记一格撤销栈之后撤销键就废了。
 * ⚠ `onEnd` 无论怎么收场都**恰好回调一次**，卸载与被顶掉也算（`'interrupted'`）：
 * 不补这一次，拖到一半切走的改动既没进撤销栈也没落库。
 * ⚠ window 上的三副指针监听在 `onBeforeUnmount` 里摘干净，否则离开这一页之后整站
 * 的指针事件都还在被它拦。
 */
import { computed, onBeforeUnmount, shallowRef } from 'vue'
import type { ComputedRef, ShallowRef } from 'vue'

import type { Pt } from '@dt/twin2d'

import type { Twin2dClientPoint } from './viewportOps'

/** 起手多少**屏幕**像素之内还算「点一下」而不是拖。 */
export const TWIN_2D_GESTURE_SLOP_PX = 4

/** 一次手势属于哪一类：`bend` = 拖拐点，`link` = 拉一条新连线，`draw` = 画标注。 */
export type Twin2dGestureKind =
  'pan' | 'move' | 'resize' | 'endpoint' | 'bend' | 'marquee' | 'link' | 'draw'

/**
 * 手势怎么收的场。⚠ `'interrupted'`（卸载、被下一次起手顶掉）**也要 commit**：
 * 它是「没走完但改动是真的」，与要退回去的 `'cancelled'` 正好相反。
 */
export type Twin2dGestureEnd = 'done' | 'cancelled' | 'interrupted'

/** 一帧手势；`from` / `to` 是起手点与当前点（设计坐标）。 */
export interface Twin2dGestureFrame {
  kind: Twin2dGestureKind
  from: Pt
  to: Pt
  /** 设计位移 = `to − from`。 */
  dx: number
  dy: number
  /** 屏幕位移。⚠ 平移画布只能用它：平移时设计位移全程是 0（视口跟着指针走）。 */
  clientDx: number
  clientDy: number
  /** Alt = 这一帧不吸附；Shift = 约束主轴 / 等比；`additive` = Ctrl 或 ⌘。 */
  alt: boolean
  shift: boolean
  additive: boolean
  /** 已越过起手阈值。⚠ 一旦为真不再回落，否则拖回原点会变成一次「点击」。 */
  moved: boolean
}

/** 起一次手势要交代的四件事；`event` 是起手的那个 `pointerdown`。 */
export interface Twin2dGestureSpec {
  kind: Twin2dGestureKind
  event: PointerEvent
  /** 每一帧：只写草稿态，别 commit。 */
  onMove: (frame: Twin2dGestureFrame) => void
  /** 收场：`'cancelled'` 退回去，另两档各落一次 commit。 */
  onEnd: (frame: Twin2dGestureFrame, end: Twin2dGestureEnd) => void
}

export interface Twin2dPointerOptions {
  /** 指针的设计坐标；舞台还没挂上时回 null，这一手势就不起。 */
  toDesign: (at: Twin2dClientPoint) => Pt | null
}

export interface Twin2dCanvasPointer {
  /** 正在进行的手势类别，null = 没有手势；当前帧供画布层画框选框与连线预览。 */
  kind: ComputedRef<Twin2dGestureKind | null>
  frame: ComputedRef<Twin2dGestureFrame | null>
  /** 起一次手势；起点算不出来（舞台没挂）时返回 false。 */
  start: (spec: Twin2dGestureSpec) => boolean
  /** 主动收场，按 `'cancelled'` 算；Esc 由页面的快捷键接到这里。 */
  cancel: () => void
}

/** 一次手势的现场；监听随手势生灭，所以就挂在这里。 */
interface GestureSession {
  spec: Twin2dGestureSpec
  last: Twin2dGestureFrame
  listeners: AbortController
}

interface PointerRuntime {
  options: Twin2dPointerOptions
  session: GestureSession | null
  frame: ShallowRef<Twin2dGestureFrame | null>
}

/** 三个修饰键：Alt 不吸附、Shift 约束、Ctrl 或 ⌘ 加选。 */
function modsOf(event: PointerEvent) {
  return {
    alt: event.altKey,
    shift: event.shiftKey,
    additive: event.ctrlKey || event.metaKey,
  }
}

/** 起手那一帧：两种位移都是零。 */
function firstFrame(spec: Twin2dGestureSpec, from: Pt): Twin2dGestureFrame {
  const zero = { dx: 0, dy: 0, clientDx: 0, clientDy: 0, moved: false }
  return { kind: spec.kind, from, to: from, ...zero, ...modsOf(spec.event) }
}

/** 移动一帧。⚠ 设计坐标算不出来时沿用上一帧的落点，绝不产出 NaN。 */
function frameOf(
  runtime: PointerRuntime,
  session: GestureSession,
  event: PointerEvent,
): Twin2dGestureFrame {
  const last = session.last
  const down = session.spec.event
  const to = runtime.options.toDesign(event) ?? last.to
  const clientDx = event.clientX - down.clientX
  const clientDy = event.clientY - down.clientY
  const slop = TWIN_2D_GESTURE_SLOP_PX
  return {
    ...modsOf(event),
    kind: last.kind,
    from: last.from,
    to,
    dx: to.x - last.from.x,
    dy: to.y - last.from.y,
    clientDx,
    clientDy,
    moved: last.moved || Math.abs(clientDx) > slop || Math.abs(clientDy) > slop,
  }
}

/** 收场：先把监听与现场收干净再回调，`onEnd` 里常常直接又起下一件事。 */
function finish(runtime: PointerRuntime, end: Twin2dGestureEnd): void {
  const session = runtime.session
  if (session === null) return
  session.listeners.abort()
  runtime.session = null
  runtime.frame.value = null
  session.spec.onEnd(session.last, end)
}

/** ⚠ 监听挂 window 不挂元素：指针早拖到画布外去了，挂元素一出边界就断帧。 */
function listen(runtime: PointerRuntime, session: GestureSession): void {
  const { signal } = session.listeners
  const step = (event: PointerEvent): void => {
    session.last = frameOf(runtime, session, event)
    runtime.frame.value = session.last
    session.spec.onMove(session.last)
  }
  const close =
    (end: Twin2dGestureEnd) =>
    (event: PointerEvent): void => {
      session.last = frameOf(runtime, session, event)
      finish(runtime, end)
    }
  window.addEventListener('pointermove', step, { signal })
  window.addEventListener('pointerup', close('done'), { signal })
  window.addEventListener('pointercancel', close('cancelled'), { signal })
}

/** 起一次手势；上一次还没收场就先按「被顶掉」收了它。 */
function startGesture(
  runtime: PointerRuntime,
  spec: Twin2dGestureSpec,
): boolean {
  const from = runtime.options.toDesign(spec.event)
  if (from === null) return false
  finish(runtime, 'interrupted')
  const session: GestureSession = {
    spec,
    last: firstFrame(spec, from),
    listeners: new AbortController(),
  }
  runtime.session = session
  runtime.frame.value = session.last
  listen(runtime, session)
  return true
}

/**
 * 装上手势状态机。
 * @param options 指针 → 设计坐标的换算
 */
export function useCanvasPointer(
  options: Twin2dPointerOptions,
): Twin2dCanvasPointer {
  const runtime: PointerRuntime = {
    options,
    session: null,
    frame: shallowRef<Twin2dGestureFrame | null>(null),
  }

  // ⚠ 卸载补一次收场：监听要摘，而这一手势的改动照样得 commit 一次
  onBeforeUnmount(() => finish(runtime, 'interrupted'))

  return {
    kind: computed(() => runtime.frame.value?.kind ?? null),
    frame: computed(() => runtime.frame.value),
    start: (spec) => startGesture(runtime, spec),
    cancel: () => finish(runtime, 'cancelled'),
  }
}
