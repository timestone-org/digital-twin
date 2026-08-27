<script setup lang="ts">
/**
 * @fileoverview 一个节点：根容器的位姿与六个 `--t2-*` 注入、hover 自检、变体求值，以及
 * 把合过补丁的图元树交给 `Twin2dPrimView`。样式一律取自 paint 一族与 transform，本文件只
 * 做组合。口径见 docs/MODULE_TWIN_2D_DESIGN.md §9.2、§9.3、§10.1。
 */
import { computed, ref, useId } from 'vue'

import { twin2dIconUrl } from '../assets'
import { sanitizeCssValue } from '../cssValue'
import { injectVars } from '../paintCommon'
import { centerBoxOf, nodeTransformCss } from '../transform'
import { applyVariants, nodeFields } from '../variants'
import Twin2dPrimView from './Twin2dPrimView.vue'
import type { Twin2dSlotValues } from '../expr'
import type { Twin2dDefaultStatus, Twin2dState, Twin2dStatus } from '../kinds'
import type { Twin2dPaintCtx } from '../paintCommon'
import type { Twin2dIconResolver, Twin2dSlotRead } from '../paintText'
import type { Twin2dNode, Twin2dNodeStyle, Twin2dVariant } from '../types'
import type {
  Twin2dCondition,
  Twin2dPrim as Twin2dPrimNode,
  Twin2dRootPatch,
  Twin2dShadow,
} from '../typesPrim'
import type { Twin2dVariantCtx } from '../variants'

/** 节点级 `patch` 借变体那条路做浅合并时用的身份 */
const NODE_PATCH_ID = '__node'
/** 变体求值里「这个节点不画状态」的那一档 */
const STATUS_HIDDEN = 'hidden'
/** 节点自己没给状态的哨兵 */
const NO_STATUS = ''
/** 阴影颜色被拒时的取色口径 */
const INHERITED_COLOR = 'currentColor'

/**
 * 恒成立的变体条件。
 * ⚠ 节点级 `patch` 走的就是变体那条浅合并（§9.2 的管线里它排在变体之前），所以要一个
 * 永真条件把它送进去。空 `slots` 的 `has` 判的是 `[].every()`，恒真——`variants.ts`
 * 那边一改这里就静默失效，故本组件有一条用例直接钉「节点 patch 无条件生效」。
 */
const ALWAYS: Twin2dCondition = Object.freeze({
  kind: 'has',
  slots: [],
  mode: 'all',
})

/** 按槽键取口径与读数，与图元上的那一项同型。 */
type Twin2dSlotReader = (key: string) => Twin2dSlotRead | null

const props = withDefaults(
  defineProps<{
    /** 节点实例。 */
    node: Twin2dNode
    /** 该节点用的样式（文档 ∪ 预置库，调用方合并好）。 */
    nodeStyle: Twin2dNodeStyle
    /** 数据线上的状态覆盖；`null` = 不覆盖配置里的静态状态（§10.1）。 */
    status?: Twin2dStatus | null
    /** 外部交互态；`hover` 不从这里进，由本文件自检（§9.3）。 */
    states?: readonly Twin2dState[]
    /** 槽键 → 读数，变体的 `slot` / `has` 两档与派生槽都读它。 */
    slotValues?: Twin2dSlotValues
    /** 按槽键取口径、读数与取数档位；不注入时 `slot` 档文本一律占位符、不出档位色。 */
    readSlot?: Twin2dSlotReader
    /** `asset:<uuid>` → 可直接用的地址；不注入时 ico 的 `asset` 一档整枝不渲染。 */
    resolveIcon?: Twin2dIconResolver
    /** SVG 局部 id 的实例前缀，缺省取本实例的 `useId()`。 */
    idPrefix?: string
  }>(),
  {
    status: null,
    states: () => [],
    slotValues: () => new Map<string, unknown>(),
  },
)

