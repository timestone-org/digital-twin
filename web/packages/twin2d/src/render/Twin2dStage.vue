<script setup lang="ts">
/**
 * @fileoverview 舞台：按容器尺寸把画布等比缩放贴进模块矩形（`fitMode` 四档）、钉死六层
 * 的层序、画底图与图案底、一个节点都没有时出空态，并把 sprite 宿主在每个 DOM 文档里
 * 挂一次。口径见 docs/MODULE_TWIN_2D_DESIGN.md §9.1、§7.10。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

import {
  TWIN_2D_DEFAULT_FIT_PADDING,
  TWIN_2D_DEFAULT_FLOW_SPEED,
} from '../constants'
import { sanitizeCssValue } from '../cssValue'
import Twin2dEdgeLayer from './Twin2dEdgeLayer.vue'
import Twin2dIconSprite from './Twin2dIconSprite.vue'
import Twin2dNodeBox from './Twin2dNodeBox.vue'
import type { Twin2dEdgeState } from '../edgeView'
import type { Twin2dSlotValues } from '../expr'
import type { Twin2dBackgroundFit, Twin2dFitMode, Twin2dStatus } from '../kinds'
import type { Twin2dIconResolver, Twin2dSlotRead } from '../paintText'
import type {
  Twin2dCanvas,
  Twin2dEdge,
  Twin2dEdgeStyle,
  Twin2dMark,
  Twin2dNode,
  Twin2dNodeStyle,
} from '../types'

/** 空态文案：这张图上一个节点、一条标注都没有时的那一行 */
const EMPTY_TEXT = '这张 2D 孪生还没有画任何节点'
/** 归一百分比的分母 */
const PERCENT = 100
/** 素材引用前缀 */
const ASSET_PREFIX = 'asset:'
/** 素材解析槽未注入时的空地址 */
const NO_ASSET_URL = ''
/** 会把 `url()` 提前闭合的字符 */
const URL_UNSAFE_RE = /["'()\\\s]/
/** 底图地址允许的前缀 */
const IMAGE_PREFIXES = ['https://', 'http://', 'data:', '/'] as const
/** 图案色缺省：参考项目那三个变量全仓无定义、只活在 `var()` 的兜底位上（§7 #76） */
const PATTERN_FALLBACK =
  'color-mix(in srgb, var(--accent-primary) 5%, transparent)'
/** 斜织两层的角度 */
const WEAVE_ANGLES = [45, -45] as const
/** 平行线那一档的角度 */
const LINES_ANGLE = 0
/**
 * 同一个 DOM 文档里 sprite 宿主已经有主了的标记。
 * ⚠ 记在文档上而不是模块变量里：宿主挂进的是文档，判据就该在文档上。同一份包被打进
 * 两份产物（运行态与编辑器各一份）时模块变量各算各的，两边都会判成没挂过。
 */
const SPRITE_CLAIM_ATTR = 'data-twin2d-sprite'

/**
 * 底图四档铺法。
 * ⚠ 与 `paintBox` 里图元底图那一份是同一张表的两处落点（那边服务图元的 `fills`、
 * 这边服务画布底图），改了要两处一起改。
 */
const IMAGE_FIT: Readonly<Record<Twin2dBackgroundFit, string>> = Object.freeze({
  cover: 'center center / cover no-repeat',
  contain: 'center center / contain no-repeat',
  stretch: 'center center / 100% 100% no-repeat',
  tile: 'left top / auto repeat',
})

/** 空读数表共用一份：每次求值都换一个新 Map 等于告诉子组件「数据变了」。 */
const EMPTY_SLOTS: Twin2dSlotValues = new Map<string, unknown>()

/** 素材解析槽未注入时的空解析 */
const NO_ICON_RESOLVER: Twin2dIconResolver = () => NO_ASSET_URL

/** 舞台与流动动画那四个顶层配置键；模块壳读了递进来，包里一处都不读配置（§3.2）。 */
interface Twin2dStageView {
  fitMode: Twin2dFitMode
  fitPadding: number
  animateFlow: boolean
  flowSpeed: number
}

/** 运行态注入的那一份；缺哪一项就按「这一项没有数据」渲染。 */
interface Twin2dStageLive {
  /** 按节点 id 的状态覆盖；`null` = 不覆盖配置里的静态状态（§10.1）。 */
  status?: Readonly<Record<string, Twin2dStatus | null>>
  /** 按节点 id 的槽读数。 */
  slots?: Readonly<Record<string, Twin2dSlotValues>>
  /** 按节点 id 与槽键取口径与读数。 */
  readSlot?: (nodeId: string, key: string) => Twin2dSlotRead | null
  /** 按连线 id 的运行态。 */
  edges?: Readonly<Record<string, Twin2dEdgeState>>
  /** `asset:<uuid>` → 可直接用的地址。 */
  resolveIcon?: Twin2dIconResolver
}

/** 容器尺寸（CSS 像素）。 */
interface Twin2dStageBox {
  w: number
  h: number
}

/** 一次缩放贴合的结果：两轴倍率与居中位移。 */
interface Twin2dStageFit {
  sx: number
  sy: number
  dx: number
  dy: number
}

/** 一个节点渲染要的那一份：实例、样式与它自己那份运行态。 */
interface Twin2dNodeView {
  node: Twin2dNode
  style: Twin2dNodeStyle
  status: Twin2dStatus | null
  slots: Twin2dSlotValues
  readSlot: (key: string) => Twin2dSlotRead | null
}

const props = withDefaults(
  defineProps<{
    /** 画布：自己的坐标系、底图与图案底。 */
    canvas: Twin2dCanvas
    /** 节点实例，文档序即绘制序。 */
    nodes: readonly Twin2dNode[]
    /** 连线实例。 */
    edges: readonly Twin2dEdge[]
    /** 标注：舞台只按 `zOrder` 分成上下两层，画法交给两个同名插槽。 */
    marks: readonly Twin2dMark[]
    /** 节点样式（文档 ∪ 预置库，调用方合并好）。 */
    nodeStyles: readonly Twin2dNodeStyle[]
    /** 连线样式（文档 ∪ 预置库，调用方合并好）。 */
    edgeStyles: readonly Twin2dEdgeStyle[]
    /** 舞台那四个顶层配置键。 */
    view?: Twin2dStageView
    /** 运行态注入的状态、读数与素材解析。 */
    live?: Twin2dStageLive
    /** 容器尺寸；给了就用它，不给才装 `ResizeObserver` 自己量。 */
    containerSize?: Twin2dStageBox | null
  }>(),
  {
    // ⚠ 缺省对象只能就地写：`defineProps` 会被提到 setup 之外，引用本文件里声明的
    // 变量在编译期就被打回（那一条 vue-tsc 拦不住）
    view: () => ({
      fitMode: 'contain',
      fitPadding: TWIN_2D_DEFAULT_FIT_PADDING,
      animateFlow: false,
      flowSpeed: TWIN_2D_DEFAULT_FLOW_SPEED,
    }),
    live: () => ({}),
    containerSize: null,
  },
)

/**
 * ⚠ 模板里读 `props.view` 会被 `vue-tsc` 判成可能为 undefined（缺省值在它眼里不作数），
 * 所以四个键统一从这里过一手，不在模板上撒 `?.`。
 */
const stageView = computed<Twin2dStageView>(() => props.view)

const host = ref<HTMLElement | null>(null)
const measured = ref<Twin2dStageBox>({ w: 0, h: 0 })
let observer: ResizeObserver | null = null

/**
 * 领 sprite 宿主：同一个 DOM 文档里只有头一个舞台领得到。
 * ⚠ 在 setup 里同步领，不等 `onMounted`：同帧建起来的两个舞台在 mounted 之前都还没
 * 落进文档，靠查 DOM 判「有没有挂过」两边都会判成没有，于是同一份 symbol 挂两遍。
 */
function claimSprite(): boolean {
  const root = document.documentElement
  if (root.hasAttribute(SPRITE_CLAIM_ATTR)) return false
  root.setAttribute(SPRITE_CLAIM_ATTR, '')
  return true
}

/**
 * ⚠ 漏挂 sprite 时图标**静默消失**：`<use>` 元素照样在 devtools 里，只是解析不到任何
 * 目标，控制台一声不吭（§5）。
 */
const ownsSprite = claimSprite()

function measure(el: HTMLElement): void {
  const rect = el.getBoundingClientRect()
  measured.value = { w: rect.width, h: rect.height }
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

onBeforeUnmount(() => {
  observer?.disconnect()
  observer = null
  // 把标记还回去，之后新挂起来的舞台接手
  // ⚠ 此刻已经挂着的另一个舞台不会补挂：它的 setup 只跑过一次。同页多张图且会
  // 逐张卸载时，宿主该由外层挂一次而不是交给舞台
  if (ownsSprite) document.documentElement.removeAttribute(SPRITE_CLAIM_ATTR)
})

/**
 * 两轴缩放倍率。
 * ⚠ 只有 `contain` 吃 `fitPadding`：其余三档的意思就是「把某一轴填满」，再乘一个安全
 * 留白就填不满了，而表现是「配了 width 却两边留白」（§9.1 那张表）。
 * @param mode 缩放档
 * @param canvas 画布坐标系
 * @param box 容器尺寸
 * @param padding 安全留白（百分比）
 */
function scalesOf(
  mode: Twin2dFitMode,
  canvas: Twin2dCanvas,
  box: Twin2dStageBox,
  padding: number,
): [number, number] {
  const kx = box.w / canvas.width
  const ky = box.h / canvas.height
  switch (mode) {
    case 'contain': {
      const scale = Math.min(kx, ky) * (1 - padding / PERCENT)
      return [scale, scale]
    }
    case 'width':
      return [kx, kx]
    case 'height':
      return [ky, ky]
    case 'stretch':
      return [kx, ky]
  }
}

/**
 * ⚠ 首帧或被隐藏时容器宽高是 0，这时整个贴合结果是 `null`：少了这条保护，
 * `translate(NaN, NaN)` 会让整块空白，而 devtools 里看什么都正常（§9.1）。
 */
const fit = computed<Twin2dStageFit | null>(() => {
  const box = props.containerSize ?? measured.value
  if (box.w <= 0 || box.h <= 0) return null
  const view = props.view
  const [sx, sy] = scalesOf(view.fitMode, props.canvas, box, view.fitPadding)
  // 只有 contain 居中，`width` 顶端对齐、`height` 左对齐、`stretch` 两轴都填满
  const centered = view.fitMode === 'contain'
  return {
    sx,
    sy,
    dx: centered ? (box.w - props.canvas.width * sx) / 2 : 0,
    dy: centered ? (box.h - props.canvas.height * sy) / 2 : 0,
  }
})

const viewportStyle = computed<Record<string, string>>(() => {
  const style: Record<string, string> = {
    width: `${props.canvas.width}px`,
    height: `${props.canvas.height}px`,
  }
  const placed = fit.value
  if (placed === null) {
    style['visibility'] = 'hidden'
    return style
  }
  const move = `translate(${placed.dx}px, ${placed.dy}px)`
  style['transform'] = `${move} scale(${placed.sx}, ${placed.sy})`
  return style
})

/** 未注入时一律回空地址：ico 与底图的 `asset` 一档随即整枝不画，不留一个空 `src`。 */
const iconResolver = computed<Twin2dIconResolver>(
  () => props.live.resolveIcon ?? NO_ICON_RESOLVER,
)

/**
 * 底图那一层的取值：未解析的素材引用 → 不画；图片地址 → `url()` 加铺法；其余 → 当
 * CSS `background` 简写用。
 * ⚠ 素材引用解析不出来（或没注入解析槽）时整层不画，**不能**顺着落到简写那一档：
 * `asset:7f3a` 本身是一个「安全」的 CSS 值，注进去只会得到一条谁也解释不了的声明。
 * ⚠ 引号、括号与空白一律拒，它们能把 `url()` 提前闭合。
 * @param canvas 画布的底图两项
 * @param resolve 素材解析槽
 */
function backgroundValue(
  canvas: Twin2dCanvas,
  resolve: Twin2dIconResolver,
): string | null {
  const raw = canvas.background
  if (raw === '') return null
  const asset = raw.startsWith(ASSET_PREFIX)
  const ref = asset ? resolve(raw) : raw
  if (asset || IMAGE_PREFIXES.some((prefix) => ref.startsWith(prefix))) {
    if (ref === NO_ASSET_URL || URL_UNSAFE_RE.test(ref)) return null
    return `url("${ref}") ${IMAGE_FIT[canvas.backgroundFit]}`
  }
  const value = sanitizeCssValue(raw, '')
  return value === '' ? null : value
}

/**
 * 底图层。
 * ⚠ 出的是自定义属性而不是 `background` 本身，由本文件的 scoped 规则接过去：值里带
 * `var()` 的标准属性会被 happy-dom 的 CSSOM 整条丢掉，浏览器上没事、用例里却断言不到
 * （连线层的边色同一个原因）。
 */
const backgroundStyle = computed<Record<string, string>>(() => {
  const value = backgroundValue(props.canvas, iconResolver.value)
  return value === null ? {} : { '--t2-bg': value }
})

/**
 * 一层等距斜线。
 * @param angle 线的法向角度
 * @param color 线色
 * @param gap 线间距
 * @param width 线宽
 */
function stripes(
  angle: number,
  color: string,
  gap: number,
  width: number,
): string {
  const line = `${color} ${gap}px ${gap + width}px`
  return `repeating-linear-gradient(${angle}deg, transparent 0 ${gap}px, ${line})`
}

/** 图案层：斜织是两层角度对称的等距斜线，点阵靠一层径向渐变按格铺（§7 #76）。 */
const patternStyle = computed<Record<string, string>>(() => {
  const canvas = props.canvas
  if (canvas.pattern === 'none') return {}
  const color = sanitizeCssValue(canvas.patternColor, PATTERN_FALLBACK)
  const { patternGap: gap, patternWidth: width } = canvas
  if (canvas.pattern === 'dots') {
    const dot = `${color} 0 ${width}px, transparent ${width}px`
    return {
      '--t2-pattern': `radial-gradient(circle at 50% 50%, ${dot})`,
      'background-size': `${gap}px ${gap}px`,
    }
  }
  const angles: readonly number[] =
    canvas.pattern === 'weave' ? WEAVE_ANGLES : [LINES_ANGLE]
  const layers = angles.map((angle) => stripes(angle, color, gap, width))
  return { '--t2-pattern': layers.join(', ') }
})

const marksBelow = computed(() =>
  props.marks.filter((mark) => mark.zOrder === 'below'),
)

const marksAbove = computed(() =>
  props.marks.filter((mark) => mark.zOrder === 'above'),
)

/** 连线运行态：缺席时按缺省（活跃、不反向、无标签）画。 */
const edgeStates = computed<Readonly<Record<string, Twin2dEdgeState>>>(
  () => props.live.edges ?? {},
)

/**
 * 逐节点的渲染输入。
 * ⚠ 样式悬空的节点整个不画：造一个空壳出来会在图上留一块吃指针的透明区，而落回
 * `__fallback` 预置样式那一步归调用方（它才知道预置库，§7 #45）。
 * ⚠ 运行态按节点 id 取而不按下标：`nodes` 与运行态两个 props 各自变化时下标会错位，
 * 表现是「状态点串到隔壁节点上」，零报错。
 */
const nodeViews = computed<Twin2dNodeView[]>(() => {
  const styles = new Map(props.nodeStyles.map((style) => [style.id, style]))
  const live = props.live
  const views: Twin2dNodeView[] = []
  for (const node of props.nodes) {
    const style = styles.get(node.styleId)
    if (style === undefined) continue
    views.push({
      node,
      style,
      status: live.status?.[node.id] ?? null,
      slots: live.slots?.[node.id] ?? EMPTY_SLOTS,
      readSlot: (key) => live.readSlot?.(node.id, key) ?? null,
    })
  }
  return views
})

/** 空态：一个节点、一条标注都没有才算空——只有标注的纯图框是合法用法。 */
const empty = computed(
  () => props.nodes.length === 0 && props.marks.length === 0,
)
</script>

<template>
  <div ref="host" class="t2-stage">
    <Twin2dIconSprite v-if="ownsSprite" />
    <div class="t2-stage__viewport" :style="viewportStyle">
      <div
        class="t2-stage__layer"
        data-layer="background"
        :style="backgroundStyle"
      />
      <div class="t2-stage__layer" data-layer="pattern" :style="patternStyle" />
      <div class="t2-stage__layer" data-layer="marks-below">
        <slot name="marks-below" :marks="marksBelow" />
      </div>
      <Twin2dEdgeLayer
        data-layer="edges"
        :edges="edges"
        :edge-styles="edgeStyles"
        :nodes="nodes"
        :node-styles="nodeStyles"
        :states="edgeStates"
        :animate-flow="stageView.animateFlow"
        :flow-speed="stageView.flowSpeed"
        :width="canvas.width"
        :height="canvas.height"
      />
      <div class="t2-stage__layer" data-layer="nodes">
        <Twin2dNodeBox
          v-for="item in nodeViews"
          :key="item.node.id"
          :node="item.node"
          :node-style="item.style"
          :status="item.status"
          :slot-values="item.slots"
          :read-slot="item.readSlot"
          :resolve-icon="iconResolver"
          :id-prefix="item.node.id"
        />
      </div>
      <div class="t2-stage__layer" data-layer="marks-above">
        <slot name="marks-above" :marks="marksAbove" />
      </div>
    </div>
    <p v-if="empty" class="t2-stage__empty">{{ EMPTY_TEXT }}</p>
  </div>
</template>

<style scoped>
/* 两层底的取值是数据，由内联的自定义属性喂进来；结构性样式在 twin2d.scss 里 */
.t2-stage__layer[data-layer='background'] {
  background: var(--t2-bg, none);
}

.t2-stage__layer[data-layer='pattern'] {
  background-image: var(--t2-pattern, none);
}
</style>
