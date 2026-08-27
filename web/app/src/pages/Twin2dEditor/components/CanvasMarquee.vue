<script setup lang="ts">
/**
 * @fileoverview 框选：在画布空白处拖出一个矩形，框住的实体整批交给选中态。
 * 起手由画布背景那一按经 `source` 递进来，框本身画在设计坐标里。
 *
 * ⚠ 判定用**包围盒相交**而不是完全包含：要求完全包含的话，框住一条横穿画面的长连线
 * 得把整屏都拖进去，而用户想的只是「圈这一片」。
 * ⚠ 框选期间一个字都不写文档，松手才把命中上抛：拖框只是在选东西，中途改文档会让
 * 撤销栈里多出一堆没人要的帧。
 * ⚠ 一次只出一类（节点 / 连线 / 标注）：选中轴恒定同类，混着一批的话右栏要同时画
 * 两种检查器，而那是没有的。
 */
import type { Twin2dCanvas } from '@dt/twin2d'
import { computed, shallowRef, watch } from 'vue'

import type { Twin2dEntityBox } from '../scripts/entityBoxes'
import type { Twin2dPickKind } from '../scripts/editorSelection'
import type { Twin2dSnapBox } from '../scripts/snapping'
import type {
  Twin2dGestureEnd,
  Twin2dGestureFrame,
  Twin2dGestureSpec,
} from '../scripts/useCanvasPointer'
import { canvasViewBox } from '../scripts/viewportOps'

/**
 * 同时框到多类时按这个次序取先有的那一类。
 * ⚠ 节点在最前：辅助框与连线常常铺在一片节点底下，标注优先的话「圈一片设备」
 * 会选出一个辅助框。
 */
const PICK_ORDER: readonly Twin2dPickKind[] = ['nodes', 'edges', 'marks']

/** 一批命中。 */
interface Twin2dMarqueeHit {
  kind: Twin2dPickKind
  ids: readonly string[]
}

const props = defineProps<{
  canvas: Twin2dCanvas
  /** 全部候选实体。 */
  targets: readonly Twin2dEntityBox[]
  /** 画布背景那一按；换一个 `event` 对象即起一次新框选，null = 没在框。 */
  source: PointerEvent | null
  /** 起一次手势；画布的指针总线出这一支，本组件不另装监听。 */
  startGesture: (spec: Twin2dGestureSpec) => boolean
}>()

const emit = defineEmits<{
  /** 框住了一批同类实体；`additive` = 按住 Ctrl / ⌘，由上层决定并入还是顶替。 */
  pick: [kind: Twin2dPickKind, ids: readonly string[], additive: boolean]
  /** 点了空白：清选中。加选时不发。 */
  clear: []
  /** 这一手收场了（选中或落空都发），调用方借它把 `source` 清空。 */
  done: []
}>()

/** 正在拖的框；null = 没在框选，或还没越过起手阈值。 */
const box = shallowRef<Twin2dSnapBox | null>(null)

/** 已经起过手的那个事件；同一个对象不重复起手。 */
let started: PointerEvent | null = null

const viewBox = computed(() => canvasViewBox(props.canvas))

/**
 * 这一帧的框：起手点与当前点的外接盒，往哪个方向拖都一样。
 * @param frame 这一帧
 */
function rectOf(frame: Twin2dGestureFrame): Twin2dSnapBox {
  return {
    x: Math.min(frame.from.x, frame.to.x),
    y: Math.min(frame.from.y, frame.to.y),
    w: Math.abs(frame.to.x - frame.from.x),
    h: Math.abs(frame.to.y - frame.from.y),
  }
}

/**
 * 两个盒相交没有。
 * ⚠ 边界算相交：横平竖直的辅助线与直连线的包围盒有一边是 0，严格判的话它们
 * 永远框不中。
 * @param rect 框
 * @param target 候选盒
 */
function overlaps(rect: Twin2dSnapBox, target: Twin2dSnapBox): boolean {
  return (
    rect.x <= target.x + target.w &&
    rect.x + rect.w >= target.x &&
    rect.y <= target.y + target.h &&
    rect.y + rect.h >= target.y
  )
}

/**
 * 框里的一批：按 `PICK_ORDER` 取先有的那一类，一个都没框中回 null。
 * @param rect 框
 */
function hitsOf(rect: Twin2dSnapBox): Twin2dMarqueeHit | null {
  for (const kind of PICK_ORDER) {
    const ids = props.targets
      .filter((target) => target.kind === kind && overlaps(rect, target.box))
      .map((target) => target.id)
    if (ids.length > 0) return { kind, ids }
  }
  return null
}

/**
 * 收场：这里才动选中态。
 * ⚠ 撤掉的那一框（`'cancelled'`）什么都不做；被顶掉或卸载打断的照样落，它是真拖过的。
 * ⚠ 「清选中」只认真正的松手：卸载打断时清一次选中，等于用户切个页签回来发现选中
 * 没了，而他什么都没点。
 * @param frame 收场那一帧
 * @param end 怎么收的场
 */
function settle(frame: Twin2dGestureFrame, end: Twin2dGestureEnd): void {
  const drawn = box.value
  box.value = null
  emit('done')
  if (end === 'cancelled') return
  const hit = drawn === null ? null : hitsOf(drawn)
  if (hit !== null) {
    emit('pick', hit.kind, hit.ids, frame.additive)
    return
  }
  if (end === 'done' && !frame.additive) emit('clear')
}

/**
 * 起一次框选。
 * @param event 画布背景上的那个 `pointerdown`
 */
function begin(event: PointerEvent): void {
  props.startGesture({
    kind: 'marquee',
    event,
    onMove: (frame) => {
      // ⚠ 没越过起手阈值就不画也不选：点一下空白是「清选中」，不是一个 0×0 的框
      box.value = frame.moved ? rectOf(frame) : null
    },
    onEnd: settle,
  })
}

watch(
  () => props.source,
  (next) => {
    if (next === null || next === started) return
    started = next
    begin(next)
  },
)
</script>

<template>
  <svg
    class="t2-marquee"
    data-test="marquee"
    :viewBox="viewBox"
    :width="canvas.width"
    :height="canvas.height"
    aria-hidden="true"
  >
    <rect
      v-if="box !== null"
      class="t2-marquee__box"
      data-test="marquee-box"
      :x="box.x"
      :y="box.y"
      :width="box.w"
      :height="box.h"
      vector-effect="non-scaling-stroke"
    />
  </svg>
</template>

<style scoped>
.t2-marquee {
  position: absolute;
  inset: 0;
  overflow: visible;
  pointer-events: none;
}

.t2-marquee__box {
  fill: color-mix(in srgb, var(--accent-primary) 12%, transparent);
  stroke: var(--accent-primary);
  stroke-width: 1;
  stroke-dasharray: 4 3;
}
</style>
