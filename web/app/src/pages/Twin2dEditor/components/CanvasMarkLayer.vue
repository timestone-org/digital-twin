<script setup lang="ts">
/**
 * @fileoverview 编辑器的标注层：一个实例画一档 `zOrder`，画布把它挂两次——`below`
 * 那份在连线之下、`above` 那份在节点之上，与运行态 `Twin2dStage` 的层序逐层对上。
 * 层内负责命中、拖动、八向缩放与端点拖拽，形状交给包里的 `Twin2dMarkShape`——运行态
 * 挂的是同一份，两边画出来的标注逐像素相同。
 *
 * ⚠ 分两层是这一模块的硬口径：参考项目的编辑器把标注全塞进一个浮层，于是配了
 * `below` 的标注在编辑器里看着在上面、上了大屏跑到下面——所见即所得在这一项上是假的
 * （docs/MODULE_TWIN_2D_DESIGN.md §7.10 #74）。
 * ⚠ 手势状态机由画布宿主持有、各层共用（`startGesture` prop）：每层各起一台的话，
 * 「上一次没收场就先顶掉它」这条互斥不成立，两个手势会同时在改同一份图。
 * ⚠ 手势期间只写 `draft`（纯变更），松手才 `change` 一次：逐帧上抛的话拖一条标注
 * 就能往撤销栈里塞进几百格，撤销键从此按不回上一步。收场被卸载打断
 * （`'interrupted'`）照样上抛，否则拖到一半切走的改动既没进撤销栈也没落库。
 */
import { Twin2dMarkShape } from '@dt/twin2d'
import type { Pt, Twin2dCanvas, Twin2dMark, Twin2dMarkZOrder } from '@dt/twin2d'
import { computed, shallowRef } from 'vue'

import { markSnapBox } from '../scripts/entityBoxes'
import {
  snapAtScale,
  snapNodeBox,
  snapPoint,
  snapValue,
} from '../scripts/snapping'
import type {
  Twin2dGuideLine,
  Twin2dSnapBox,
  Twin2dSnapOptions,
} from '../scripts/snapping'
import type {
  Twin2dGestureEnd,
  Twin2dGestureFrame,
  Twin2dGestureSpec,
} from '../scripts/useCanvasPointer'
import { canvasViewBox, screenToDesignPx } from '../scripts/viewportOps'
import CanvasMarkHandles from './CanvasMarkHandles.vue'

/** 缩放的最小边长（设计像素）：再小就只剩一条线，八个手柄挤在一起谁也点不中。 */
const MIN_MARK_SIZE = 8
/** 命中带在屏幕上的宽度：细线也要抓得住。 */
const HIT_BAND_PX = 10

const props = withDefaults(
  defineProps<{
    canvas: Twin2dCanvas
    /** 整份标注；本层自己按 `zOrder` 过滤，上抛的也是整份。 */
    marks: readonly Twin2dMark[]
    /** 这一层画哪一档。 */
    layer: Twin2dMarkZOrder
    /** 选中的标注 id，来自 `editorSelection.idsOf('marks')`。 */
    selectedIds: readonly string[]
    /**
     * 吸附配置。
     * ⚠ `threshold` 进来时是**屏幕**像素，本层按当前倍率换成设计像素再喂吸附；
     * 不换算的话缩得越小屏幕上的吸附圈越小，缩到四分之一时基本吸不上。
     */
    snap: Twin2dSnapOptions
    /** 当前视口倍率：把手与命中带按它反着缩回屏幕上的固定尺寸。 */
    scale: number
    /** 起一次手势；画布的指针总线出这一支，本组件不另装监听。 */
    startGesture: (spec: Twin2dGestureSpec) => boolean
    /** 层外还能吸的盒（节点）；标注自己那些由本层补齐。 */
    peers?: readonly Twin2dSnapBox[]
    /** 关掉即只读：不出命中面、不出把手，指针一概不吃。 */
    editable: boolean
  }>(),
  { peers: () => [] },
)

