<script setup lang="ts">
/**
 * @fileoverview 连线层：一层 `<svg>` 里逐条画多遍描边、端点箭头与沿路径的标签，外加
 * 端口上的引脚符号。属性全由 `edgeView.ts` 算好，本文件只把它们贴到元素上——样式
 * 与几何在这里再算一遍就是第二份真源。口径见 docs/MODULE_TWIN_2D_DESIGN.md §7.9。
 */
import { computed } from 'vue'

import { TWIN_2D_DEFAULT_FLOW_SPEED } from '../constants'
import { buildEdgeViews, buildPinViews } from '../edgeView'
import { posDim } from '../sanitize'
import type { Twin2dEdgeState, Twin2dEdgeView } from '../edgeView'
import type {
  Twin2dEdge,
  Twin2dEdgeStyle,
  Twin2dNode,
  Twin2dNodeStyle,
} from '../types'

/** viewBox 的除零护栏：`0 0 0 0` 会让整层什么都不画 */
const MIN_CANVAS = 1
/** 流动那一遍描边挂的类，规则与 keyframes 都在 twin2d.scss */
const FLOW_CLASS = 't2-anim-dash'

const props = withDefaults(
  defineProps<{
    /** 连线实例，文档序即绘制序。 */
    edges: readonly Twin2dEdge[]
    /** 连线样式（文档 ∪ 预置库，调用方合并好）。 */
    edgeStyles: readonly Twin2dEdgeStyle[]
    /** 节点实例：两端落点与引脚都从它算。 */
    nodes: readonly Twin2dNode[]
    /** 节点样式（文档 ∪ 预置库，调用方合并好）。 */
    nodeStyles: readonly Twin2dNodeStyle[]
    /** 按连线 id 取运行态；没有这一行时按缺省（活跃、不反向、无标签）画。 */
    states?: Readonly<Record<string, Twin2dEdgeState>>
    /** 流动动画总闸；关掉时样式里怎么配都不动（§7.9 #67）。 */
    animateFlow?: boolean
    /** 流动速度全局倍率：最终时长 = 样式的基准时长 ÷ 它。 */
    flowSpeed?: number
    /** 画布宽（设计像素）。 */
    width: number
    /** 画布高（设计像素）。 */
    height: number
  }>(),
  {
    states: () => ({}),
    animateFlow: false,
    flowSpeed: TWIN_2D_DEFAULT_FLOW_SPEED,
  },
)

const viewBox = computed(() => {
  const w = posDim(props.width, MIN_CANVAS)
  const h = posDim(props.height, MIN_CANVAS)
  return `0 0 ${w} ${h}`
})

const edgeViews = computed(() =>
  buildEdgeViews({
    edges: props.edges,
    edgeStyles: props.edgeStyles,
    nodes: props.nodes,
    nodeStyles: props.nodeStyles,
    states: props.states,
    flow: { animate: props.animateFlow, speed: props.flowSpeed },
  }),
)

const pinViews = computed(() => buildPinViews(props.nodes, props.nodeStyles))

/**
 * 一条连线挂在组上的内联样式。
 * ⚠ 三个 `--t2-*` 的名字只在这里出现一次：`--t2-anim-dur` 与 `--t2-dash-end` 跟
 * `twin2d.scss` 的 `.t2-anim-dash` / `@keyframes t2-dash` 是一对，改名要两处一起改
 * （`twin2d-css-vars.contract.spec.ts` 守这条）。
 * ⚠ 边色出的是自定义属性而不是 `color: var(...)`：值里带 `var()` 的标准属性会被
 * happy-dom 的 CSSOM 整条丢掉，浏览器上没事、用例里却断言不到。
 * @param view 这条连线的绘制输入
 */
function edgeCssOf(view: Twin2dEdgeView): Record<string, string> {
  const css: Record<string, string> = { '--t2-accent': view.accent }
  if (view.opacity !== null) css['opacity'] = String(view.opacity)
  if (view.flow !== null) {
    css['--t2-anim-dur'] = `${view.flow.durationMs}ms`
    css['--t2-dash-end'] = `${view.flow.dashEnd}px`
  }
  return css
}
</script>

<template>
  <svg
    class="t2-edges"
    :viewBox="viewBox"
    :width="width"
    :height="height"
    aria-hidden="true"
  >
    <g
      v-for="pin in pinViews"
      :key="pin.id"
      data-test="pin"
      :data-id="pin.id"
      :transform="pin.transform"
    >
      <component
        :is="pin.tag"
        v-for="layer in pin.layers"
        :key="layer.id"
        v-bind="layer.attrs"
      />
    </g>
    <g
      v-for="edge in edgeViews"
      :key="edge.id"
      class="t2-edge"
      data-test="edge"
      :data-id="edge.id"
      :style="edgeCssOf(edge)"
    >
      <path
        v-for="stroke in edge.strokes"
        :key="stroke.id"
        v-bind="stroke.attrs"
        data-test="edge-stroke"
        :class="{ [FLOW_CLASS]: stroke.flowing }"
        :d="edge.path"
      />
      <polygon
        v-for="marker in edge.markers"
        :key="marker.id"
        v-bind="marker.attrs"
        data-test="edge-marker"
        :data-id="marker.id"
      />
      <rect
        v-if="edge.label !== null && edge.label.box !== null"
        v-bind="edge.label.box"
        data-test="edge-label-box"
      />
      <text
        v-if="edge.label !== null"
        v-bind="edge.label.attrs"
        data-test="edge-label"
        :style="edge.label.style"
      >
        {{ edge.label.text }}
      </text>
    </g>
  </svg>
</template>

<style scoped>
/* 边色注在组上的 --t2-accent 里，描边与箭头都靠 currentColor 取它。
   .t2-edges 的定位与 .t2-anim-dash 的动画都在 twin2d.scss，这里不重写第二份 */
.t2-edge {
  color: var(--t2-accent, var(--accent-primary));
}
</style>