/**
 * ⚠ hover 定死在这一对模板事件上：变体补丁是内联样式，CSS 伪类写不进去；手装
 * `addEventListener` 要自己在卸载时摘；全局 pointermove 命中测试在旋转过的盒上又慢
 * 又不准（§9.3 那张表）。模板事件绑定由 Vue 自己摘，零清理代码。
 */
const hovered = ref(false)

/**
 * 局部渐变 id 的缺省前缀。
 * ⚠ 不能拿空串当缺省：同一份样式在一张图上出现两次时渐变 id 会重号，浏览器只认头一个，
 * 表现是「另一个节点的颜色跑到这个节点上」。
 * ⚠ `useId()` 按应用实例计数，够一个应用内唯一；跨应用实例会重号，所以舞台一律显式喂
 * 节点 id（它在一份文档里唯一）。
 */
const instanceId = useId()

/**
 * 一条阴影：`inset` 与外阴影只差一个前缀。
 * ⚠ 与 `paintBox` 里图元那一份是同一个写法的两处落点（那边服务图元、这边服务节点根），
 * 改了要两处一起改。
 * @param shadow 已归一化的阴影
 */
function shadowCss(shadow: Twin2dShadow): string {
  const color = sanitizeCssValue(shadow.color, INHERITED_COLOR)
  const geom = `${shadow.x}px ${shadow.y}px ${shadow.blur}px ${shadow.spread}px`
  return shadow.inset ? `inset ${geom} ${color}` : `${geom} ${color}`
}

/**
 * 根元素的 `transform`：抬升在最左、等比缩放在最右，中间那一段由 `transform.ts` 出。
 * ⚠ 抬升必须排在最左：CSS 的变换列表从右往左作用到点上，排右边它就跟着节点的 `rotate`
 * 一起转，转过 90° 的节点 hover 时朝侧面抬。
 * ⚠ 等比缩放必须排在最右：排左边会把定位那一段的位移量一起放大，节点离原点越远 hover
 * 时飘得越远。两种错法在「没转、又贴着原点」的那个节点上都看不出来。
 * @param node 节点实例
 * @param root 变体合出来的节点根覆盖
 */
function rootTransform(node: Twin2dNode, root: Twin2dRootPatch): string {
  const parts: string[] = []
  if (root.lift !== undefined) parts.push(`translateY(${-root.lift}px)`)
  parts.push(nodeTransformCss(node))
  if (root.scale !== undefined) parts.push(`scale(${root.scale})`)
  return parts.join(' ')
}

/** 未注入时取不到任何读数：`slot` 档随即显示占位符，说清这件事归诊断（§11.4）。 */
const slotReader = computed<Twin2dSlotReader>(
  () => props.readSlot ?? (() => null),
)

/** 没显式递解析槽就走应用壳注入的那一条；两处都没有时 ico 的 `asset` 一档整枝不渲染。 */
const iconResolver = computed<Twin2dIconResolver>(
  () => props.resolveIcon ?? twin2dIconUrl,
)

/**
 * 生效状态：数据线覆盖 → 节点上的静态状态 → 样式缺省（§10.1）。
 * ⚠ 覆盖为 `null` 是「这条数据线没说」而不是「离线」：把没有数据的设备显示成一个确定
 * 状态，是这套系统里代价最大的一种谎。
 */
const status = computed<Twin2dDefaultStatus>(() => {
  if (props.status !== null) return props.status
  if (props.node.status !== NO_STATUS) return props.node.status
  return props.nodeStyle.defaultStatus
})

