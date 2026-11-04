<script setup lang="ts">
/** @fileoverview 创建时可选择的一版命名模板。 */
import type { ModelingTemplate } from '@dt/contracts'
import { DtButton, DtTag } from '@dt/ui'

defineProps<{
  template: ModelingTemplate
  isSelected: boolean
  isDisabled: boolean
}>()
const emit = defineEmits<{ select: [] }>()
</script>

<template>
  <article class="saved-template-card">
    <div class="saved-template-card__details">
      <strong>{{ template.name }}</strong>
      <div class="flex flex-wrap gap-2">
        <DtTag>v{{ template.version }}</DtTag>
        <DtTag>{{ template.node_count }} 个算子</DtTag>
        <DtTag v-if="!template.is_enabled">已停用</DtTag>
      </div>
      <p class="text-sm text-text-secondary">
        {{ template.description || '从已保存的工作流配置创建独立副本。' }}
      </p>
    </div>
    <DtButton
      size="sm"
      :pressed="isSelected"
      :disabled="isDisabled || !template.is_enabled"
      :aria-label="`选择模板 ${template.name} v${template.version}`"
      @click="emit('select')"
    >
      {{ isSelected ? '已选择' : '选择' }}
    </DtButton>
  </article>
</template>

<style scoped lang="scss">
.saved-template-card {
  display: flex;
  gap: 1rem;
  align-items: center;
  padding: 1rem;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  &__details {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 0.5rem;
    min-width: 0;
    overflow-wrap: anywhere;
  }
}
</style>
