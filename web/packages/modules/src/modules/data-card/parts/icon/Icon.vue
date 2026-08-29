<script setup lang="ts">
/**
 * @fileoverview 图标的画法：格上配的优先，没有则用部件上的回落。
 * ⚠ 两处都没有时整件不画：画一个空框会让一排卡片里没配图标的那几格看着像加载失败。
 */
import { computed, type CSSProperties } from 'vue'

import type { CardPartProps } from '../../../../cardParts/types'
import { resolveImageValue } from '../../../../shared/assetImage'
import { readEnum, readNumber, readText } from '../../../../shared/config'

// ⚠ 三件套一个都不能少：没声明的那个会掉成透传属性，在 DOM 上留下
//   `meta="[object Object]"` 这种脏东西，而两侧都不报错
const props = defineProps<CardPartProps>()

const SHAPES = ['none', 'circle', 'square'] as const

/** 格上配的优先；`cell.icon` 已在归一时解析过，部件上那个要在这里解析。 */
const src = computed(() =>
  props.cell.icon === ''
    ? resolveImageValue(readText(props.part.fallback).trim())
    : props.cell.icon,
)

const shape = computed(() => readEnum(props.part.shape, SHAPES, 'none'))

const style = computed<CSSProperties>(() => {
  const size = `${String(readNumber(props.part.size, 20))}px`
  return { width: size, height: size }
})
</script>

<template>
  <span
    v-if="src !== ''"
    class="dc-icon"
    :class="`dc-icon--${shape}`"
    :style="style"
  >
    <img class="dc-icon__img" :src="src" alt="" />
  </span>
</template>

<style scoped>
.dc-icon {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
}

.dc-icon__img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

/* 底衬：图标缩到八成，余下的边距让底衬看得出来 */
.dc-icon--circle,
.dc-icon--square {
  padding: 10%;
  background: color-mix(in srgb, var(--accent-primary) 14%, transparent);
}

.dc-icon--circle {
  border-radius: 50%;
}

.dc-icon--square {
  border-radius: var(--radius-sm);
}
</style>
