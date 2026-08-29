<script setup lang="ts">
/**
 * @fileoverview 分隔线部件的画法：一道线，或只留一段空。
 * ⚠ 「只留空」那一档仍然渲染一个元素：它是排布出问题时唯一还看得见的参照物，
 * 而 `v-if` 掉的话「我加了间隔但没反应」查不出来自哪一件。
 */
import { computed, type CSSProperties } from 'vue'

import type { CardPartProps } from '../../../../cardParts/types'
import { readEnum, readNumber, readText } from '../../../../shared/config'

// ⚠ 三件套一个都不能少：没声明的那个会掉成透传属性，在 DOM 上留下
//   `meta="[object Object]"` 这种脏东西，而两侧都不报错
const props = defineProps<CardPartProps>()

const LOOKS = ['line', 'dashed', 'blank'] as const

const look = computed(() => readEnum(props.part.look, LOOKS, 'line'))

const style = computed<CSSProperties>(() => {
  const gap = `${String(readNumber(props.part.gap, 6))}px`
  const color = readText(props.part.color)
  return {
    marginTop: gap,
    marginBottom: gap,
    // 「没配 = 不写值」：写了就再也回落不到卡片边框色
    ...(color === '' ? {} : { borderColor: color }),
  }
})
</script>

<template>
  <hr
    v-if="look !== 'blank'"
    class="dc-rule"
    :class="`dc-rule--${look}`"
    :style="style"
  />
  <span
    v-else
    class="dc-rule dc-rule--blank"
    :style="style"
    aria-hidden="true"
  />
</template>

<style scoped>
.dc-rule {
  display: block;
  width: 100%;
  margin-right: 0;
  margin-left: 0;
  border: 0;
  border-top: 1px solid var(--card-border, var(--border-subtle));
}

.dc-rule--dashed {
  border-top-style: dashed;
}

.dc-rule--blank {
  border-top-color: transparent;
}
</style>
