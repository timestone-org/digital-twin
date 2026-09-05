<script setup lang="ts">
/**
 * @fileoverview 挂在一块上的那几句话的画法：告警整条摆出来，口径说明一行灰字。
 *
 * ⚠ 两档不合并（规格 §11 的 R-24）：`alert` 是会让人**读出错误结论**的那一句，
 * 一行灰字在一屏数字里会被略过；`hint` 只是口径说明，铺成告警会把版面撑满。
 */
import { computed } from 'vue'

import { notesOf, sortedNotes } from '../scripts/blockNotes'

const props = defineProps<{ payload: Record<string, unknown> }>()

const notes = computed(() => sortedNotes(notesOf(props.payload)))
</script>

<template>
  <ul v-if="notes.length > 0" class="dt-ml-notes">
    <li
      v-for="one in notes"
      :key="one.text"
      :class="`dt-ml-notes__item--${one.level}`"
    >
      {{ one.text }}
    </li>
  </ul>
</template>

<style scoped lang="scss">
.dt-ml-notes {
  margin: 0;
  padding-left: 1.1rem;
  color: var(--text-secondary);
  font-size: var(--ctl-hint-fs-sm);
  line-height: 1.6;

  // 会让人读出错误结论的那一句自己带底与边
  &__item--alert {
    padding: 0.125rem 0.375rem;
    border-left: 3px solid rgba(var(--state-warning-rgb), 0.7);
    background: rgba(var(--state-warning-rgb), 0.08);
    color: var(--text-primary);
    list-style: none;
  }
}
</style>
