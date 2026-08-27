<script setup lang="ts">
/**
 * @fileoverview 图元树的递归渲染件：按 kind 四分支——box 出一个 `<div>` 并递归子树，
 * vec 与 ico 交给两个叶子件，txt 出一段文字并按自己那一格的取数档位出色。样式一律取自
 * paint 一族，`hidden` 与 `when` 不成立的那一枝整枝不渲染。
 * 口径见 docs/MODULE_TWIN_2D_DESIGN.md §4.2、§9.2、§9.6、§13.1。
 */
import { computed } from 'vue'

import { twin2dIconUrl } from '../assets'
import { paintBox } from '../paintBox'
import { paintText, resolveTxtContent, txtTitleAttrs } from '../paintText'
import { posDim } from '../sanitize'
import { evalCondition } from '../variants'
import Twin2dGlyph from './Twin2dGlyph.vue'
import Twin2dVec from './Twin2dVec.vue'
import type { Twin2dPaintCtx, Twin2dPaintOut } from '../paintCommon'
import type {
  Twin2dIconResolver,
  Twin2dSlotRead,
  Twin2dTextCtx,
} from '../paintText'
import type {
  Twin2dBoxPrim,
  Twin2dIcoPrim,
  Twin2dInset,
  Twin2dLen,
  Twin2dPrim,
  Twin2dTxtPrim,
  Twin2dTxtSrc,
  Twin2dVecPrim,
} from '../typesPrim'
import type { Twin2dVariantCtx } from '../variants'

/**
 * ⚠ 递归组件靠这个名字自引用：文件名推导也能自引用，但显式给了名字之后，
 * 换文件名或换构建链路都不会让整棵子树静默变成一个未注册组件。
 */
defineOptions({ name: 'Twin2dPrimView' })

/** 盒尺寸的除零护栏 */
const MIN_BOX = 1
/** 归一百分比的分母 */
const PERCENT = 100

/** 按槽键取口径与读数，与 `Twin2dTextCtx` 上的那一项同型。 */
type Twin2dSlotReader = Twin2dTextCtx['readSlot']

/** box 一档模板要的那一份：自己的画法、子树，以及子树该用的上下文。 */
interface Twin2dBoxView {
  paint: Twin2dPaintOut
  children: readonly Twin2dPrim[]
  childCtx: Twin2dPaintCtx
}

/** txt 一档模板要的那一份：画法、`title` 属性与已格式化好的显示串。 */
interface Twin2dTxtView {
  paint: Twin2dPaintOut
  attrs: Record<string, string>
  content: string
}

const props = defineProps<{
  /** 已归一化并合过变体补丁的图元。 */
  prim: Twin2dPrim
  /** 节点实例、本图元的盒尺寸与本次挂载的实例前缀。 */
  ctx: Twin2dPaintCtx
  /** `when` 的求值上下文，与 `applyVariants` 用的是同一份。 */
  variant: Twin2dVariantCtx
  /** 按槽键取口径、读数与取数档位；不注入时 `slot` 档文本一律「—」、不出档位色。 */
  readSlot?: Twin2dSlotReader
  /** 素材地址解析槽；不注入时 ico 的 `asset` 一档整枝不渲染。 */
  resolveIcon?: Twin2dIconResolver
}>()

/**
 * 一个长度落到设计像素：裸数直用，百分比按父级那一轴换算。
 * ⚠ `em` 与 `auto` 回落父级盒尺寸而不是 0：这两档的真值要等布局完才知道，
 * 而 0 会让子孙里 `unit` 档的 vec 按 1×1 的 viewBox 画，整层挤成一个点。
 * @param len 长度值
 * @param parent 父级那一轴的设计像素
 */
function lenToPx(len: Twin2dLen, parent: number): number {
  if (typeof len === 'number') return len
  if (!len.endsWith('%')) return parent
  return (parent * Number.parseFloat(len)) / PERCENT
}

/**
 * `fill` 一档的盒：几何由四向内缩定死，用不上 `size`。
 * ⚠ 上下那一对的百分比归高、左右那一对归宽（与 CSS 的 `inset` 同解）：
 * 两轴混用会让非方形盒里的子树整体偏出去一截，而每个数看着都对。
 * @param inset 四向内缩，顺序 t / r / b / l
 * @param ctx 本图元的上下文
 */
function fillBox(inset: Twin2dInset, ctx: Twin2dPaintCtx): [number, number] {
  const [top, right, bottom, left] = inset
  return [
    ctx.boxW - lenToPx(left, ctx.boxW) - lenToPx(right, ctx.boxW),
    ctx.boxH - lenToPx(top, ctx.boxH) - lenToPx(bottom, ctx.boxH),
  ]
}

/**
 * 子树的上下文：盒尺寸换成这个 box 自己的，节点实例与实例前缀原样传下去。
 * ⚠ 必须换：子孙拿盒尺寸算两样东西——`perim` 摆位的周长落点、`unit` 档 vec 的坐标
 * 换算，两样都以「我贴在谁身上」为准。不换的表现是子盒里的药丸贴到整个节点的边上去。
 * ⚠ 内边距、边框与被内容撑开的尺寸都不扣：那要等布局完才知道，这里只换算文档尺寸。
 * @param prim box 图元
 * @param ctx 本图元的上下文
 */