const variant = computed<Twin2dVariantCtx>(() => {
  const states = new Set<Twin2dState>(props.states)
  if (hovered.value) states.add('hover')
  return {
    states,
    // ⚠ `hidden` 在变体求值里按「没有状态」算：它是「不画状态点」的样式缺省，
    // 不是一个能从数据线上来的状态，当成一档去匹配会多出一个永远配不中的条件
    status: status.value === STATUS_HIDDEN ? null : status.value,
    // ⚠ 用 Map 不用普通对象：`constructor` 这类键在对象上会取到原型链上的东西
    tags: new Map(Object.entries(props.node.tags)),
    slots: props.slotValues,
    // ⚠ 与 tags 分成两张表：合成一张会让用户自己写的同名 tag 悄悄改掉显示名位置
    fields: nodeFields(props.node),
  }
})

/**
 * 图元树与节点根覆盖。
 * ⚠ 顺序两条：追加图元排在样式图元之后（文档序即绘制序）；节点级 `patch` 排在样式变体
 * 之前（变体要盖得住它，§9.2）。反过来的表现是「hover 的样式被节点自己的覆盖顶掉」。
 */
const applied = computed(() => {
  const nodePatch: Twin2dVariant = {
    id: NODE_PATCH_ID,
    when: ALWAYS,
    patch: props.node.patch,
    rootPatch: {},
  }
  return applyVariants(
    [...props.nodeStyle.prims, ...props.node.layers],
    [nodePatch, ...props.nodeStyle.variants],
    variant.value,
  )
})

const prims = computed<readonly Twin2dPrimNode[]>(() => applied.value.prims)

/** 节点盒：宽高为 0 的节点跟样式的 `size` 走（`centerBoxOf` 是唯一换算入口）。 */
const box = computed(() => centerBoxOf(props.node, props.nodeStyle.size))

const ctx = computed<Twin2dPaintCtx>(() => ({
  node: props.node,
  boxW: box.value.w,
  boxH: box.value.h,
  idPrefix: props.idPrefix ?? instanceId,
}))

/**
 * 根元素的内联样式：六个 `--t2-*` + 盒尺寸 + 位姿，加变体的节点根覆盖。
 * ⚠ `left` / `top` 必须显式给 0：`nodeTransformCss` 的位移量以此为前提，靠 `auto` 的
 * 静态位置兜着只是恰好对，父级一加内边距全图就整体偏。
 * ⚠ 不产 `transform-origin`：那一串位姿以缺省的中心为基点，写别的值端口坐标就与渲染
 * 出来的符号对不上（§8）。
 */
const rootStyle = computed<Record<string, string>>(() => {
  const root = applied.value.root
  const style: Record<string, string> = {
    ...injectVars(props.node, props.nodeStyle, root.accent ?? '', status.value),
    left: '0',
    top: '0',
    width: `${box.value.w}px`,
    height: `${box.value.h}px`,
    transform: rootTransform(props.node, root),
  }
  // ⚠ hover 变体必须连 z 一起抬，否则悬浮卡被右邻节点整块盖住——而它只在两个节点
  // 靠得近时才看得出来（§9.3）
  if (root.z !== undefined) style['z-index'] = String(root.z)
  if (root.shadows !== undefined) {
    style['box-shadow'] = root.shadows.map(shadowCss).join(', ')
  }
  const border = sanitizeCssValue(root.borderColor, '')
  if (border !== '') style['border-color'] = border
  return style
})

/**
 * ⚠ 状态只落成一个类与一个 data 属性，观感一律由变体（数据）驱动：`twin2d.scss` 里
 * 一条 `t2-node--*` 规则都没有，加了就是给每一档状态开第二份真源。
 */
const rootClasses = computed(() => ['t2-node', `t2-node--${status.value}`])
</script>

<template>
  <div
    :class="rootClasses"
    :style="rootStyle"
    data-test="node"
    :data-id="node.id"
    :data-status="status"
    @mouseenter="hovered = true"
    @mouseleave="hovered = false"
  >
    <Twin2dPrimView
      v-for="prim in prims"
      :key="prim.id"
      :prim="prim"
      :ctx="ctx"
      :variant="variant"
      :read-slot="slotReader"
      :resolve-icon="iconResolver"
    />
  </div>
</template>
