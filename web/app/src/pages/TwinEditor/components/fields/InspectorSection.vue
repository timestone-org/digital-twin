<script setup lang="ts">
/**
 * @fileoverview 检查器里的一节：一个小标题加一组字段，可折叠。
 * 八种检查器共用同一个外壳，免得每种自己画一套标题、深浅与间距。
 */
import { DtIcon } from '@dt/ui'
import { ref } from 'vue'

const props = defineProps<{
  title: string
  /** 初始是否展开，缺省展开。 */
  collapsed?: boolean
}>()

// ⚠ 只取一次当初值，之后由用户点开点合：这是刻意的「非响应式」，
//   props 后来变了也不该把用户手动展开的一节合回去
function initiallyOpen(): boolean {
  return props.collapsed !== true
}

const open = ref(initiallyOpen())
</script>

<template>
  <section class="border-b border-border-subtle last:border-b-0">
    <button
      type="button"
      class="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs font-medium text-text-secondary hover:text-text-primary"
      :aria-expanded="open"
      @click="open = !open"
    >
      <span>{{ title }}</span>
      <DtIcon :name="open ? 'chevron-down' : 'chevron-right'" :size="14" />
    </button>
    <div v-if="open" class="flex flex-col gap-3 px-3 pb-3">
      <slot />
    </div>
  </section>
</template>