const emit = defineEmits<{
  /** 命中一条标注；`additive` = 按住 Ctrl / ⌘，由上层决定并入还是顶替。 */
  pick: [id: string, additive: boolean]
  /** 一次手势收场，整份新标注上抛一次（`commit` 归上层）。 */
  change: [marks: readonly Twin2dMark[]]
  /** 这一帧要画的对齐参考线；手势收场时给空表。 */
  guides: [lines: readonly Twin2dGuideLine[]]
}>()

/**
 * 手势期间的本地草稿；null = 没在拖，或者拖了但一步都没挪。
 * ⚠ `shallowRef`：整份换引用，深响应式在每一帧上白走一遍全表。
 */
const draft = shallowRef<readonly Twin2dMark[] | null>(null)

const shown = computed(() =>
  (draft.value ?? props.marks).filter((mark) => mark.zOrder === props.layer),
)

const viewBox = computed(() => canvasViewBox(props.canvas))

/**
 * 出把手的那一条：只在单选时出，且只出在它自己那一层。
 * ⚠ 多选时不出：拖一个手柄改的是谁的尺寸，没有定义。
 */
const focused = computed<Twin2dMark | null>(() => {
  const picked = props.selectedIds
  if (!props.editable || picked.length !== 1) return null
  return shown.value.find((mark) => picked.includes(mark.id)) ?? null
})

/**
 * 这一帧的吸附配置：Alt 按下即整帧不吸。
 * @param alt 这一帧按着 Alt
 */
function snapOptionsOf(alt: boolean): Twin2dSnapOptions {
  return snapAtScale(props.snap, props.scale, alt)
}

/**
 * 缩放用的网格步长；`0` = 这一帧不吸。
 * @param alt 这一帧按着 Alt
 */
function gridOf(alt: boolean): number {
  return props.snap.enabled && !alt ? props.snap.grid : 0
}

/**
 * 整体平移一条标注。⚠ 四个坐标一起走：只挪 `x/y` 的话辅助线会被拉长而不是挪走。
 * @param mark 标注
 * @param dx 横向位移
 * @param dy 纵向位移
 */
function translated(mark: Twin2dMark, dx: number, dy: number): Twin2dMark {
  return {
    ...mark,
    x: mark.x + dx,
    y: mark.y + dy,
    x2: mark.x2 + dx,
    y2: mark.y2 + dy,
  }
}

/**
 * 换掉整份里的一条，其余原样。
 * @param next 改过的那一条
 */
function replaced(next: Twin2dMark): readonly Twin2dMark[] {
  return props.marks.map((mark) => (mark.id === next.id ? next : mark))
}

/**
 * 可吸的同级盒：上层给的（节点）加上没在拖的标注。
 * ⚠ 正在拖的那几条要摘掉，否则它吸住自己，表现是「怎么拖都不动」。
 * @param dragging 正在拖的 id
 */
function peerBoxes(dragging: ReadonlySet<string>): readonly Twin2dSnapBox[] {
  const rest = props.marks
    .filter((mark) => !dragging.has(mark.id))
    .map((mark) => markSnapBox(mark))
  return [...props.peers, ...rest]
}

/**
 * 拖动这一批标注。
 * ⚠ 吸附只算主选中那一条，偏移原样加到其余几条上；逐条各吸各的会让一批标注散开。
 * @param lead 手抓着的那一条
 * @param ids 这一次拖的全部 id
 * @param frame 这一帧
 */
function movedMarks(
  lead: Twin2dMark,
  ids: ReadonlySet<string>,
  frame: Twin2dGestureFrame,
): readonly Twin2dMark[] {
  const box = markSnapBox(translated(lead, frame.dx, frame.dy))
  const hit = snapNodeBox(box, peerBoxes(ids), snapOptionsOf(frame.alt))
  emit('guides', hit.guides)
  const dx = frame.dx + (hit.x - box.x)
  const dy = frame.dy + (hit.y - box.y)
  return props.marks.map((mark) =>
    ids.has(mark.id) ? translated(mark, dx, dy) : mark,
  )
}

