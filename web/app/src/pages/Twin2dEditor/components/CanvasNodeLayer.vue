<script setup lang="ts">
/**
 * @fileoverview 编辑画布的节点层：按文档序画节点、拖动、点选，外加选中框、旋转手柄
 * 与端口点。渲染件复用 `@dt/twin2d` 的 `Twin2dNodeBox`——编辑器与大屏所见即所得，
 * 靠的就是两边同一个渲染件。
 *
 * ⚠ 手势期间只改本地草稿，`pointerup` 才抛一次 `change`（落 commit 归上层）：一次
 * 拖动走几百个 `pointermove`，逐帧落库之后撤销键就再也按不回上一步。
 * ⚠ 同一份草稿逐帧原样抛一次 `preview`（纯变更，谁都不写文档）：连线层照
 * 「文档态 ∪ 这一帧草稿」画，不给它的话线在整个拖动过程里停在旧位置，松手才跳一次。
 * ⚠ 手势走画布壳递下来的那条总线（`startGesture`），本层不另装一副 window 监听：
 * 每层各起一台状态机的话，「上一次没收场就先顶掉它」这条互斥就不成立了。
 * ⚠ sprite 宿主归画布壳挂，本层一份都不挂：两处都挂会让同一份 symbol 在文档里重号，
 * 而一处都不挂时图标**静默消失**——`<use>` 元素照样在，只是解析不到任何目标。
 */
import {
  Twin2dNodeBox,
  applyNodeTransform,
  centerBoxOf,
  twin2dIconUrl,
} from '@dt/twin2d'
import type {
  Pt,
  Twin2dIconResolver,
  Twin2dNode,
  Twin2dNodeRotation,
  Twin2dNodeStyle,
} from '@dt/twin2d'
import { computed, shallowRef } from 'vue'
import type { CSSProperties } from 'vue'

import {
  moveNodes,
  nodePortDots,
  rotationOf,
  withNodeRotation,
} from '../scripts/portOps'
import type { Twin2dPortDot } from '../scripts/portOps'
import { snapAtScale } from '../scripts/snapping'
import type { Twin2dGuideLine, Twin2dSnapOptions } from '../scripts/snapping'
import type {
  Twin2dGestureEnd,
  Twin2dGestureFrame,
  Twin2dGestureSpec,
} from '../scripts/useCanvasPointer'
import { screenToDesignPx } from '../scripts/viewportOps'

/** 鼠标左键。 */
const LEFT_BUTTON = 0

/** 选中框的线宽（屏幕像素）。 */
const HAIRLINE_PX = 1

/** 端口点与旋转手柄的直径（屏幕像素）。 */
const DOT_PX = 9

/** 旋转手柄离节点上沿多远（屏幕像素）。 */
const HANDLE_GAP_PX = 22

/** 一条参考线都没有；不每次现造一个空表，免得下游白重画。 */
const NO_GUIDES: readonly Twin2dGuideLine[] = Object.freeze([])

/** 一个节点渲染要的那一份。 */
interface NodeView {
  node: Twin2dNode
  style: Twin2dNodeStyle
  picked: boolean
}

/** 旋转手柄：转的是哪个节点、画在哪。 */
interface SpinHandle {
  view: NodeView
  at: Pt
}

/** 一条要画的对齐参考线。 */
interface GuideView {
  key: string
  axis: Twin2dGuideLine['axis']
  style: CSSProperties
}

const props = defineProps<{
  /** 节点实例，文档序即绘制序。 */
  nodes: readonly Twin2dNode[]
  /** 节点样式（文档 ∪ 预置库，调用方合并好）。 */
  nodeStyles: readonly Twin2dNodeStyle[]
  /** 画布上选中的节点。 */
  selectedIds: readonly string[]
  /**
   * 吸附配置。
   * ⚠ `threshold` 进来时是**屏幕**像素，本层按当前倍率换成设计像素再喂吸附；
   * 不换算的话缩得越小屏幕上的吸附圈越小，缩到四分之一时基本吸不上。
   */
  snap: Twin2dSnapOptions
  /** 当前视口倍率；选中框与两种手柄按它反着缩回屏幕上的固定尺寸。 */
  scale: number
  /** 起一次手势；画布壳的指针总线出这一支，本组件不另装监听。 */
  startGesture: (spec: Twin2dGestureSpec) => boolean
  /** `asset:<uuid>` → 可直接用的地址。 */
  resolveIcon?: Twin2dIconResolver
  /**
   * 别的层（标注）这一帧吸出来的参考线，与本层自己那些画在一起。
   * ⚠ 参考线只有本层一副画法：各层各画一副的话，同一根线在两层里粗细与虚实都不一样。
   */
  extraGuides?: readonly Twin2dGuideLine[]
}>()

