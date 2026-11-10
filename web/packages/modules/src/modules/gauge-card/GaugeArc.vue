<script setup lang="ts">
/**
 * @fileoverview 弧度盘：按弧实际占到的纵向范围取景，读数层钉在表盘盒上——摆圆心那一档以
 * 圆心居中，满弧 + 指针那一档摆在轴心下方（MODULE_INFO_CARD_DESIGN §4.2）。
 */
import { computed, useId, type CSSProperties } from 'vue'

import { GAUGE_NEEDLE_HUB_RADIUS, arcFrame, needlePath } from './geometry'

import type { GaugeView } from './gauges'
import type { GaugeLook } from './look'

const props = defineProps<{ view: GaugeView; look: GaugeLook }>()

/** 摆图形中央那一档的读数从这里塞进来；没给就整层不画。 */
defineSlots<{ center?: () => unknown }>()

/**
 * 弧的渐变色标 id。
 * ⚠ 必须逐个实例唯一：同一屏几十个仪表共用一个 id 时，后面每一个都会引到第一个的色标，
 * 换了填充色也不跟着变，而控制台一声不吭。
 */
const gradientId = `gc-arc-${useId()}`

/**
 * 弧填充的描边。
 * ⚠ 渐变档只能指到 SVG 的 `<linearGradient>`：CSS 的 `linear-gradient()` 上不了 `stroke`。
 * ⚠ 走内联样式而不是 `stroke` 表示属性：表示属性的优先级低于任何 CSS 规则，样式表里
 * 那条 `.gc-arc__fill { stroke: … }` 会把它整个盖掉——弧照样画，只是永远是纯色。
 */
const arcStroke = computed(() =>
  props.look.fillStyle === 'solid' ? '' : `url(#${gradientId})`,
)

/**
 * 自定义色标那一档摆几个 `<stop>`；其余两档摆写死在样式表里的那两个。
 * ⚠ 顺序已由 `readColorStops` 排好：`<stop>` 按**文档序**生效，倒着写的两档会被
 * 浏览器静默夹平成一段纯色。
 */
const stops = computed(() =>
  props.look.fillStyle === 'stops' ? props.look.colorStops : [],
)

function compact(value: number): string {
  return String(Number(value.toFixed(3)))
}

/** 满弧 + 指针那一档：整条弧都上色，读数由指针指。只有弧度盘吃得下。 */
const hasNeedle = computed(
  () => props.look.shape === 'arc' && props.look.indicator === 'needle',
)

const needleD = computed(() =>
  needlePath(
    props.view.percent,
    props.look.geometry.arcSpan,
    props.look.geometry.thickness,
  ),
)

/** 弧按实际占到的纵向范围取景，读数落点跟着换算 */
const frame = computed(() =>
  arcFrame(
    props.look.geometry.thickness,
    props.look.geometry.arcSpan,
    hasNeedle.value,
  ),
)

const viewBox = computed(
  () => `0 ${String(frame.value.minY)} 100 ${String(frame.value.height)}`,
)

/**
 * 表盘盒按取景的宽高比撑开，读数层绝对定位在这只盒上。
 * ⚠ 读数落点用百分比是因为盒与取景同比：宽受限时高随宽走，高受限时只在横向留白，
 * 纵向比例始终对得上。
 */
const dialStyle = computed<CSSProperties>(() => ({
  aspectRatio: `100 / ${String(frame.value.height)}`,
}))

/** 读数层的落点：摆圆心那一档以圆心居中，指针档摆在轴心下方。 */
const readStyle = computed<CSSProperties>(() => {
  const f = frame.value
  const top = hasNeedle.value ? f.needleReadRatio : f.centerRatio
  return {
    top: `${compact(top * 100)}%`,
    transform: hasNeedle.value ? undefined : 'translateY(-50%)',
  }
})
</script>

<template>
  <span class="gc-dial" :style="dialStyle">
    <svg
      class="gc-arc"
      :viewBox="viewBox"
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
    >
      <defs v-if="arcStroke !== ''">
        <!-- ⚠ 自定义色标走横向（左→右），与图上「左红右青」的读法一致；
           两档缺省色标仍走竖向，改了会让存量大屏的弧整体换个方向 -->
        <linearGradient
          :id="gradientId"
          :x1="stops.length > 0 ? 0 : 0"
          :y1="stops.length > 0 ? 0 : 1"
          :x2="stops.length > 0 ? 1 : 0"
          :y2="0"
        >
          <template v-if="stops.length > 0">
            <stop
              v-for="(stop, at) in stops"
              :key="`stop-${String(at)}`"
              :offset="`${String(stop.at)}%`"
              :stop-color="stop.color"
            />
          </template>
          <template v-else>
            <stop class="gc-arc__stop-a" offset="0%" />
            <stop class="gc-arc__stop-b" offset="100%" />
          </template>
        </linearGradient>
      </defs>
      <path
        class="gc-arc__track"
        :d="look.geometry.arcPath"
        fill="none"
        :stroke-width="look.geometry.thickness"
        stroke-linecap="round"
      />
      <!-- 满弧档：整条弧上色，不按读数裁；读数交给指针 -->
      <path
        v-if="hasNeedle"
        class="gc-arc__fill gc-arc__fill--full"
        :d="look.geometry.arcPath"
        fill="none"
        :stroke-width="look.geometry.thickness"
        stroke-linecap="round"
        :style="{ stroke: arcStroke }"
      />
      <path
        v-else-if="view.fill !== ''"
        class="gc-arc__fill"
        :d="look.geometry.arcPath"
        fill="none"
        :stroke-width="look.geometry.thickness"
        stroke-linecap="round"
        pathLength="100"
        stroke-dasharray="100"
        :stroke-dashoffset="view.dashOffset"
        :style="{ stroke: arcStroke }"
      />
      <!-- ⚠ 读数取不到时不画指针：指在起点会被读成「现在是最小值」 -->
      <g v-if="hasNeedle && view.percent !== null" class="gc-needle">
        <path class="gc-needle__blade" :d="needleD" />
        <circle
          class="gc-needle__hub"
          cx="50"
          cy="50"
          :r="GAUGE_NEEDLE_HUB_RADIUS"
        />
      </g>
    </svg>
    <span
      v-if="$slots.center !== undefined"
      class="gc-center"
      :style="readStyle"
      ><slot name="center"
    /></span>
  </span>
</template>

<style scoped lang="scss">
@use './variants';
</style>
