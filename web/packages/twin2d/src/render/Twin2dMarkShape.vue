<script setup lang="ts">
/**
 * @fileoverview 一条标注的渲染件：rect / line / text 三档几何加它的标签。运行态的
 * `Twin2dMarkLayer` 与编辑器的标注层挂的是同一份，所以这里只认 `Twin2dMark`，一处都不碰
 * 选中态与手势。口径见 docs/MODULE_TWIN_2D_DESIGN.md §7.10（#71–#73）。
 *
 * ⚠ 标签落点逐值照参考项目：框内九宫格贴边 10、框外上下各 8、辅助线上方 10 下方 14。
 * 上下不对称是有意的——下方那一档要多让出一个字的升部，改成对称会贴到线上。
 * ⚠ 描边与虚线挂在外层 `<g>` 上由子元素继承，唯独标签的描边归 `.t2m-label`
 * （`paint-order: stroke` 的描边字）：少了这一条，虚线标注的字会连字带描边一起虚掉。
 */
import { computed } from 'vue'

import { sanitizeCssValue } from '../cssValue'
import type { Twin2dMarkAlignH, Twin2dMarkAlignV } from '../kinds'
import type { Twin2dMark } from '../types'
import type { FontValue } from '@dt/contracts'

/** 标签在框内时的贴边留白（设计像素）。 */
const LABEL_PAD = 10
/** 标签摆在框外时与框的距离。 */
const BOX_LABEL_GAP = 8
/** 标签摆在辅助线上方时与线的距离。 */
const LINE_LABEL_ABOVE = 10
/** 标签摆在辅助线下方时与线的距离。 */
const LINE_LABEL_BELOW = 14
/** 虚线的实长与虚长。 */
const DASH_PATTERN = '10 7'
/** 描边留空时落回的强调色。 */
const STROKE_FALLBACK = 'var(--accent-primary)'
/** 填充留空时不画填充。 */
const FILL_NONE = 'none'
/** 描边不随舞台缩放那一档的取值。 */
const FIXED_STROKE = 'non-scaling-stroke'

/** 横向对齐 → SVG 文字锚点。 */
const H_ANCHOR: Readonly<Record<Twin2dMarkAlignH, string>> = {
  left: 'start',
  center: 'middle',
  right: 'end',
}

/** 纵向对齐 → SVG 基线。⚠ 三档取值是 SVG 关键字，不是 CSS 的那套。 */
const V_BASELINE: Readonly<Record<Twin2dMarkAlignV, string>> = {
  top: 'hanging',
  middle: 'middle',
  bottom: 'auto',
}

/** 标签的落点与两条对齐。 */
interface MarkLabel {
  x: number
  y: number
  anchor: string
  baseline: string
}

const props = defineProps<{
  /** 已归一化的一条标注。 */
  mark: Twin2dMark
}>()

/**
 * 框内九宫格：贴边留白 10，居中那一档落在框心。
 * @param mark 标注
 */
function insideLabel(mark: Twin2dMark): MarkLabel {
  const { labelAlignH: alignH, labelAlignV: alignV } = mark
  const left = alignH === 'left' ? mark.x + LABEL_PAD : mark.x + mark.w / 2
  const top = alignV === 'top' ? mark.y + LABEL_PAD : mark.y + mark.h / 2
  return {
    x: alignH === 'right' ? mark.x + mark.w - LABEL_PAD : left,
    y: alignV === 'bottom' ? mark.y + mark.h - LABEL_PAD : top,
    anchor: H_ANCHOR[alignH],
    baseline: V_BASELINE[alignV],
  }
}

/**
 * 有框那两档（rect 与 text）的标签：`inside` 走九宫格，另两档摆在框外 8 处。
 * ⚠ 文字标注没有可见的框，但排版走同一套——`labelPos` 在它身上照样生效，
 * 不然「配了没反应」就多出一处。
 * @param mark 标注
 */
function boxLabel(mark: Twin2dMark): MarkLabel {
  if (mark.labelPos === 'inside') return insideLabel(mark)
  const x = mark.x + mark.w / 2
  if (mark.labelPos === 'bottom') {
    return {
      x,
      y: mark.y + mark.h + BOX_LABEL_GAP,
      anchor: 'middle',
      baseline: 'hanging',
    }
  }
  return { x, y: mark.y - BOX_LABEL_GAP, anchor: 'middle', baseline: 'auto' }
}