const emit = defineEmits<{
  /** 命中带上按下：选中这一个；`additive` = 按住 Ctrl / ⌘，并入还是顶替归上层。 */
  pick: [id: string, additive: boolean]
  /** 一手势一次：把改完的整份节点表交给上层落一次 commit。 */
  change: [nodes: readonly Twin2dNode[]]
  /** 这一帧的草稿表，不进撤销栈；null = 没有草稿了，照文档画。 */
  preview: [nodes: readonly Twin2dNode[] | null]
  /** 从一个端口点起手，交给连线预览。 */
  portGrab: [nodeId: string, portId: string, event: PointerEvent]
}>()

/**
 * 手势期间的本地草稿；null = 没在拖，或者拖了但一步都没挪。
 * ⚠ `shallowRef`：整份换引用，深响应式在每一帧上白走一遍全表。
 */
const draft = shallowRef<readonly Twin2dNode[] | null>(null)

/** 这一帧吸出来的参考线；手势收场即清空。 */
const guides = shallowRef<readonly Twin2dGuideLine[]>([])

/**
 * 换一份草稿，同一份原样交给上层。
 * ⚠ 引用没变就一次都不抛：一步都没挪的那些帧照样走到这里，抛出去就是让连线层
 * 白重算一遍全图的走线。
 * @param next 这一帧的草稿；null = 回到文档态
 */
function setDraft(next: readonly Twin2dNode[] | null): void {
  if (draft.value === next) return
  draft.value = next
  emit('preview', next)
}

const styleMap = computed<ReadonlyMap<string, Twin2dNodeStyle>>(
  () => new Map(props.nodeStyles.map((style) => [style.id, style])),
)

const nodes = computed<readonly Twin2dNode[]>(() => draft.value ?? props.nodes)

const views = computed<readonly NodeView[]>(() => {
  const styles = styleMap.value
  const picked = new Set(props.selectedIds)
  const rows: NodeView[] = []
  for (const node of nodes.value) {
    const style = styles.get(node.styleId)
    // ⚠ 样式悬空的节点整个不画（与运行态同口径）：造一个空壳出来会在图上留一块
    // 吃指针的透明区，而看不出它是谁。这种节点由诊断面板报出来
    if (style === undefined) continue
    rows.push({ node, style, picked: picked.has(node.id) })
  }
  return rows
})

/** 端口点只画选中的那几个节点：全画会让稍大的一张图糊成一片点。 */
const portDots = computed<readonly Twin2dPortDot[]>(() =>
  views.value
    .filter((view) => view.picked)
    .flatMap((view) => nodePortDots(view.node, view.style)),
)

/** 旋转手柄只在单选时给：多选时转的是谁、绕哪个中心转，都没有定义。 */
const spin = computed<SpinHandle | null>(() => {
  if (props.selectedIds.length !== 1) return null
  const view = views.value.find((item) => item.picked)
  if (view === undefined) return null
  const box = centerBoxOf(view.node, view.style.size)
  const gap = screenToDesignPx(HANDLE_GAP_PX, props.scale)
  // ⚠ 手柄跟着节点的位姿一起转：钉死在正上方的话，转过的节点一起手就跳一档
  const at = applyNodeTransform(
    { x: box.x, y: box.y - box.h / 2 - gap },
    view.node,
    view.style.size,
  )
  return { view, at }
})

/** 没显式递解析槽就走应用壳注入的那一条；两处都没有时 ico 的 `asset` 一档整枝不渲染。 */
const iconResolver = computed<Twin2dIconResolver>(
  () => props.resolveIcon ?? twin2dIconUrl,
)

/** 选中框与两种手柄的尺寸：屏幕上固定几个像素，所以要按倍率反着缩。 */
const chromeVars = computed<CSSProperties>(() => ({
  '--t2e-hair': `${screenToDesignPx(HAIRLINE_PX, props.scale)}px`,
  '--t2e-dot': `${screenToDesignPx(DOT_PX, props.scale)}px`,
}))

/** 参考线：横线钉住 top、竖线钉住 left，另一轴由 CSS 铺满整块画布。 */
const guideLines = computed<readonly GuideView[]>(() =>
  [...guides.value, ...(props.extraGuides ?? NO_GUIDES)].map((guide) => ({
    key: `${guide.axis}:${guide.at}`,
    axis: guide.axis,
    style:
      guide.axis === 'x' ? { left: `${guide.at}px` } : { top: `${guide.at}px` },
  })),
)

