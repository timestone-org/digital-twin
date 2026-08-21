<script setup lang="ts">
/**
 * @fileoverview 大纲页签体内顶部的 sticky 搜索框：前置放大镜、有词时尾部出「×」，
 * 框内 Esc = 清词。
 */
import { DtIcon, DtInput } from '@dt/ui'

const props = defineProps<{
  modelValue: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

/** 框内 Esc = 清词。⚠ 拦下冒泡：页面还挂着自己的 Esc（取消拾取），清词不该连带触发它。 */
function onKeystate(event: KeyboardEvent): void {
  if (event.key !== 'Escape' || props.modelValue === '') return
  event.stopPropagation()
  emit('update:modelValue', '')
}
</script>

<template>
  <div class="sticky top-0 z-20 bg-surface-base p-1" data-test="outline-search">
    <DtInput
      size="sm"
      type="search"
      :model-value="modelValue"
      aria-label="搜索大纲"
      placeholder="搜索名称、id 或分组"
      @update:model-value="emit('update:modelValue', $event)"
      @keystate="onKeystate"
    >
      <template #leading>
        <DtIcon name="search" :size="14" />
      </template>
      <template #trailing>
        <button
          v-if="modelValue !== ''"
          type="button"
          class="flex h-4 w-4 items-center justify-center rounded-[var(--radius-sm)] text-text-disabled hover:text-text-primary"
          aria-label="清除搜索"
          data-test="outline-search-clear"
          @click="emit('update:modelValue', '')"
        >
          <DtIcon name="close" :size="12" />
        </button>
      </template>
    </DtInput>
  </div>
</template>
