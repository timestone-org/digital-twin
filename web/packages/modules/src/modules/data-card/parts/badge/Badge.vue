<script setup lang="ts">
/**
 * @fileoverview 状态徽标的画法。归一化与配色都在共用件里，这里只挑档与传文案。
 * ⚠ 「只留圆点」那一档仍渲染徽标本体、只是把文案藏起来：整件 `v-if` 掉的话，
 * 一排设备里状态位空着的那台会连位置都不占，看着像少了一台。
 */
import { computed } from 'vue'

import type { CardPartProps } from '../../../../cardParts/types'
import { readEnum, readText } from '../../../../shared/config'
import StatusBadge from '../../../../shared/StatusBadge.vue'
import { toDeviceStatus } from '../../../../shared/status'

// ⚠ 三件套一个都不能少：没声明的那个会掉成透传属性，在 DOM 上留下
//   `meta="[object Object]"` 这种脏东西，而两侧都不报错
const props = defineProps<CardPartProps>()

const STYLES = ['outline', 'solid', 'dot'] as const

const status = computed(() => toDeviceStatus(props.cell.values.state))

const look = computed(() => readEnum(props.part.style, STYLES, 'outline'))

/**
 * 覆盖文案，没有就不传这个 prop。
 * ⚠ 不能传 `undefined` 顶替「不传」：`exactOptionalPropertyTypes` 下两者不是一回事，
 * 而共用件靠「传没传」区分「用状态名」与「显示空文案」。
 */
const labelProp = computed<{ label?: string }>(() => {
  if (look.value === 'dot') return { label: '' }
  const text = readText(props.part.text)
  return text === '' ? {} : { label: text }
})
</script>

<template>
  <span class="dc-badge" :class="`dc-badge--${look}`">
    <StatusBadge :status="status" v-bind="labelProp" />
  </span>
</template>

<style scoped>
.dc-badge {
  display: inline-flex;
  min-width: 0;
}

/* 实心档：把共用件的透明底换成语义色的浅底，边框跟着透明 */
.dc-badge--solid :deep(.dt-status-badge) {
  border-color: transparent;
  background: color-mix(in srgb, currentColor 18%, transparent);
}

/* 只留圆点：文案已是空串，这里把它留下的那点行距也收掉 */
.dc-badge--dot :deep(.dt-status-badge) {
  padding: 3px;
}

.dc-badge--dot :deep(.dt-status-badge__label) {
  display: none;
}
</style>
