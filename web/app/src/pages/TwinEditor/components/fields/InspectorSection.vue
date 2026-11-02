<script setup lang="ts">
/**
 * @fileoverview 检查器里的一节：一个小标题加一组字段，可折叠。
 * 八种检查器共用同一个外壳，免得每种自己画一套标题、深浅与间距。
 */
import { DtDisclosure } from '@dt/ui'
import { computed } from 'vue'

import { isSectionOpen, setSectionOpen } from '../../scripts/sectionCollapse'

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
</script>

<template>
  <DtDisclosure
    :title="title"
    :open="open"
    unmount-on-close
    @update:open="setSectionOpen(title, $event)"
  >
    <slot />
  </DtDisclosure>
</template>
