<script setup lang="ts">
/**
 * @fileoverview 短标签的画法。
 * ⚠ 文字留空时整件不画：胶囊档留个空壳在那里，看着像渲染坏了。
 */
import { computed, type CSSProperties } from 'vue'

import type { CardPartProps } from '../../../../cardParts/types'
import { readEnum, readNumber, readText } from '../../../../shared/config'

// ⚠ 三件套一个都不能少：没声明的那个会掉成透传属性，在 DOM 上留下
//   `meta="[object Object]"` 这种脏东西，而两侧都不报错
const props = defineProps<CardPartProps>()

const LOOKS = ['chip', 'plain', 'outline'] as const

const text = computed(() => readText(props.part.text))

const look = computed(() => readEnum(props.part.look, LOOKS, 'chip'))

const style = computed<CSSProperties>(() => {
  const color = readText(props.part.color)
  return {
    fontSize: `${String(readNumber(props.part.size, 11))}px`,
    // 「没配 = 不写值」：写了就再也回落不到卡片的次要文字色
    ...(color === '' ? {} : { color }),
  }
})
</script>

<template>
  <span
    v-if="text !== ''"
    class="dc-tag"
    :class="`dc-tag--${look}`"
    :style="style"
    >{{ text }}</span
  >
</template>

<style scoped>
.dc-tag {
  display: inline-flex;
  flex: none;
  align-items: center;
  overflow: hidden;
  color: var(--text-secondary);
  line-height: 1.2;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.dc-tag--chip {
  padding: 2px 6px;
  border-radius: 999px;
  background: color-mix(in srgb, currentColor 12%, transparent);
}

.dc-tag--outline {
  padding: 2px 6px;
  border: 1px solid color-mix(in srgb, currentColor 45%, transparent);
  border-radius: var(--radius-sm);
}
</style>