/**
 * 单轴缩放：只有被拖的那条边动，另一条钉住。
 * ⚠ 最小尺寸靠**推回被拖的边**保证，不靠翻转：翻转要在手势中途重排八个手柄，
 * 继续拖的方向会突然反过来。
 * @param start 这一轴上的起边
 * @param size 这一轴上的尺寸
 * @param dir 这一轴的方向，0 = 不动
 * @param delta 这一帧的位移
 * @param grid 网格步长，0 = 不吸
 */
function resizeAxis(
  start: number,
  size: number,
  dir: number,
  delta: number,
  grid: number,
): { start: number; size: number } {
  if (dir === 0) return { start, size }
  const end = start + size
  if (dir < 0) {
    const moved = Math.min(snapValue(start + delta, grid), end - MIN_MARK_SIZE)
    return { start: moved, size: end - moved }
  }
  const moved = Math.max(snapValue(end + delta, grid), start + MIN_MARK_SIZE)
  return { start, size: moved - start }
}

/**
 * 八向缩放。
 * @param mark 被缩放的那一条
 * @param dir 方向，两轴各取 −1 / 0 / 1
 * @param frame 这一帧
 */
function resizedMarks(
  mark: Twin2dMark,
  dir: Pt,
  frame: Twin2dGestureFrame,
): readonly Twin2dMark[] {
  const grid = gridOf(frame.alt)
  const axisX = resizeAxis(mark.x, mark.w, dir.x, frame.dx, grid)
  const axisY = resizeAxis(mark.y, mark.h, dir.y, frame.dy, grid)
  return replaced({
    ...mark,
    x: axisX.start,
    y: axisY.start,
    w: axisX.size,
    h: axisY.size,
  })
}

/**
 * 拖一个端点。
 * ⚠ 吃的是落点而不是位移：端点跟着指针走，抓偏了半个手柄也不会一路累计下去。
 * @param mark 被拖的辅助线
 * @param index 0 = 起点、1 = 终点
 * @param frame 这一帧
 */
function movedEndpoint(
  mark: Twin2dMark,
  index: number,
  frame: Twin2dGestureFrame,
): readonly Twin2dMark[] {
  const at = snapPoint(frame.to, snapOptionsOf(frame.alt))
  const moved =
    index === 0
      ? { ...mark, x: at.x, y: at.y }
      : { ...mark, x2: at.x, y2: at.y }
  return replaced(moved)
}

/**
 * 收场：整段手势只在这里上抛一次。
 * @param _frame 收场那一帧
 * @param end 怎么收的场
 */
function settle(_frame: Twin2dGestureFrame, end: Twin2dGestureEnd): void {
  const next = draft.value
  draft.value = null
  emit('guides', [])
  if (end === 'cancelled' || next === null) return
  emit('change', next)
}

/**
 * 这一次拖谁：抓的是选中集里的一条就整批一起走，否则只走它自己。
 * @param id 抓住的那一条
 */
function dragSet(id: string): ReadonlySet<string> {
  const picked = props.selectedIds.includes(id)
  return new Set(picked ? props.selectedIds : [id])
}

/**
 * 抓住一条标注：先交代选中，再起一次拖动。
 * ⚠ 已经选中的那一条不再上抛选中：上抛的话多选去拖，整批在按下那一刻就缩成一条。
 * @param mark 抓住的那一条
 * @param event 起手事件
 */
