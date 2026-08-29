<script setup lang="ts">
/**
 * @fileoverview 读数部件的画法：主读数 + 单位。
 * ⚠ 取不到值时画格级口径里的那个占位符，**绝不伪造 0**——一个停机的机组显示 0
 * 与显示「—」，运维要做的事完全不同。
 */
import { computed, type CSSProperties } from 'vue'

import type { CardPartProps } from '../../../../cardParts/types'
import {
  readBoolean,
  readEnum,
  readNumber,
  readText,
} from '../../../../shared/config'
import {
  fmtDecimal,
  fmtTrim,
  isPresent,
  toNumOrNull,
} from '../../../../shared/format'

// ⚠ 三件套一个都不能少：没声明的那个会掉成透传属性，在 DOM 上留下
//   `meta="[object Object]"` 这种脏东西，而两侧都不报错
const props = defineProps<CardPartProps>()

const FONTS = ['digit', 'sans'] as const

/** 字号 0 = 跟着格宽自适应，交给 CSS 的 `cqw`；填了正数就钉死。 */
const AUTO_SIZE = 'clamp(18px, 22cqw, 56px)'

const numeric = computed(() => toNumOrNull(props.cell.values.value))

/**
 * 读数文本。
 * ⚠ 只认数与字符串：文本原样透传（现场推来的成品文案走这一路），其余一律画占位符。
 * 对象与数组硬转出来的是 `[object Object]`——那种东西出现在墙上比缺值更难查。
 * ⚠ 工控点位的开关量多半是 0/1 数值，走数值那一路；真正的布尔要文案，
 * 用吃 `state` 槽的部件，别在这里塞第三条分支。
 */
const text = computed(() => {
  const raw = props.cell.values.value
  if (typeof raw === 'string')
    return raw === '' ? props.cell.format.emptyText : raw
  const num = numeric.value
  if (num === null) return props.cell.format.emptyText
  const { precision, fixedDecimals, thousands } = props.cell.format
  return fixedDecimals
    ? fmtDecimal(num, precision, thousands)
    : fmtTrim(num, precision)
})

const hasValue = computed(
  () => isPresent(numeric.value) || text.value !== props.cell.format.emptyText,
)

const style = computed<CSSProperties>(() => {
  const size = readNumber(props.part.size, 0)
  const glow = readNumber(props.part.glow, 0)
  const color = readText(props.part.color, 'var(--accent-primary)')
  return {
    fontSize: size === 0 ? AUTO_SIZE : `${String(size)}px`,
    color,
    // 「没配 = 不写值」：0 辉光写成 `0 0 0` 仍会让浏览器多算一层
    ...(glow === 0 ? {} : { textShadow: `0 0 ${String(glow)}px ${color}` }),
  }
})

const isDigitFont = computed(
  () => readEnum(props.part.font, FONTS, 'digit') === 'digit',
)

const showUnit = computed(
  () =>
    readBoolean(props.part.showUnit, true) &&
    props.cell.format.unit !== '' &&
    hasValue.value,
)

const unitStyle = computed<CSSProperties>(() => ({
  fontSize: `${String(readNumber(props.part.unitSize, 12))}px`,
}))
</script>

<template>
  <span class="dc-value">
    <b
      class="dc-value__num"
      :class="{ 'dc-value__num--digit': isDigitFont }"
      :style="style"
      :title="text"
      >{{ text }}</b
    >
    <i v-if="showUnit" class="dc-value__unit" :style="unitStyle">{{
      cell.format.unit
    }}</i>
  </span>
</template>

<style scoped>
.dc-value {
  display: flex;
  align-items: baseline;
  gap: 4px;
  min-width: 0;
}

.dc-value__num {
  overflow: hidden;
  font-weight: 600;
  line-height: 1.1;
  white-space: nowrap;
  text-overflow: ellipsis;
}

/* 等宽数字：读数逐帧跳动时列宽不抖 */
.dc-value__num--digit {
  font-family: var(--font-digit, var(--font-display, inherit));
  font-variant-numeric: tabular-nums;
}

.dc-value__unit {
  flex: none;
  color: var(--text-secondary);
  font-style: normal;
}
</style>
