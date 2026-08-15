<script setup lang="ts">
/**
 * @fileoverview 检查器里的一节：一个小标题加一组字段，可折叠。
 * 八种检查器共用同一个外壳，免得每种自己画一套标题、深浅与间距。
 */
import { DtIcon } from '@dt/ui'
import { computed } from 'vue'

import { isSectionOpen, setSectionOpen } from '../../sectionCollapse'

const props = defineProps<{
  title: string
  /** 用户没点过这一节时的初值，缺省展开。 */
  collapsed?: boolean
}>()

// 折叠态存在页面级记忆里：切换选中实体会重挂本组件，存组件内就每次都复位，
// 配二十个部件要展开二十次同一节
const open = computed(() =>
  isSectionOpen(props.title, props.collapsed !== true),
)

function toggle(): void {
  setSectionOpen(props.title, !open.value)
}
</script>

<template>
  <section class="border-b border-border-subtle last:border-b-0">
    <button
      type="button"
      class="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs font-medium text-text-secondary hover:text-text-primary"
      :aria-expanded="open"
      @click="toggle"
    >
      <span>{{ title }}</span>
      <DtIcon :name="open ? 'chevron-down' : 'chevron-right'" :size="14" />
    </button>
    <div v-if="open" class="flex flex-col gap-3 px-3 pb-3">
      <slot />
    </div>
  </section>
</template>
