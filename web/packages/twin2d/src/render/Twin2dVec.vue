<script setup lang="ts">
/**
 * @fileoverview vec 图元的渲染件：把 `paintVec` 算好的根 `<svg>` 样式与属性贴上去，
 * 局部渐变进 `<defs>`（id 一律带实例前缀），填充一层加多遍描边各出一个同形几何元素。
 * 口径见 docs/MODULE_TWIN_2D_DESIGN.md §4.2、§13.1。
 */
import { computed } from 'vue'

import {
  paintVec,
  svgGradientAttrs,
  svgPaintLayers,
  svgShapeAttrs,
  svgShapeTag,
  svgStopAttrs,
} from '../paintVec'
import type { Twin2dPaintCtx } from '../paintCommon'
import type { Twin2dSvgLayer } from '../paintVec'
import type { Twin2dGradientStop, Twin2dVecPrim } from '../typesPrim'

/** 渐变两档各自的 SVG 元素名。 */
const GRADIENT_TAGS = {
  linear: 'linearGradient',
  radial: 'radialGradient',
} as const

/** 一个局部渐变的 `<defs>` 条目：元素名、属性与它的色标。 */
interface Twin2dGradientDef {
  id: string
  tag: string
  attrs: Record<string, string>
  stops: readonly { id: string; attrs: Record<string, string> }[]
}

const props = defineProps<{
  /** 已归一化并合过变体补丁的 vec 图元。 */
  prim: Twin2dVecPrim
  /** 节点实例、父级盒尺寸与本次挂载的实例前缀。 */
  ctx: Twin2dPaintCtx
}>()

const paint = computed(() => paintVec(props.prim, props.ctx))

const shapeTag = computed(() => svgShapeTag(props.prim.shape))

/**
 * 局部渐变的 `<defs>` 条目。
 * ⚠ id 必须经 `svgGradientAttrs` 拿实例前缀：同页两个节点用同名渐变时浏览器只认
 * 头一个，表现是「另一张图的颜色跑到这张图上」，两边都不报错（§5）。
 */
const gradientDefs = computed<Twin2dGradientDef[]>(() =>
  props.prim.gradients.map((gradient) => ({
    id: gradient.id,
    tag: GRADIENT_TAGS[gradient.kind],
    attrs: svgGradientAttrs(gradient, props.ctx.idPrefix),
    stops: gradient.stops.map((stop: Twin2dGradientStop) => ({
      id: stop.id,
      attrs: svgStopAttrs(stop),
    })),
  })),
)

/**
 * 每一遍绘制的完整属性：几何在下、上色在上，同一段几何画几遍就出几个元素。
 * ⚠ 几何与上色必须合成一份再 `v-bind`：拆成两个 `v-bind` 时后一个整体顶掉前一个，
 * 表现是形状还在、位置回到原点。
 */
const layers = computed<Twin2dSvgLayer[]>(() => {
  const geometry = svgShapeAttrs(
    props.prim.shape,
    props.prim.coord,
    props.ctx.boxW,
    props.ctx.boxH,
  )
  const painted = svgPaintLayers(
    props.prim.fill,
    props.prim.strokes,
    props.prim.gradients,
    props.ctx.idPrefix,
  )
  return painted.map((layer) => ({
    key: layer.key,
    attrs: { ...geometry, ...layer.attrs },
  }))
})
</script>

<template>
  <svg
    v-if="!prim.hidden"
    class="t2-vec"
    :class="paint.classes"
    :style="paint.style"
    v-bind="paint.attrs"
    aria-hidden="true"
    focusable="false"
  >
    <defs v-if="gradientDefs.length > 0">
      <component
        :is="def.tag"
        v-for="def in gradientDefs"
        :key="def.id"
        v-bind="def.attrs"
      >
        <stop v-for="stop in def.stops" :key="stop.id" v-bind="stop.attrs" />
      </component>
    </defs>
    <component
      :is="shapeTag"
      v-for="layer in layers"
      :key="layer.key"
      v-bind="layer.attrs"
    />
  </svg>
</template>

<style scoped>
/* ⚠ `<svg>` 的 UA 缺省是行内元素，基线会在盒底留一条缝，看着像「图元没对齐」 */
.t2-vec {
  display: block;
}
</style>
