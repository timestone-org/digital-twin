<script setup lang="ts">
/**
 * @fileoverview 2D 孪生编辑器的视口壳：平移与缩放、屏幕 ⇄ 设计坐标换算，以及一条
 * 指针总线——各画布层从插槽里接过手势入口，自己不碰视口也不另装监听。
 *
 * ⚠ sprite 宿主在这里挂一次（运行态那一份挂在 `Twin2dStage` 里）：漏挂时
 * `<use href="#…">` 解析不到任何东西——图标**静默消失**，而 `<use>` 元素还在。
 * ⚠ 手势期间只写视口这份纯状态，松手那一下才由 `onEnd` 收一次场：逐帧落库的话，
 * 拖一次画布就能往撤销栈里塞进几百帧。
 * ⚠ 容器宽高为 0（首帧、被隐藏的页签）时取景一律回单位视口：
 * `translate(NaN, NaN)` 会让整块空白，而 devtools 里看什么都正常。
 */
import { Twin2dIconSprite } from '@dt/twin2d'
import type { Pt, Twin2dCanvas } from '@dt/twin2d'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import { TWIN_2D_STYLE_DRAG_MIME } from '../scripts/paletteDrag'
import { useCanvasPointer } from '../scripts/useCanvasPointer'
import type {
  Twin2dGestureFrame,
  Twin2dGestureSpec,
} from '../scripts/useCanvasPointer'
import {
  TWIN_2D_IDENTITY_VIEW,
  designPointAt,
  fitView,
  localPoint,
  panBy,
  stageStyle,
  toLocalPoint,
  zoomByFactor,
  zoomByWheel,
} from '../scripts/viewportOps'
import type {
  Twin2dClientPoint,
  Twin2dViewBox,
  Twin2dViewport,
} from '../scripts/viewportOps'
import CanvasGrid from './CanvasGrid.vue'

/** 鼠标左键。 */
const LEFT_BUTTON = 0

/** 鼠标中键：任何工具下按住它都是平移。 */
const MIDDLE_BUTTON = 1

/**
 * 画布交给各层的那一套：视口、当前手势、两个方向的换算，以及手势总线。
 * ⚠ 各层只认这一份：自己再量一次宿主、或自己装一副 window 监听，就是第二份真源，
 * 而两份视口对不上的表现是「画出来的位置与点得中的位置差一截」。
 */
interface Twin2dCanvasApi {
  view: Twin2dViewport
  /** 正在进行的那一帧手势；没有手势时 null。 */
  gesture: Twin2dGestureFrame | null
  /** 指针 → 设计坐标；宿主还没挂上时 null。 */
  toDesign: (at: Twin2dClientPoint) => Pt | null
  /** 设计坐标 → 宿主内屏幕坐标，屏幕坐标系的浮层按它摆位。 */
  toLocal: (design: Pt) => Pt
  /** 起一次手势；起点算不出来时返回 false。 */
  startGesture: (spec: Twin2dGestureSpec) => boolean
  /** 主动收场，按「取消」算。 */
  cancelGesture: () => void
}

const props = withDefaults(
  defineProps<{
    /** 画布自己的坐标系、栅格与网格开关。 */
    canvas: Twin2dCanvas
    /** 「适应」的信号：每加一次就重新取一次景。 */
    fitRequest?: number
    /** 手型工具：按下左键即平移，这一按不再落到各层上。 */
    panMode?: boolean
    /**
     * 容器尺寸（CSS 像素）；给了就用它，不给才装 `ResizeObserver` 自己量。
     * ⚠ 用例必须给：happy-dom 的 `getBoundingClientRect` 恒 0，量出来的是 0×0。
     */
    hostSize?: Twin2dViewBox | null
  }>(),
  { fitRequest: 0, panMode: false, hostSize: null },
)

const emit = defineEmits<{
  /** 视口变了（平移、缩放、取景）；顶栏的倍率读数按它刷新。 */
  viewChange: [view: Twin2dViewport]
  /**
   * 左键按在空白上：清选中还是起框选由页面定。
   * ⚠ 各层接下这一按时必须 `stopPropagation`，否则「点节点」会连带被当成点空白。
   */
  backgroundDown: [event: PointerEvent]
  /**
   * 调色板上那一项落在画布上了；给的是**设计坐标**的落点。
   * ⚠ 只有这一层接得住：落点要过宿主矩形与视口两道换算才成设计坐标，而这两样
   * 都只在本层，各层从插槽里接到的也是本层这一份。
   */
  dropStyle: [styleId: string, at: Pt]
}>()

