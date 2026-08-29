<script setup lang="ts">
/**
 * @fileoverview 左栏的一行：名字 + 一句话，内置的挂一枚锁形角标。
 * ⚠ 删除只对用户样式开：内置的删了下次进来照旧在，等于按钮说谎。
 */
import { DtButton, DtIcon } from '@dt/ui'

import type { LibraryEntry } from '../scripts/libraryEntries'

defineProps<{ entry: LibraryEntry; active: boolean }>()

const emit = defineEmits<{ select: []; remove: [] }>()
</script>

<template>
  <div
    class="dt-style-row group flex items-center gap-2 rounded px-2 py-1.5"
    :class="{ 'dt-style-row--active': active }"
  >
    <button
      type="button"
      class="min-w-0 flex-1 text-left"
      :data-test="`style-${entry.key}`"
      @click="emit('select')"
    >
      <span class="flex items-center gap-1.5">
        <DtIcon
          v-if="entry.savedId === null"
          name="lock"
          :size="11"
          class="shrink-0 text-[var(--text-secondary)]"
        />
        <span class="truncate text-[13px]">{{ entry.label }}</span>
      </span>
      <span
        v-if="entry.hint !== ''"
        class="mt-0.5 block truncate text-[11px] text-[var(--text-secondary)]"
      >
        {{ entry.hint }}
      </span>
    </button>
    <DtButton
      v-if="entry.savedId !== null"
      variant="ghost"
      intent="danger"
      size="xs"
      icon="trash"
      aria-label="删除样式"
      class="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
      @click="emit('remove')"
    />
  </div>
</template>

<style scoped>
.dt-style-row {
  border: 1px solid transparent;
}

.dt-style-row:hover {
  background: var(--surface-raised);
}

.dt-style-row--active {
  background: var(--surface-raised);
  border-color: var(--accent-primary);
}
</style>