function grab(mark: Twin2dMark, event: PointerEvent): void {
  event.stopPropagation()
  event.preventDefault()
  const additive = event.ctrlKey || event.metaKey
  if (additive || !props.selectedIds.includes(mark.id)) {
    emit('pick', mark.id, additive)
  }
  // 加选那一下只切换去留：这时候拖走的是谁没有定义
  if (additive) return
  const ids = dragSet(mark.id)
  props.startGesture({
    kind: 'move',
    event,
    onMove: (frame) => {
      draft.value = movedMarks(mark, ids, frame)
    },
    onEnd: settle,
  })
}

/**
 * 起手一次八向缩放。
 * @param dir 方向
 * @param event 起手事件
 */
function startResize(dir: Pt, event: PointerEvent): void {
  const mark = focused.value
  // ⚠ 走不到：把手只在 focused 非空时才画得出来，这一条是给类型系统看的
  if (mark === null) return
  props.startGesture({
    kind: 'resize',
    event,
    onMove: (frame) => {
      draft.value = resizedMarks(mark, dir, frame)
    },
    onEnd: settle,
  })
}

/**
 * 起手拖一个端点。
 * @param index 0 = 起点、1 = 终点
 * @param event 起手事件
 */
function startEndpoint(index: number, event: PointerEvent): void {
  const mark = focused.value
  // ⚠ 同上：端点手柄同样只在 focused 非空时才画得出来
  if (mark === null) return
  props.startGesture({
    kind: 'endpoint',
    event,
    onMove: (frame) => {
      draft.value = movedEndpoint(mark, index, frame)
    },
    onEnd: settle,
  })
}

/**
 * 命中带的线宽：屏幕上恒定，但不比标注自己的描边还窄。
 * @param mark 标注
 */
function hitStrokeOf(mark: Twin2dMark): number {
  return Math.max(screenToDesignPx(HIT_BAND_PX, props.scale), mark.strokeWidth)
}

/**
 * 整块可抓还是只抓边框带。
 * ⚠ 空心框只抓边：填的是 `none` 却整块吃指针的话，框住一片节点的辅助框会把里面
 * 那些节点全部挡掉。
 * @param mark 标注
 */
function isFilled(mark: Twin2dMark): boolean {
  return mark.kind === 'text' || (mark.kind === 'rect' && mark.fill !== '')
}
</script>

<template>
  <svg
    class="t2m-layer"
    data-test="mark-layer"
    :data-layer="layer"
    :viewBox="viewBox"
    :width="canvas.width"
    :height="canvas.height"
    aria-hidden="true"
  >
    <g v-for="mark in shown" :key="mark.id" class="t2m-item">
      <Twin2dMarkShape :mark="mark" />
      <line
        v-if="editable && mark.kind === 'line'"
        class="t2m-hit"
        data-test="mark-hit"
        :data-id="mark.id"
        :x1="mark.x"
        :y1="mark.y"
        :x2="mark.x2"
        :y2="mark.y2"
        :stroke-width="hitStrokeOf(mark)"
        @pointerdown="grab(mark, $event)"
      />
      <rect
        v-else-if="editable"
        class="t2m-hit"
        :class="{ 't2m-hit--fill': isFilled(mark) }"
        data-test="mark-hit"
        :data-id="mark.id"
        :x="mark.x"
        :y="mark.y"
        :width="mark.w"
        :height="mark.h"
        :stroke-width="hitStrokeOf(mark)"
        @pointerdown="grab(mark, $event)"
      />
    </g>
    <CanvasMarkHandles
      v-if="focused !== null"
      :mark="focused"
      :scale="scale"
      @resize="startResize"
      @endpoint="startEndpoint"
    />
  </svg>
</template>

<style scoped>
/* 空白处不吃指针，只有命中面与把手接管；两层各铺满整块画布 */
.t2m-layer {
  position: absolute;
  inset: 0;
  overflow: visible;
  pointer-events: none;
}

.t2m-hit {
  fill: none;
  stroke: transparent;
  pointer-events: stroke;
  cursor: move;
}

/* 有填充的框与文字标注整块可抓 */
.t2m-hit--fill {
  fill: transparent;
  pointer-events: all;
}
</style>