defineSlots<{
  /** 舞台内（设计坐标系）的各层：节点、连线、标注、把手。 */
  default: (props: Twin2dCanvasApi) => unknown
  /** 宿主内（屏幕坐标系）的浮层：读数浮标、比例尺一类不随倍率缩放的东西。 */
  overlay: (props: Twin2dCanvasApi) => unknown
}>()

const host = ref<HTMLElement | null>(null)
const view = ref<Twin2dViewport>({ ...TWIN_2D_IDENTITY_VIEW })
const measured = ref<Twin2dViewBox>({ width: 0, height: 0 })

let observer: ResizeObserver | null = null
/** 已经自动取过一次景；之后容器再变尺寸也不动用户调好的视口。 */
let framed = false

const box = computed<Twin2dViewBox>(() => props.hostSize ?? measured.value)

/**
 * 换一份视口并广播出去。
 * @param next 新视口
 */
function setView(next: Twin2dViewport): void {
  view.value = next
  emit('viewChange', next)
}

/** 取景：整张画布等比缩进容器并居中。 */
function fit(): void {
  setView(fitView(props.canvas, box.value))
}

/**
 * 工具栏那一档缩放：锚在视口正中。
 * @param factor 这一次的倍率，放大给一档、缩小给它的倒数
 */
function zoomBy(factor: number): void {
  setView(zoomByFactor(view.value, box.value, factor))
}

/**
 * 指针 → 设计坐标。
 * ⚠ 宿主还没挂上时回 null：这一帧换算不出来，手势就不起（`useCanvasPointer` 的口径）。
 * @param at 指针事件
 */
function toDesign(at: Twin2dClientPoint): Pt | null {
  const el = host.value
  return el === null
    ? null
    : designPointAt(view.value, el.getBoundingClientRect(), at)
}

/**
 * 设计坐标 → 宿主内屏幕坐标。
 * @param design 设计坐标
 */
function toLocal(design: Pt): Pt {
  return toLocalPoint(view.value, design)
}

const pointer = useCanvasPointer({ toDesign })

const api = computed<Twin2dCanvasApi>(() => ({
  view: view.value,
  gesture: pointer.frame.value,
  toDesign,
  toLocal,
  startGesture: pointer.start,
  cancelGesture: pointer.cancel,
}))

const stage = computed(() => stageStyle(view.value, props.canvas))

const panning = computed(() => pointer.kind.value === 'pan')

/**
 * 起一次平移。
 * ⚠ 每一帧都从**起手那一刻**的视口算起：`clientDx` 是累计位移，拿当前视口去累加
 * 会让画面越拖越快（第 n 帧挪了 n 倍），而那看起来像「鼠标飘了」。
 * ⚠ `'interrupted'`（卸载、被下一次起手顶掉）与 `'done'` 同档收：拖到一半切走的
 * 那段位移是真的，退回去等于把用户刚找到的取景丢了。
 * @param event 起手的那个 pointerdown
 */
function startPan(event: PointerEvent): void {
  const base = view.value
  const moved = (frame: Twin2dGestureFrame): Twin2dViewport =>
    panBy(base, frame.clientDx, frame.clientDy)
  pointer.start({
    kind: 'pan',
    event,
    onMove: (frame) => {
      setView(moved(frame))
    },
    onEnd: (frame, end) => {
      setView(end === 'cancelled' ? base : moved(frame))
    },
  })
}

/**
 * 这一按是不是平移。
 * @param event 起手的那个 pointerdown
 */
function isPanPress(event: PointerEvent): boolean {
  if (event.button === MIDDLE_BUTTON) return true
  return props.panMode && event.button === LEFT_BUTTON
}

/**
 * ⚠ 走捕获相：手型工具与中键要压过各层自己的手势，冒泡相抢不过——那时节点已经
 * 跟着走了半程。
 * @param event 起手的那个 pointerdown
 */
function onCaptureDown(event: PointerEvent): void {
  if (!isPanPress(event)) return
  event.stopPropagation()
  // 中键按下的默认动作是自动滚动，左键的是选文字，两样都会打断拖拽
  event.preventDefault()
  startPan(event)
}

/**
 * 左键按在空白上。
 * ⚠ 三道闸都不能省：非左键留给右键菜单，平移那一按已经在捕获相接走了，而手势进行
 * 中的这一按是同一次按下冒泡上来的（捕获与冒泡在**同一个元素**上都会触发）。
 * @param event 这一次 pointerdown
 */
function onHostDown(event: PointerEvent): void {
  if (event.button !== LEFT_BUTTON) return
  if (isPanPress(event) || pointer.kind.value !== null) return
  emit('backgroundDown', event)
}

/**
 * 滚轮缩放，锚在指针底下。
 * @param event 这一次 wheel
 */
