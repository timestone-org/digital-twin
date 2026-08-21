<script setup lang="ts">
/**
 * @fileoverview 大纲实体段的段头：降档标题 + 计数 + hover 显现的「+ / ⋯」，
 * sticky 钉在搜索框下沿。parts 段没有独立「+」，新增/批量建并进「⋯」菜单。
 */
import type { DtMenuItem } from '@dt/contracts'
import { DtButton, DtDropdownMenu, DtIcon } from '@dt/ui'
import { computed } from 'vue'

import { outlineSectionMenu } from '../scripts/outlineMenus'
import { OUTLINE_ACT_HIDDEN } from '../scripts/outlineStyles'
import type { TwinTextSlices } from '../scripts/outlineFilter'
import type { TwinEntityKind } from '../scripts/types'

const props = defineProps<{
  kind: TwinEntityKind
  title: string
  /** 标题的高亮切片；null = 没命中。 */
  slices: TwinTextSlices | null
  /** 计数文案：总数，搜索态是「命中/总数」。 */
  countText: string
  collapsed: boolean
}>()

const emit = defineEmits<{
  toggle: []
  add: []
  bulkAdd: []
  folderNew: []
}>()

const menu = computed(() => outlineSectionMenu(props.kind, props.title))

function onMenu(item: DtMenuItem): void {
  if (item.value === 'add') emit('add')
  else if (item.value === 'bulk-add') emit('bulkAdd')
  else if (item.value === 'folder-new') emit('folderNew')
}
</script>

<template>
  <!-- ⚠ 不透明底 bg-surface-base：surface-raised 是半透明的，sticky 时会透出下面的行 -->
  <div
    class="group sticky top-10 z-10 flex items-center gap-1 bg-surface-base px-1"
    data-test="outline-section"
    :data-key="kind"
  >
    <button
      type="button"
      class="flex min-w-0 flex-1 items-center gap-1.5 py-1 text-left text-2xs font-medium tracking-wider text-text-disabled hover:text-text-secondary"
      :aria-expanded="!collapsed"
      :aria-label="`展开或折叠${title}`"
      @click="emit('toggle')"
    >
      <DtIcon
        :name="collapsed ? 'chevron-right' : 'chevron-down'"
        :size="12"
        class="shrink-0"
      />
      <span class="truncate">
        <template v-if="slices !== null"
          >{{ slices.before
          }}<mark class="rounded-[2px] bg-accent-primary/25 text-inherit">{{
            slices.match
          }}</mark
          >{{ slices.after }}</template
        >
        <template v-else>{{ title }}</template>
      </span>
      <span class="text-3xs" data-test="section-count">{{ countText }}</span>
    </button>
    <DtButton
      v-if="kind !== 'parts'"
      size="xs"
      variant="ghost"
      intent="neutral"
      icon="plus"
      :class="OUTLINE_ACT_HIDDEN"
      :aria-label="`新增${title}`"
      data-test="section-add"
      @click="emit('add')"
    />
    <DtDropdownMenu :items="menu" :label="`${title}的段操作`" @select="onMenu">
      <template #trigger="{ toggle, isOpen }">
        <DtButton
          size="xs"
          variant="ghost"
          intent="neutral"
          icon="more-horizontal"
          :class="isOpen ? '' : OUTLINE_ACT_HIDDEN"
          :aria-label="`${title}的段操作`"
          aria-haspopup="menu"
          :aria-expanded="isOpen"
          data-test="section-menu"
          @click="toggle"
        />
      </template>
    </DtDropdownMenu>
  </div>
</template>
