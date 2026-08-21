<script setup lang="ts">
/**
 * @fileoverview 大纲置顶的「场景」区：模型与场景 / 视点切换 / 自动漫游三个单例
 * 入口，不可折叠；行尾 chevron-right 表示点开是右栏的配置页。
 */
import { DtIcon } from '@dt/ui'

import { isSameSelection } from '../scripts/types'
import type { TwinSelection } from '../scripts/types'
import type { TwinSceneEntryView } from '../scripts/outlineFilter'

const props = defineProps<{
  entries: readonly TwinSceneEntryView[]
  selection: TwinSelection | null
}>()

const emit = defineEmits<{
  select: [TwinSelection]
}>()

function isSelected(selection: TwinSelection): boolean {
  return isSameSelection(props.selection, selection)
}
</script>

<template>
  <div
    class="border-b border-border-subtle px-1 pb-1"
    data-test="outline-scene"
  >
    <p class="px-1 py-1 text-2xs font-medium tracking-wider text-text-disabled">
      场景
    </p>
    <button
      v-for="entryView in entries"
      :key="entryView.entry.key"
      type="button"
      class="flex w-full items-center gap-1.5 rounded-[var(--radius-sm)] px-2 py-1.5 text-left text-xs"
      :class="
        isSelected(entryView.entry.selection)
          ? 'bg-surface-raised text-accent-on-surface'
          : 'text-text-secondary hover:bg-surface-raised'
      "
      title="配置在右栏打开"
      data-test="outline-single"
      :data-key="entryView.entry.key"
      @click="emit('select', entryView.entry.selection)"
    >
      <DtIcon :name="entryView.entry.icon" :size="13" class="shrink-0" />
      <span class="min-w-0 flex-1 truncate">
        <template v-if="entryView.slices !== null"
          >{{ entryView.slices.before
          }}<mark class="rounded-[2px] bg-accent-primary/25 text-inherit">{{
            entryView.slices.match
          }}</mark
          >{{ entryView.slices.after }}</template
        >
        <template v-else>{{ entryView.entry.title }}</template>
      </span>
      <DtIcon
        name="chevron-right"
        :size="12"
        class="shrink-0 text-text-disabled"
      />
    </button>
  </div>
</template>
