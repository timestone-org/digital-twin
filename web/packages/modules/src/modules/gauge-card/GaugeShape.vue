<script setup lang="ts">
/**
 * @fileoverview 一个仪表的几何：五档形状（弧度盘 / 横向条 / 目标轨道 / 储罐 / 温度计）
 * 共用「量程 → 百分比 → 填充」这条链，只在最后一步分叉成弧的 dashoffset、条的宽度或
 * 液面的高度（MODULE_INFO_CARD_DESIGN §4.2）。
 * ⚠ 只画表盘，不画读数：读数那一组由卡片组件渲染，摆图形中央那一档经 `center` 插槽塞进
 * 居中层——它绝对定位在 `.gc-figure` 上，量程端点不参与居中；弧度盘那一档另由
 * `GaugeArc` 钉在表盘盒上。
 * ⚠ `view.fill` 是空串就整条填充**不渲染**：只把宽/高设成 0 会在真实 0% 上留一小截带辉光
 * 的圆角色块，读起来像「有一点点」。
 * ⚠ 刻度、目标标记与轨道内 pill 是粗轨道那一档独有的（§4.2 的参数列），其余四档不摆。
 */
import { DtTooltip } from '@dt/ui'
import { computed, type CSSProperties } from 'vue'

import GaugeArc from './GaugeArc.vue'

import type { GaugeView } from './gauges'
import type { GaugeLook } from './look'

const props = defineProps<{ view: GaugeView; look: GaugeLook }>()

/** 摆图形中央那一档的读数从这里塞进来；没给就整层不画。 */
defineSlots<{ center?: () => unknown }>()

const shapeClasses = computed(() => [
  `gc-shape--${props.look.shape}`,
  { 'gc-shape--grad': props.look.fillStyle === 'gradient' },
])

function compact(value: number): string {
  return String(Number(value.toFixed(3)))
}

function stopColorAt(percent: number): string {
  const table = props.look.colorStops
  const first = table[0]
  const last = table.at(-1)
  if (first === undefined || last === undefined) return ''
  if (percent <= first.at) return first.color
  for (let index = 1; index < table.length; index += 1) {
    const right = table[index]
    const left = table[index - 1]
    if (right === undefined || left === undefined || percent > right.at)
      continue
    if (percent === right.at || right.at <= left.at) return right.color
    const rightWeight = ((percent - left.at) / (right.at - left.at)) * 100
    return `color-mix(in srgb, ${left.color} ${compact(100 - rightWeight)}%, ${right.color})`
  }
  return last.color
}

/** 非弧形渐变按整量程缩放，裁短填充只显示当前位置之前的色谱。 */
const customFillStyle = computed<CSSProperties>(() => {
  if (
    props.look.shape === 'arc' ||
    props.look.fillStyle !== 'stops' ||
    props.look.colorStops.length < 2
  ) {
    return {}
  }
  const angle =
    props.look.shape === 'tank' || props.look.shape === 'thermometer' ? 0 : 90
  const colors = props.look.colorStops
    .map((stop) => `${stop.color} ${String(stop.at)}%`)
    .join(', ')
  const percent = Math.max(0.001, Math.min(100, props.view.percent ?? 100))
  const scale = `${compact(10_000 / percent)}%`
  const vertical = angle === 0
  return {
    '--gc-current-stop': stopColorAt(percent),
    backgroundImage: `linear-gradient(${String(angle)}deg, ${colors})`,
    backgroundPosition: vertical ? 'center bottom' : 'left center',
    backgroundSize: vertical ? `100% ${scale}` : `${scale} 100%`,
  }
})

const currentStopStyle = computed<CSSProperties>(() => {
  if (props.look.fillStyle !== 'stops' || props.view.percent === null) return {}
  const color = stopColorAt(props.view.percent)
  return color === '' ? {} : { '--gc-current-stop': color }
})

/** 刻度、目标标记与 pill 只有粗轨道那一档摆。 */
const isTrack = computed(() => props.look.shape === 'track')
</script>

<template>
  <span class="gc-shape" :class="shapeClasses">
    <span class="gc-figure">
      <DtTooltip
        v-if="view.targetReason !== ''"
        class="gc-target-issue"
        :content="view.targetReason"
      >
        <span
          class="gc-target-issue__mark"
          tabindex="0"
          :aria-label="view.targetReason"
          >!</span
        >
      </DtTooltip>
      <GaugeArc v-if="look.shape === 'arc'" :view="view" :look="look">
        <template v-if="$slots.center !== undefined" #center>
          <slot name="center" />
        </template>
      </GaugeArc>
      <span
        v-else-if="look.shape === 'linear' || look.shape === 'track'"
        class="gc-bar"
      >
        <i
          v-if="view.fill !== ''"
          class="gc-bar__fill"
          :style="[{ width: view.fill }, customFillStyle]"
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
          :style="[{ height: view.fill }, customFillStyle]"
        >
          <i class="gc-tank__surface" :style="currentStopStyle" />
        </span>
      </span>
      <span v-else class="gc-thermo">
        <span class="gc-thermo__tube">
          <i
            v-if="view.fill !== ''"
            class="gc-thermo__fill"
            :style="[{ height: view.fill }, customFillStyle]"
          />
        </span>
        <i class="gc-thermo__bulb" :style="currentStopStyle" />
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
      <span
        v-if="$slots.center !== undefined && look.shape !== 'arc'"
        class="gc-center"
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