/**
 * 辅助线的标签：锚在两端中点，三档偏移 −10 / 0 / +14。
 * @param mark 标注
 */
function lineLabel(mark: Twin2dMark): MarkLabel {
  const x = (mark.x + mark.x2) / 2
  const mid = (mark.y + mark.y2) / 2
  if (mark.labelPos === 'inside') {
    return { x, y: mid, anchor: 'middle', baseline: 'middle' }
  }
  if (mark.labelPos === 'bottom') {
    return {
      x,
      y: mid + LINE_LABEL_BELOW,
      anchor: 'middle',
      baseline: 'hanging',
    }
  }
  return { x, y: mid - LINE_LABEL_ABOVE, anchor: 'middle', baseline: 'auto' }
}

/**
 * 字体四键：缺席的键一个声明都不产，那一项就跟随 `.t2m-label` 的排版。
 * ⚠ 颜色不在这里出——SVG 里文字上色走 `fill`，`color` 只在 `fill: currentColor`
 * 时才间接生效。
 * @param font 标注自己的字体
 */
function fontCss(font: FontValue): Record<string, string> {
  const style: Record<string, string> = {}
  const family = sanitizeCssValue(font.family, '')
  if (family !== '') style['font-family'] = family
  if (font.size !== undefined) style['font-size'] = `${font.size}px`
  if (font.weight !== undefined) style['font-weight'] = String(font.weight)
  if (font.letterSpacing !== undefined) {
    style['letter-spacing'] = `${font.letterSpacing}px`
  }
  return style
}

const stroke = computed(() =>
  sanitizeCssValue(props.mark.stroke, STROKE_FALLBACK),
)

const fill = computed(() => sanitizeCssValue(props.mark.fill, FILL_NONE))

// ⚠ 不产这两个属性时给的是 undefined 不是 null：Vue 的 SVG 属性类型不收 null，
// 而两者在运行期同样都是「把属性摘掉」
const dash = computed<string | undefined>(() =>
  props.mark.strokeDash ? DASH_PATTERN : undefined,
)

const vectorEffect = computed<string | undefined>(() =>
  props.mark.nonScalingStroke ? FIXED_STROKE : undefined,
)

const label = computed<MarkLabel>(() =>
  props.mark.kind === 'line' ? lineLabel(props.mark) : boxLabel(props.mark),
)

/** 标签色：字体色优先，留空落回描边色（参考项目只有描边色这一档）。 */
const labelFill = computed(() =>
  sanitizeCssValue(props.mark.font.color, stroke.value),
)

const labelStyle = computed(() => fontCss(props.mark.font))
</script>

<template>
  <g
    class="t2m-mark"
    data-test="mark"
    :data-id="mark.id"
    :data-kind="mark.kind"
    :stroke="stroke"
    :stroke-width="mark.strokeWidth"
    :stroke-dasharray="dash"
    :opacity="mark.opacity"
  >
    <rect
      v-if="mark.kind === 'rect'"
      class="t2m-shape"
      data-test="mark-shape"
      :x="mark.x"
      :y="mark.y"
      :width="mark.w"
      :height="mark.h"
      :fill="fill"
      :vector-effect="vectorEffect"
    />
    <line
      v-else-if="mark.kind === 'line'"
      class="t2m-shape"
      data-test="mark-shape"
      :x1="mark.x"
      :y1="mark.y"
      :x2="mark.x2"
      :y2="mark.y2"
      :vector-effect="vectorEffect"
    />
    <text
      v-if="mark.text !== ''"
      class="t2m-label"
      data-test="mark-label"
      :x="label.x"
      :y="label.y"
      :text-anchor="label.anchor"
      :dominant-baseline="label.baseline"
      :fill="labelFill"
      :style="labelStyle"
    >
      {{ mark.text }}
    </text>
  </g>
</template>

<style scoped>
.t2m-shape {
  stroke-linejoin: round;
  stroke-linecap: round;
}

/* 描边字：字压在一圈底色描边上，小字号压在深浅底图上也读得清 */
.t2m-label {
  font-size: 16px;
  font-weight: 600;
  letter-spacing: 0.02em;
  paint-order: stroke;
  stroke: color-mix(in srgb, var(--surface-base) 80%, transparent);
  stroke-width: 3px;
  stroke-dasharray: none;
}
</style>