function onWheel(event: WheelEvent): void {
  const el = host.value
  if (el === null) return
  const anchor = localPoint(el.getBoundingClientRect(), event)
  setView(zoomByWheel(view.value, event.deltaY, anchor))
}

/**
 * 这一手拖的是不是调色板上的样式。
 * ⚠ 只认 `types`：`dragover` 阶段按规范读不到 dataTransfer 里的**数据**，那时
 * `getData` 恒回空串——拿它当判据的话，整个画布对任何一手拖拽都判「这里不收」。
 * @param event 那一下拖拽事件
 */
function isStyleDrag(event: DragEvent): boolean {
  return event.dataTransfer?.types.includes(TWIN_2D_STYLE_DRAG_MIME) === true
}

/**
 * 拖着东西悬在画布上（`dragenter` 与 `dragover` 同一支）。
 * ⚠ 收得下时必须 `preventDefault`：不拦掉浏览器的缺省动作，`drop` 根本不会发——
 * 表现是从左栏拖下来松手，画布上什么都没有且零报错。
 * ⚠ 两个事件都要拦：只拦 `dragover` 时 Chrome 照常收，Firefox 那一路却是进不来的。
 * ⚠ 不认识的那些一律不拦：拦了的话，从别处拖进来的文件与文字也会在这里被「接住」，
 * 而画布对它们一个字都做不了，只剩一个骗人的「可以放」光标。
 * @param event 那一下 dragenter / dragover
 */
function onDragHover(event: DragEvent): void {
  if (!isStyleDrag(event)) return
  event.preventDefault()
  // 光标带个「+」：这一手是照着样式新建，不是把左栏那一项搬走
  if (event.dataTransfer !== null) event.dataTransfer.dropEffect = 'copy'
}

/**
 * 在画布上松手。
 * ⚠ 落点换算不出来（宿主还没挂上）时什么都不做：硬落一个的话，节点会出现在
 * 画布原点上，而用户以为自己拖歪了。
 * @param event 那一下 drop
 */
function onDrop(event: DragEvent): void {
  if (!isStyleDrag(event)) return
  event.preventDefault()
  const styleId = event.dataTransfer?.getData(TWIN_2D_STYLE_DRAG_MIME) ?? ''
  const at = toDesign(event)
  if (styleId === '' || at === null) return
  emit('dropStyle', styleId, at)
}

/**
 * 量一次容器。
 * @param el 宿主元素
 */
function measure(el: HTMLElement): void {
  const rect = el.getBoundingClientRect()
  measured.value = { width: rect.width, height: rect.height }
}

onMounted(() => {
  const el = host.value
  if (el === null) return
  measure(el)
  observer = new ResizeObserver(() => {
    measure(el)
  })
  observer.observe(el)
})

// ⚠ 卸载必清理：Observer 不摘就跟着元素一起留在观察表里，这一页开几天就是一串
onBeforeUnmount(() => {
  observer?.disconnect()
  observer = null
})

watch(() => props.fitRequest, fit)

// 头一次量到非零尺寸时自动取一次景：首帧是 0×0，那时取景只会得到单位视口
watch(
  box,
  (current) => {
    if (framed || current.width <= 0 || current.height <= 0) return
    framed = true
    fit()
  },
  { immediate: true },
)

defineExpose({ view, fit, zoomBy })
</script>

<template>
  <div
    ref="host"
    class="dt-twin2d-canvas"
    :class="{
      'dt-twin2d-canvas--pan': panMode,
      'dt-twin2d-canvas--panning': panning,
    }"
    data-test="canvas-host"
    @wheel.prevent="onWheel"
    @pointerdown.capture="onCaptureDown"
    @pointerdown="onHostDown"
    @dragenter="onDragHover"
    @dragover="onDragHover"
    @drop="onDrop"
  >
    <Twin2dIconSprite />
    <CanvasGrid :canvas="canvas" :view="view" />
    <div
      class="dt-twin2d-canvas__stage"
      :style="stage"
      data-test="canvas-stage"
    >
      <slot v-bind="api" />
    </div>
    <slot name="overlay" v-bind="api" />
  </div>
</template>

<style scoped lang="scss">
.dt-twin2d-canvas {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: var(--surface-base);
  // ⚠ 不写这一条，触屏与触控板会把拖拽认成滚动页面：pointermove 中途就断了，
  // 表现是「拖一下就松手」，而鼠标上一切正常
  touch-action: none;
}

.dt-twin2d-canvas--pan {
  cursor: grab;
}

.dt-twin2d-canvas--panning {
  cursor: grabbing;
}

// 设计坐标系的根：尺寸与那一串 transform 全由 `stageStyle` 出，这里只定位
.dt-twin2d-canvas__stage {
  position: absolute;
  top: 0;
  left: 0;
}
</style>
