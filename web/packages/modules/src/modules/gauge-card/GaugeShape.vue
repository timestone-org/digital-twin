<script setup lang="ts">
/**
 * @fileoverview 一个仪表的几何：五档形状（弧度盘 / 横向条 / 目标轨道 / 储罐 / 温度计）
 * 共用「量程 → 百分比 → 填充」这条链，只在最后一步分叉成弧的 dashoffset、条的宽度或
 * 液面的高度（MODULE_INFO_CARD_DESIGN §4.2）。
 * ⚠ 只画表盘，不画读数：读数那一组由卡片组件渲染，摆图形中央那一档经 `center` 插槽塞进
 * 居中层——它绝对定位在 `.gc-figure` 上，量程端点不参与居中。
 * ⚠ `view.fill` 是空串就整条填充**不渲染**：只把宽/高设成 0 会在真实 0% 上留一小截带辉光
 * 的圆角色块，读起来像「有一点点」。
 * ⚠ 刻度、目标标记与轨道内 pill 是粗轨道那一档独有的（§4.2 的参数列），其余四档不摆。
 */
import { computed, useId } from 'vue'

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

const shapeClasses = computed(() => [
  `gc-shape--${props.look.shape}`,
  { 'gc-shape--grad': props.look.fillStyle === 'gradient' },
])

/**
 * 弧填充的描边。
 * ⚠ 渐变档只能指到 SVG 的 `<linearGradient>`：CSS 的 `linear-gradient()` 上不了 `stroke`。
 * ⚠ 走内联样式而不是 `stroke` 表示属性：表示属性的优先级低于任何 CSS 规则，样式表里
 * 那条 `.gc-arc__fill { stroke: … }` 会把它整个盖掉——弧照样画，只是永远是纯色。
 */
const arcStroke = computed(() =>
  props.look.fillStyle === 'gradient' ? `url(#${gradientId})` : '',
)

/** 刻度、目标标记与 pill 只有粗轨道那一档摆。 */
const isTrack = computed(() => props.look.shape === 'track')
</script>

<template>
  <span class="gc-shape" :class="shapeClasses">
    <span class="gc-figure">
      <svg
        v-if="look.shape === 'arc'"
        class="gc-arc"
        viewBox="0 0 100 100"
        preserveAspectRatio="xMidYMid meet"
        aria-hidden="true"
      >
        <defs v-if="arcStroke !== ''">
          <linearGradient :id="gradientId" x1="0" y1="1" x2="0" y2="0">
            <stop class="gc-arc__stop-a" offset="0%" />
            <stop class="gc-arc__stop-b" offset="100%" />
          </linearGradient>
        </defs>
        <path
          class="gc-arc__track"
          :d="look.geometry.arcPath"
          fill="none"
          :stroke-width="look.geometry.thickness"
          stroke-linecap="round"
        />
        <path
          v-if="view.fill !== ''"
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
      </svg>
      <span
        v-else-if="look.shape === 'linear' || look.shape === 'track'"
        class="gc-bar"
      >
        <i
          v-if="view.fill !== ''"
          class="gc-bar__fill"
          :style="{ width: view.fill }"
        />
        <span v-if="isTrack && view.pillText !== ''" class="gc-pill">{{
          view.pillText
        }}</span>
        <i
          v-if="isTrack && view.target !== null"
          class="gc-target"
          :style="{ left: `${view.target.percent}%` }"
          aria-hidden="true"
        />
        <span
          v-if="isTrack && view.target !== null"
          class="gc-target__label"
          :style="{
            left: `${view.target.percent}%`,
            transform: `translateX(${view.target.shift})`,
          }"
          >{{ view.target.label }}</span
        >
      </span>
      <span v-else-if="look.shape === 'tank'" class="gc-tank">
        <span
          v-if="view.fill !== ''"
          class="gc-tank__fill"
          :style="{ height: view.fill }"
        >
          <i class="gc-tank__surface" />
        </span>
      </span>
      <span v-else class="gc-thermo">
        <span class="gc-thermo__tube">
          <i
            v-if="view.fill !== ''"
            class="gc-thermo__fill"
            :style="{ height: view.fill }"
          />
        </span>
        <i class="gc-thermo__bulb" />
      </span>
      <span v-if="isTrack && view.ticks.length > 0" class="gc-ticks">
        <i
          v-for="tick in view.ticks"
          :key="tick.key"
          class="gc-tick"
          :style="{
            left: `${tick.percent}%`,
            transform: `translateX(${tick.shift})`,
          }"
          >{{ tick.label }}</i
        >
      </span>
      <span v-if="$slots.center !== undefined" class="gc-center"
        ><slot name="center"
      /></span>
    </span>
    <span v-if="view.range !== null" class="gc-range">
      <span class="gc-range__min">{{ view.range.min }}</span>
      <span class="gc-range__max">{{ view.range.max }}</span>
    </span>
  </span>
</template>

<style scoped lang="scss">
@use './variants';
</style>
