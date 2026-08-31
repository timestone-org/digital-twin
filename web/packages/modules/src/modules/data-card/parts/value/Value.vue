<script setup lang="ts">
/**
 * @fileoverview 读数部件的画法：主读数 + 单位。
 * ⚠ 取不到值时画格级口径里的那个占位符，**绝不伪造 0**——一个停机的机组显示 0
 * 与显示「—」，运维要做的事完全不同。
 * ⚠ 「没配来源／等首帧／取不到」这三档不许合成一档：模块自报 `ownsStatusDisplay`，
 * 整格浮层已经被让开了，这里不分开的话现场断了的那一格与从没配过的那一格在墙上
 * 一模一样。原因整句挂 `title`——一格的宽度摆不下短标签。
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
  fmtNumber,
  fmtTrim,
  isPresent,
  toNumOrNull,
} from '../../../../shared/format'
import { cellState, reasonOf } from '../../../../shared/slotState'

// ⚠ 三件套一个都不能少：没声明的那个会掉成透传属性，在 DOM 上留下
//   `meta="[object Object]"` 这种脏东西，而两侧都不报错
const props = defineProps<CardPartProps>()

const FONTS = ['digit', 'sans'] as const

/** 字号 0 = 跟着格宽自适应，交给 CSS 的 `cqw`；填了正数就钉死。 */
const AUTO_SIZE = 'clamp(18px, 22cqw, 56px)'

const numeric = computed(() => toNumOrNull(props.cell.values.value))

/** 主读数这一槽落在哪一档。⚠ 没接过来源的槽不在 `slots` 表里，故缺席即「没配来源」。 */
const state = computed(() =>
  cellState(
    props.meta.slots.value,
    props.cell.values.value,
    props.meta.hasSlots,
  ),
)

/** 没有值时鼠标停上去看得全的那句话；有值时空串。 */
const reason = computed(() => reasonOf(state.value, props.meta.slots.value))

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
  // ⚠ 千分位在两档下都要生效：只在补零档接它，等于「千分位」这个开关单开时
  //   点了没反应，而两侧都不报错
  if (fixedDecimals) return fmtDecimal(num, precision, thousands)
  return thousands ? fmtNumber(num, precision) : fmtTrim(num, precision)
})

const hasValue = computed(
  () =>
    state.value === 'ok' &&
    (isPresent(numeric.value) || text.value !== props.cell.format.emptyText),
)

const style = computed<CSSProperties>(() => {
  const size = readNumber(props.part.size, 0)
  const glow = readNumber(props.part.glow, 0)
  const color = readText(props.part.color, 'var(--accent-primary)')
  const base = { fontSize: size === 0 ? AUTO_SIZE : `${String(size)}px` }
  // ⚠ 没有值的三档不写配色：写了就把内联样式压在类上面，占位符会被画成读数色
  if (!hasValue.value) return base
  return {
    ...base,
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
      :class="[
        `dc-value__num--${state}`,
        { 'dc-value__num--digit': isDigitFont },
      ]"
      :style="style"
      :title="reason === '' ? text : reason"
      >{{ hasValue ? text : cell.format.emptyText }}</b
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

/* 没有读数的三档：占位符是同一个「—」，全靠颜色与透明度分开，与列表族同一套口径 */
.dc-value__num--pending {
  color: var(--text-secondary);
  opacity: 0.7;
}

.dc-value__num--unbound {
  color: var(--text-disabled);
}

/* 取不到要显眼：它是「去查现场」的信号，与「还没配」不是一回事 */
.dc-value__num--error {
  color: var(--state-danger);
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
