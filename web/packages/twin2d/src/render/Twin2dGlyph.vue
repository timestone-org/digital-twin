<script setup lang="ts">
/**
 * @fileoverview ico 图元的渲染件：四来源各走一条分支（注册名 → DtIcon、内置图标 →
 * `<use>`、素材 → `<img>`、手绘 → 内联 `<svg>`），样式一律取自 `paintIco`。
 * 口径见 docs/MODULE_TWIN_2D_DESIGN.md §4.2、§5、§11.4。
 */
import { DtIcon } from '@dt/ui'
import { computed } from 'vue'

import { paintIco, resolveIcoSrc } from '../paintText'
import { svgPaintLayers, svgShapeAttrs, svgShapeTag } from '../paintVec'
import type { Twin2dPaintCtx } from '../paintCommon'
import type { Twin2dIconResolver } from '../paintText'
import type { Twin2dSvgTag } from '../paintVec'
import type {
  Twin2dDrawPart,
  Twin2dGradient,
  Twin2dIcoPrim,
  Twin2dSize,
} from '../typesPrim'

/**
 * 内置图标外壳的 viewBox。
 * ⚠ 恒是这一档，不随 symbol 自己的画幅走：`<use>` 按缺省的 `xMidYMid meet` 把各自的
 * viewBox 贴合进来，于是 `240×150` 的那四枚上下留白——这是参考项目的既有观感（§5）。
 */
const SPRITE_VIEW_BOX = '0 0 48 48'
/** 手绘一笔的坐标恒是 viewBox 像素，没有归一档 */
const DRAW_COORD = 'px'
/** px 档不按盒尺寸换算，给个占位 */
const DRAW_BOX = 1
/** 序号与绘制遍 key 的分隔 */
const KEY_SEP = '|'
/** 手绘一笔没有渐变表 */
const NO_GRADIENTS: readonly Twin2dGradient[] = []

/** 传给 DtIcon 的边长；缺席即用它自己的缺省。 */
type Twin2dIconSizeProps = { size?: number }

/** 手绘一档里的一遍绘制：元素名 + 几何与上色属性。 */
interface Twin2dDrawLayer {
  key: string
  tag: Twin2dSvgTag
  attrs: Record<string, string>
}

/**
 * 模板照着画的那一份判定结果。
 * ⚠ 四档的载荷在这里就备齐：模板只做分支与贴属性，不再去联合类型上取成员，
 * 也不再算第二遍——模板里取错成员时 typecheck 与 lint 双双放行。
 */
type Twin2dGlyphView =
  | { kind: 'none' }
  | { kind: 'name'; name: string; sizeProps: Twin2dIconSizeProps }
  | { kind: 'sprite'; href: string }
  | { kind: 'asset'; url: string }
  | { kind: 'draw'; viewBox: string; layers: readonly Twin2dDrawLayer[] }

/** 整枝不渲染的那一档。 */
const NO_GLYPH: Twin2dGlyphView = { kind: 'none' }

const props = defineProps<{
  /** 已归一化并合过变体补丁的 ico 图元。 */
  prim: Twin2dIcoPrim
  /** 节点实例、父级盒尺寸与本次挂载的实例前缀。 */
  ctx: Twin2dPaintCtx
  /** 素材地址解析槽；不给即「未注入」，`asset` 一档整枝不渲染。 */
  resolveIcon?: Twin2dIconResolver
}>()

/**
 * 传给 DtIcon 的边长。
 * ⚠ 只在宽度是设计像素时给，别的档一个键都不给：DtIcon 把它写成 `width`/`height`
 * 属性，百分比与 `auto` 落进去是非法值；而把缺省值 18 在这里再写一遍就是第二份真源。
 * @param size 图元盒的宽高
 */
function iconSizeProps(size: Twin2dSize): Twin2dIconSizeProps {
  return typeof size.w === 'number' ? { size: size.w } : {}
}