/** 世界坐标 → 一枚浮标的定位；居中由 CSS 的 `translate(-50%, -50%)` 管。 */
function atStyle(at: Pt): CSSProperties {
  return { left: `${at.x}px`, top: `${at.y}px` }
}

/**
 * 接下这一按：主键才归本层，接了就不再往上冒。
 * ⚠ 中键归画布壳平移、右键留给上下文菜单，这两下一律放过去；一并吞掉的表现是
 * 「按在节点上就平移不了」，而按在空白处一切正常。
 * ⚠ 接下的那一下必须 `stopPropagation`，否则「点节点」会连带被当成点空白。
 * @param event 起手的 `pointerdown`
 */
function claim(event: PointerEvent): boolean {
  if (event.button !== LEFT_BUTTON) return false
  event.stopPropagation()
  return true
}

/** Alt = 这一帧不吸附；阈值按当前倍率从屏幕像素换成设计像素。 */
function snapOf(frame: Twin2dGestureFrame): Twin2dSnapOptions {
  return snapAtScale(props.snap, props.scale, frame.alt)
}

/** Shift = 只走位移大的那根轴。 */
function axisLocked(frame: Twin2dGestureFrame): { dx: number; dy: number } {
  if (!frame.shift) return { dx: frame.dx, dy: frame.dy }
  return Math.abs(frame.dx) >= Math.abs(frame.dy)
    ? { dx: frame.dx, dy: 0 }
    : { dx: 0, dy: frame.dy }
}

/**
 * 收场。
 * ⚠ 只有 `'cancelled'` 退回去，另两档各抛一次 `change`——卸载与被顶掉都是「没走完
 * 但改动是真的」，不补这一次，拖到一半切走的改动既没进撤销栈也没落库。
 * @param end 这一手势怎么收的场
 */
function endGesture(end: Twin2dGestureEnd): void {
  const next = draft.value
  setDraft(null)
  guides.value = []
  if (next !== null && end !== 'cancelled') emit('change', next)
}

/**
 * 拖动的一帧：只改草稿。
 * ⚠ 越过起手阈值之前一步都不挪：不然「点一下」也会被吸到最近的格线上。
 * @param leadId 吸附按它算的那个节点
 * @param ids 一起挪的那一批
 * @param frame 这一帧
 */
function dragTo(
  leadId: string,
  ids: readonly string[],
  frame: Twin2dGestureFrame,
): void {
  if (!frame.moved) return
  const move = moveNodes(
    props.nodes,
    styleMap.value,
    { ids, leadId, ...axisLocked(frame) },
    snapOf(frame),
  )
  // 同一个引用 = 一步都没挪，这一手势不该在撤销栈上留一格空步
  setDraft(move.nodes === props.nodes ? null : move.nodes)
  guides.value = move.guides
}

/**
 * 起一次拖动。
 * @param leadId 抓住的那个节点
 * @param ids 一起挪的那一批
 * @param event 起手的 `pointerdown`
 * @param collapse 松手时没挪动就把整批选中收窄成这一个
 */
function startMove(
  leadId: string,
  ids: readonly string[],
  event: PointerEvent,
  collapse: boolean,
): void {
  props.startGesture({
    kind: 'move',
    event,
    onMove: (frame) => {
      dragTo(leadId, ids, frame)
    },
    onEnd: (frame, end) => {
      endGesture(end)
      if (collapse && !frame.moved) emit('pick', leadId, false)
    },
  })
}

/**
 * 旋转的一帧：只改草稿。
 * @param id 正在转的节点
 * @param base 起手时的档位
 * @param center 节点中心（世界坐标）
 * @param frame 这一帧
 */
function spinTo(
  id: string,
  base: Twin2dNodeRotation,
  center: Pt,
  frame: Twin2dGestureFrame,
): void {
  if (!frame.moved) return
  const turn = rotationOf(base, center, frame.from, frame.to)
  const next = withNodeRotation(props.nodes, id, turn)
  setDraft(next === props.nodes ? null : next)
}

/**
 * 起一次旋转。
 * ⚠ 状态机没有「旋转」这一档，借同为节点手柄的 `resize`：两种手势各自带着自己的
 * `onMove`，不靠 `kind` 分流。
 * @param handle 旋转手柄
 * @param event 起手的 `pointerdown`
 */
