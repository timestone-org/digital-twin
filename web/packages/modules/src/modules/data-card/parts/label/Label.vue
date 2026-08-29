<script setup lang="ts">
/**
 * @fileoverview 名称部件的画法。
 * ⚠ 没起名字的格**整件不渲染、也不占位**：留一行空白会多出一段行距，
 * 同一张卡上有名字与没名字的格从此对不齐。
 */
import { computed, type CSSProperties } from 'vue'

import type { CardPartProps } from '../../../../cardParts/types'
import { readEnum, readNumber } from '../../../../shared/config'

// ⚠ 三件套一个都不能少：没声明的那个会掉成透传属性，在 DOM 上留下
//   `meta="[object Object]"` 这种脏东西，而两侧都不报错
const props = defineProps<CardPartProps>()

const TONES = ['secondary', 'primary', 'title', 'accent'] as const

/** 四档文字色，逐档指向主题变量——不写死色值，换肤才跟着走。 */
const TONE_COLORS: Readonly<Record<(typeof TONES)[number], string>> = {
  secondary: 'var(--text-secondary)',
  primary: 'var(--text-primary)',
  title: 'var(--text-title)',
  accent: 'var(--accent-primary)',
}

const style = computed<CSSProperties>(() => ({
  fontSize: `${String(readNumber(props.part.size, 12))}px`,
  color: TONE_COLORS[readEnum(props.part.tone, TONES, 'secondary')],
  opacity: readNumber(props.part.opacity, 1),
}))
</script>

<template>
  <span v-if="cell.label !== ''" class="dc-label" :style="style">
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
</style>
