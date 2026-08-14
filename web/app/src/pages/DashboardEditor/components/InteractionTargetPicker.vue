<script setup lang="ts">
/**
 * @fileoverview 联动目标多选：画布上每个节点一行勾选框，勾中即进目标表。
 * 顺序按勾选先后追加，取消勾选只摘自己那一项。
 */
import type { DtSelectOption } from '@dt/contracts'
import { DtCheckbox, DtField } from '@dt/ui'

const props = defineProps<{
  label: string
  targets: readonly string[]
  options: readonly DtSelectOption[]
}>()

const emit = defineEmits<{ 'update:targets': [targets: string[]] }>()

function isPicked(nodeId: string): boolean {
  return props.targets.includes(nodeId)
}

function onToggle(nodeId: string, picked: boolean): void {
  const rest = props.targets.filter((id) => id !== nodeId)
  emit('update:targets', picked ? [...rest, nodeId] : rest)
}
</script>

<template>
  <DtField :label="label" size="sm">
    <div class="flex max-h-40 flex-col gap-1 overflow-y-auto">
      <DtCheckbox
        v-for="option in options"
        :key="option.value"
        :model-value="isPicked(option.value)"
        :label="option.label"
        :data-test="`ix-target-${option.value}`"
        @update:model-value="onToggle(option.value, $event)"
      />
    </div>
  </DtField>
</template>