/**
 * 手绘的几笔摊平成一串绘制遍：每一笔的填充一层在下、多遍描边叠在上面。
 * ⚠ key 里的序号就是这一笔的身份：`Twin2dDrawPart` 没有 id（受限的一笔，不被变体
 * 补丁寻址），文档序即绘制序，换了序就是另一幅画。
 * ⚠ 渐变表恒空：手绘一档表达不了渐变（§5），引渐变的填充就地落回不上色，
 * 而不是去够别的图元里同名的那个。
 * @param parts 手绘的几笔，文档序即绘制序
 * @param idPrefix 本次挂载的实例前缀
 */
function drawLayersOf(
  parts: readonly Twin2dDrawPart[],
  idPrefix: string,
): Twin2dDrawLayer[] {
  return parts.flatMap((part, order) => {
    const tag = svgShapeTag(part.shape)
    const geometry = svgShapeAttrs(part.shape, DRAW_COORD, DRAW_BOX, DRAW_BOX)
    const painted = svgPaintLayers(
      part.fill,
      part.strokes,
      NO_GRADIENTS,
      idPrefix,
    )
    return painted.map((layer) => ({
      key: `${order}${KEY_SEP}${layer.key}`,
      tag,
      attrs: { ...geometry, ...layer.attrs },
    }))
  })
}

/**
 * 这一枝到底画什么。
 * ⚠ `hidden` 在这里就整枝摘掉：那一档 `paintBase` 连样式都不产，留下的元素会是个
 * 没尺寸、没定位的空壳，压在别的图元上还吃指针事件。
 * ⚠ `asset` 一档解析不出地址时同样落回空档：渲染一个 `src=""` 的 `<img>` 会让浏览器
 * 把当前页地址再请求一遍，而「图标为什么没了」该由诊断面板说（§11.4）。
 */
const view = computed<Twin2dGlyphView>(() => {
  if (props.prim.hidden) return NO_GLYPH
  const src = resolveIcoSrc(props.prim.src, props.resolveIcon)
  if (src.kind === 'name') {
    return {
      kind: 'name',
      name: src.name,
      sizeProps: iconSizeProps(props.prim.size),
    }
  }
  if (src.kind === 'sprite') return { kind: 'sprite', href: `#${src.id}` }
  if (src.kind === 'asset') return { kind: 'asset', url: src.url }
  if (src.kind === 'draw') {
    return {
      kind: 'draw',
      viewBox: `0 0 ${src.viewBox[0]} ${src.viewBox[1]}`,
      layers: drawLayersOf(src.parts, props.ctx.idPrefix),
    }
  }
  return NO_GLYPH
})

const paint = computed(() => paintIco(props.prim, props.ctx))
</script>

<template>
  <DtIcon
    v-if="view.kind === 'name'"
    class="t2-glyph"
    :class="paint.classes"
    :style="paint.style"
    :name="view.name"
    v-bind="view.sizeProps"
  />
  <svg
    v-else-if="view.kind === 'sprite'"
    class="t2-glyph"
    :class="paint.classes"
    :style="paint.style"
    :viewBox="SPRITE_VIEW_BOX"
    aria-hidden="true"
    focusable="false"
  >
    <use :href="view.href" />
  </svg>
  <img
    v-else-if="view.kind === 'asset'"
    class="t2-glyph"
    :class="paint.classes"
    :style="paint.style"
    :src="view.url"
    alt=""
  />
  <svg
    v-else-if="view.kind === 'draw'"
    class="t2-glyph"
    :class="paint.classes"
    :style="paint.style"
    :viewBox="view.viewBox"
    aria-hidden="true"
    focusable="false"
  >
    <component
      :is="layer.tag"
      v-for="layer in view.layers"
      :key="layer.key"
      v-bind="layer.attrs"
    />
  </svg>
</template>

<style scoped>
/* ⚠ `<svg>` 与 `<img>` 的 UA 缺省是行内元素，基线会在盒底留一条缝，看着像「图标没对齐」 */
.t2-glyph {
  display: block;
}
/* 素材图标的长宽比不归配置管，撑满盒子会把它拉变形 */
img.t2-glyph {
  object-fit: contain;
}
</style>