function childCtxOf(prim: Twin2dBoxPrim, ctx: Twin2dPaintCtx): Twin2dPaintCtx {
  const [w, h] =
    prim.at.kind === 'fill'
      ? fillBox(prim.at.inset, ctx)
      : [lenToPx(prim.size.w, ctx.boxW), lenToPx(prim.size.h, ctx.boxH)]
  return { ...ctx, boxW: posDim(w, MIN_BOX), boxH: posDim(h, MIN_BOX) }
}

/**
 * box 画出来是什么，连同子树与子树的上下文。
 * @param prim box 图元
 * @param ctx 本图元的上下文
 */
function boxViewOf(prim: Twin2dBoxPrim, ctx: Twin2dPaintCtx): Twin2dBoxView {
  return {
    paint: paintBox(prim, ctx),
    children: prim.children,
    childCtx: childCtxOf(prim, ctx),
  }
}

/**
 * `slot` 一档的那一格读数；其余四档的字是配置里写死的，没有取数这回事，给 null。
 * @param src 文本五档来源
 * @param read 按槽键取口径、读数与取数档位
 */
function slotReadOf(
  src: Twin2dTxtSrc,
  read: Twin2dSlotReader,
): Twin2dSlotRead | null {
  return src.kind === 'slot' ? read(src.slot) : null
}

/**
 * txt 画出来是什么：显示串、样式与 `title`。
 * ⚠ 显示串一律经 `resolveTxtContent`：精度、单位、映射表与占位符是槽位的口径，
 * 在模板里再拼一遍就是第二个真源，而两份漂了只表现为「这一格的数看着不一样」（§11.3）。
 * ⚠ 同一格取两次读数是有意的：两次都是同一个纯查表，换成把结果塞回去省一次的写法，
 * 就得假定 `resolveTxtContent` 只会查 `src.slot` 那一个键——那是个改一行就静默出错的前提。
 * ⚠ 档位的 `title` 排在后面：它与「文字被省略了」抢同一个属性，坏掉的原因要压过省略提示。
 * @param prim 文本图元
 * @param ctx 本图元的上下文
 * @param read 按槽键取口径、读数与取数档位
 */
function txtViewOf(
  prim: Twin2dTxtPrim,
  ctx: Twin2dPaintCtx,
  read: Twin2dSlotReader,
): Twin2dTxtView {
  const content = resolveTxtContent(prim.src, {
    node: ctx.node,
    readSlot: read,
  })
  const paint = paintText(prim, ctx, slotReadOf(prim.src, read))
  return {
    paint,
    attrs: { ...txtTitleAttrs(prim, content), ...paint.attrs },
    content,
  }
}

/** 未注入时取不到任何读数：`slot` 档随即显示「—」，说清这件事归诊断（§11.4）。 */
const slotReader = computed<Twin2dSlotReader>(
  () => props.readSlot ?? (() => null),
)

/** 没显式递解析槽就走应用壳注入的那一条；两处都没有时 ico 的 `asset` 一档整枝不渲染。 */
const iconResolver = computed<Twin2dIconResolver>(
  () => props.resolveIcon ?? twin2dIconUrl,
)

/**
 * 这一枝画不画。
 * ⚠ 不满足时**整枝不渲染**，不是渲染一个 `display: none` 的空壳：空壳的子树照样递归
 * 下去，一棵深树照样把浏览器摁死，而那个壳还压在别的图元上吃指针事件。
 */
const visible = computed(
  () =>
    !props.prim.hidden &&
    (props.prim.when === null || evalCondition(props.prim.when, props.variant)),
)

const box = computed<Twin2dBoxView | null>(() => {
  const prim = props.prim
  return visible.value && prim.kind === 'box'
    ? boxViewOf(prim, props.ctx)
    : null
})

const vec = computed<Twin2dVecPrim | null>(() => {
  const prim = props.prim
  return visible.value && prim.kind === 'vec' ? prim : null
})

const ico = computed<Twin2dIcoPrim | null>(() => {
  const prim = props.prim
  return visible.value && prim.kind === 'ico' ? prim : null
})

const txt = computed<Twin2dTxtView | null>(() => {
  const prim = props.prim
  return visible.value && prim.kind === 'txt'
    ? txtViewOf(prim, props.ctx, slotReader.value)
    : null
})
</script>

<template>
  <div
    v-if="box !== null"
    class="t2-prim"
    :class="box.paint.classes"
    :style="box.paint.style"
  >
    <Twin2dPrimView
      v-for="child in box.children"
      :key="child.id"
      :prim="child"
      :ctx="box.childCtx"
      :variant="variant"
      :read-slot="slotReader"
      :resolve-icon="iconResolver"
    />
  </div>
  <Twin2dVec v-else-if="vec !== null" class="t2-prim" :prim="vec" :ctx="ctx" />
  <Twin2dGlyph
    v-else-if="ico !== null"
    class="t2-prim"
    :prim="ico"
    :ctx="ctx"
    :resolve-icon="iconResolver"
  />
  <div
    v-else-if="txt !== null"
    class="t2-prim"
    :class="txt.paint.classes"
    :style="txt.paint.style"
    v-bind="txt.attrs"
  >
    {{ txt.content }}
  </div>
</template>
