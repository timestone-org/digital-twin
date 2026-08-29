<script setup lang="ts">
/**
 * @fileoverview 一个格：格外壳 + 部件的纵向流。它**不认识任何一个具体部件**——
 * 逐条交给装配点，加一种部件不必碰这里。
 *
 * ⚠ 格自己不判「有没有值」：那是各部件的事（读数画占位符、进度条整件不画），
 * 在这里统一判的话，一个只摆了名称与分隔线的格会因为没接槽而整格消失。
 */
import { computed, type CSSProperties } from 'vue'

import CardPartRenderer from '../../cardParts/CardPartRenderer.vue'
import type { CardCellView, CardPartMeta } from '../../cardParts/types'
import type { CardPartRow } from './cells'

const props = defineProps<{
  cell: CardCellView
  meta: CardPartMeta
  parts: readonly CardPartRow[]
  /** 格外壳档与格内对齐，由卡片统一下发。 */
  shell: string
  align: string
  /** 部件之间的间距，以及格自己的内边距。 */
  vars: CSSProperties
  /** 这一格点了上抛什么；空串 = 不上抛，也就不该有可点的手感。 */
  emitValue: string
}>()

const emit = defineEmits<{ pick: [value: string] }>()

const isPickable = computed(() => props.emitValue !== '')

/**
 * ⚠ `.stop`：整块可点由宿主接管，不吞掉的话同一次点击会被兜底再抛一次，
 * toggle 类联动动作当场自我抵消。
 */
function onPick(): void {
  if (isPickable.value) emit('pick', props.emitValue)
}
</script>

<template>
  <div
    class="dc-cell"
    :class="[
      `dc-cell--${shell}`,
      `dc-cell--${align}`,
      { 'dc-cell--pick': isPickable },
    ]"
    :style="vars"
    @click.stop="onPick"
  >
    <CardPartRenderer
      v-for="(row, index) in parts"
      :key="`${row.kind}-${String(index)}`"
      :kind="row.kind"
      :row="row"
      :cell="cell"
      :meta="meta"
    />
  </div>
</template>

<style scoped>
.dc-cell {
  display: flex;
  flex-direction: column;
  gap: var(--dc-part-gap, 4px);
  min-width: 0;
  padding: var(--dc-cell-py, 8px) var(--dc-cell-px, 12px);
}

.dc-cell--start {
  align-items: flex-start;
  text-align: left;
}

.dc-cell--center {
  align-items: center;
  text-align: center;
}

.dc-cell--end {
  align-items: flex-end;
  text-align: right;
}

/* 描边小卡：格自己成为一张卡，与整块的卡片框是两层 */
.dc-cell--card,
.dc-cell--accent {
  border: 1px solid var(--card-border, var(--border-subtle));
  border-radius: var(--radius-sm);
  background: var(--surface-raised);
}

.dc-cell--accent {
  border-left: 3px solid var(--accent-primary);
}

.dc-cell--pick {
  cursor: pointer;
}
</style>
