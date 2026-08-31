<script setup lang="ts">
/**
 * @fileoverview 名称部件的画法。
 * ⚠ 没起名字的格**整件不渲染、也不占位**：留一行空白会多出一段行距，
 * 同一张卡上有名字与没名字的格从此对不齐。
 */
import { computed, type CSSProperties } from 'vue'

import type { CardPartProps } from '../../../../cardParts/types'
import { readBoolean, readEnum, readNumber } from '../../../../shared/config'

// ⚠ 三件套一个都不能少：没声明的那个会掉成透传属性，在 DOM 上留下
//   `meta="[object Object]"` 这种脏东西，而两侧都不报错
const props = defineProps<CardPartProps>()

const TONES = ['secondary', 'primary', 'title', 'accent', 'cell'] as const

/**
 * 文字色走**档位类**而不是内联样式：五档都是纯 token 引用，写进样式表才好带回落
 * （「跟随格基色」那一档必须带：格上没配基色时那个变量根本没写，不带回落的 `var()`
 * 会让整条 color 声明作废，字变成继承色）。
 */
const tone = computed(() => readEnum(props.part.tone, TONES, 'secondary'))

const hasDot = computed(() => readBoolean(props.part.dot, false))

const style = computed<CSSProperties>(() => ({
  fontSize: `${String(readNumber(props.part.size, 12))}px`,
  opacity: readNumber(props.part.opacity, 1),
}))
</script>

<template>
  <span
    v-if="cell.label !== ''"
    class="dc-label"
    :class="[`dc-label--${tone}`, { 'dc-label--dot': hasDot }]"
    :style="style"
  >
    <i v-if="hasDot" class="dc-label__dot" aria-hidden="true" />
    {{ cell.label }}
  </span>
</template>

<style scoped>
.dc-label {
  display: block;
  overflow: hidden;
  line-height: 1.4;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.dc-label--secondary {
  color: var(--text-secondary);
}

.dc-label--primary {
  color: var(--text-primary);
}

.dc-label--title {
  color: var(--text-title);
}

.dc-label--accent {
  color: var(--accent-primary);
}

/* ⚠ 回落不能省：格上没配基色时那个变量根本没写 */
.dc-label--cell {
  color: var(--dc-cell-color, var(--text-title));
}

/* 带圆点时改成行内弹性盒：块级下圆点与文字的基线对不齐 */
.dc-label--dot {
  display: flex;
  align-items: center;
  gap: 5px;
}

/* ⚠ 圆点吃格基色而不是文字色：文字多半是次要灰，圆点要的是那一格的身份色 */
.dc-label__dot {
  flex: none;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--dc-cell-color, var(--accent-primary));
  box-shadow: 0 0 5px var(--dc-cell-color, var(--accent-primary));
}
</style>
