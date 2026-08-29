<script setup lang="ts">
/**
 * @fileoverview 附加字段的画法：标签 + 读数 + 单位。
 * ⚠ 取不到值时画格级口径里的那个占位符，**绝不伪造 0**，也不把整件藏起来——
 * 藏了的话一排卡片里这一格会少一行，看着像布局坏了。
 * ⚠ 没有值时不画单位：「— kW」看着像是有读数的。
 */
import { computed, type CSSProperties } from 'vue'

import type { CardPartProps, CardSlotKey } from '../../../../cardParts/types'
import { CARD_SLOT_KEYS } from '../../../../cardParts/types'
import { readEnum, readNumber, readText } from '../../../../shared/config'
import { fmtDecimal, fmtTrim, toNumOrNull } from '../../../../shared/format'
import { cellState, reasonOf } from '../../../../shared/slotState'

// ⚠ 三件套一个都不能少：没声明的那个会掉成透传属性，在 DOM 上留下
//   `meta="[object Object]"` 这种脏东西，而两侧都不报错
const props = defineProps<CardPartProps>()

/** 读哪个槽；认不出时回落到附加字段一。 */
const slot = computed<CardSlotKey>(() =>
  readEnum(props.part.slot, CARD_SLOT_KEYS, 'extra1'),
)

const raw = computed(() => props.cell.values[slot.value])

const state = computed(() =>
  cellState(props.meta.slots[slot.value], raw.value, props.meta.hasSlots),
)

const reason = computed(() =>
  reasonOf(state.value, props.meta.slots[slot.value]),
)

const numeric = computed(() => toNumOrNull(raw.value))

const hasValue = computed(() => state.value === 'ok' && numeric.value !== null)

const text = computed(() => {
  if (!hasValue.value || numeric.value === null)
    return props.cell.format.emptyText
  const precision = readNumber(props.part.precision, 1)
  return props.cell.format.fixedDecimals
    ? fmtDecimal(numeric.value, precision, props.cell.format.thousands)
    : fmtTrim(numeric.value, precision)
})

const label = computed(() => readText(props.part.label))

const unit = computed(() => readText(props.part.unit))

const style = computed<CSSProperties>(() => {
  const color = readText(props.part.color)
  const base = { fontSize: `${String(readNumber(props.part.size, 12))}px` }
  // ⚠ 没有值的三档不写配色：写了就把内联样式压在类上面，占位符会被画成读数色
  if (!hasValue.value) return base
  return { ...base, ...(color === '' ? {} : { color }) }
})
</script>

<template>
  <span class="dc-extra" :style="style">
    <i v-if="label !== ''" class="dc-extra__label">{{ label }}</i>
    <b
      class="dc-extra__num"
      :class="`dc-extra__num--${state}`"
      :title="reason === '' ? text : reason"
      >{{ text }}</b
    >
    <i v-if="hasValue && unit !== ''" class="dc-extra__unit">{{ unit }}</i>
  </span>
</template>

<style scoped>
.dc-extra {
  display: inline-flex;
  align-items: baseline;
  gap: 3px;
  min-width: 0;
  line-height: 1.3;
}

.dc-extra__label {
  flex: none;
  color: var(--text-disabled);
  font-style: normal;
}

.dc-extra__num {
  overflow: hidden;
  color: var(--text-primary);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  text-overflow: ellipsis;
}

/* 没有读数的三档：与读数部件同一套浓淡口径 */
.dc-extra__num--pending {
  color: var(--text-secondary);
  opacity: 0.7;
}

.dc-extra__num--unbound {
  color: var(--text-disabled);
}

.dc-extra__num--error {
  color: var(--state-danger);
}

.dc-extra__unit {
  flex: none;
  color: var(--text-secondary);
  font-style: normal;
}
</style>