function startSpin(handle: SpinHandle, event: PointerEvent): void {
  if (!claim(event)) return
  const box = centerBoxOf(handle.view.node, handle.view.style.size)
  const center: Pt = { x: box.x, y: box.y }
  const base = handle.view.node.rotate
  const id = handle.view.node.id
  props.startGesture({
    kind: 'resize',
    event,
    onMove: (frame) => {
      spinTo(id, base, center, frame)
    },
    onEnd: (_frame, end) => {
      endGesture(end)
    },
  })
}

/**
 * 在一个端口点上起手：交给连线预览，不当成拖节点。
 * @param dot 被点的端口点
 * @param event 起手的 `pointerdown`
 */
function onPortDown(dot: Twin2dPortDot, event: PointerEvent): void {
  if (!claim(event)) return
  emit('portGrab', dot.nodeId, dot.portId, event)
}

/**
 * 在一个节点上起手。
 * ⚠ 已经在选中里的节点点下去先按「整批一起挪」算，松手没挪动才收窄成单选：
 * 起手就收窄的话，多选之后一拖就只剩一个节点在动。
 * @param view 被点的节点
 * @param event 起手的 `pointerdown`
 */
function onNodeDown(view: NodeView, event: PointerEvent): void {
  if (!claim(event)) return
  const id = view.node.id
  if (event.ctrlKey || event.metaKey) {
    emit('pick', id, true)
    return
  }
  const inPick = props.selectedIds.includes(id)
  if (!inPick) emit('pick', id, false)
  startMove(id, inPick ? props.selectedIds : [id], event, inPick)
}
</script>

<template>
  <div class="t2e-nodes" data-test="node-layer" :style="chromeVars">
    <Twin2dNodeBox
      v-for="view in views"
      :key="view.node.id"
      class="t2e-node"
      :class="{ 't2e-node--picked': view.picked }"
      :node="view.node"
      :node-style="view.style"
      :id-prefix="view.node.id"
      :resolve-icon="iconResolver"
      @pointerdown="onNodeDown(view, $event)"
    />
    <span
      v-for="guide in guideLines"
      :key="guide.key"
      class="t2e-guide"
      :class="`t2e-guide--${guide.axis}`"
      data-test="node-guide"
      :style="guide.style"
    />
    <span
      v-for="dot in portDots"
      :key="dot.key"
      class="t2e-port"
      data-test="node-port"
      :data-id="dot.portId"
      :data-node="dot.nodeId"
      :data-side="dot.side"
      :style="atStyle(dot.at)"
      :title="dot.name"
      @pointerdown="onPortDown(dot, $event)"
    />
    <span
      v-if="spin !== null"
      class="t2e-spin"
      data-test="node-rotate"
      :data-id="spin.view.node.id"
      :style="atStyle(spin.at)"
      title="旋转"
      @pointerdown="startSpin(spin, $event)"
    />
  </div>
</template>

<style scoped lang="scss">
// ⚠ 整层不吃指针：吃了的话点空白就落在本层身上，框选与「点空白清选中」一起失效
.t2e-nodes {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.t2e-node {
  pointer-events: auto;
  cursor: move;
  user-select: none;
}

// ⚠ 图元自己的指针设置会吃掉起手那一下，表现是「有些节点拖不动」，而拖不动的是
// 哪几个取决于它们内部长什么样
.t2e-node :deep(*) {
  pointer-events: none;
}

// 选中框用 outline 不用 border：border 会把节点盒撑大半个像素，选中一下图就动一下
.t2e-node--picked {
  outline: var(--t2e-hair) solid var(--accent-primary);
}

// 参考线与同级的标注层同一副样子：一条虚线，不吃指针
.t2e-guide {
  position: absolute;
  pointer-events: none;
}

.t2e-guide--x {
  top: 0;
  bottom: 0;
  width: var(--t2e-hair);
  background: repeating-linear-gradient(
    to bottom,
    var(--accent-primary) 0 3px,
    transparent 3px 6px
  );
}

.t2e-guide--y {
  right: 0;
  left: 0;
  height: var(--t2e-hair);
  background: repeating-linear-gradient(
    to right,
    var(--accent-primary) 0 3px,
    transparent 3px 6px
  );
}

.t2e-port,
.t2e-spin {
  position: absolute;
  width: var(--t2e-dot);
  height: var(--t2e-dot);
  border: var(--t2e-hair) solid var(--accent-primary);
  border-radius: 50%;
  background: var(--surface-base);
  pointer-events: auto;
  transform: translate(-50%, -50%);
}

.t2e-port {
  cursor: crosshair;
}

.t2e-spin {
  cursor: grab;
  background: var(--accent-primary);
}
</style>
