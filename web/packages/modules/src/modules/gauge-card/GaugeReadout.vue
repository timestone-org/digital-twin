<script lang="ts">
/**
 * @fileoverview 一个仪表的读数那一组：标签 ｜ 读数 + 单位 + 完成率。四档状态的修饰类、
 * 命中文案与闪烁都落在这里（MODULE_INFO_CARD_DESIGN §4.2 / §6.3）。
 * ⚠ 单独成件是给「摆图形中央」那一档用的：它要塞进 `GaugeShape` 的居中层，与摆在图形
 * 旁边、下方那两档共用同一份 DOM，各写一份必然漂。
 * ⚠ 标签与读数各自判空后才渲染：读数不显示那一档（`readout: 'none'`）留一个空
 * `.gc-read` 会占掉一行行高，图形跟着偏几像素——没人会把它当缺陷报上来。
 */
</script>

<script setup lang="ts">
import { computed } from 'vue'

import { GAUGE_STATE_CLASS, type GaugeView } from './gauges'

const props = defineProps<{ view: GaugeView }>()

const labelClasses = computed(() => [
  'gc-label',
  { 'gc-label--hit': props.view.labelIsHit },
])

const valueClasses = computed(() => [
  'gc-value',
  GAUGE_STATE_CLASS[props.view.state],
  { 'gc-value--blink': props.view.blink },
])

/** 没有值的那一句话；有值时给 undefined，鼠标停上去不该冒出一个空提示。 */
const valueTitle = computed(() =>
  props.view.reason === '' ? undefined : props.view.reason,
)
</script>

<template>
  <span class="gc-readout">
    <span v-if="view.label !== ''" :class="labelClasses">{{ view.label }}</span>
    <span v-if="view.text !== ''" class="gc-read">
      <span :class="valueClasses" :title="valueTitle">{{ view.text }}</span>
      <i v-if="view.unit !== ''" class="gc-unit">{{ view.unit }}</i>
      <i v-if="view.percentText !== ''" class="gc-percent">{{
        view.percentText
      }}</i>
    </span>
  </span>
</template>

<style scoped lang="scss">
@use './variants';
</style>
