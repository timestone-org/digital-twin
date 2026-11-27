<script setup lang="ts">
/** @fileoverview 登记模型在知识库对话中使用的默认思考强度。 */
import type { KnowledgeReasoningEffort } from '@dt/contracts'
import { DtSelect } from '@dt/ui'

const effort = defineModel<KnowledgeReasoningEffort | null | undefined>()
const options = [
  { value: 'inherit', label: '继承供应商设置' },
  { value: 'low', label: '低' },
  { value: 'medium', label: '中' },
  { value: 'high', label: '高' },
] as const

function update(value: string): void {
  const selected = options.find((one) => one.value === value)
  if (selected)
    effort.value = selected.value === 'inherit' ? null : selected.value
}
</script>

<template>
  <DtSelect
    label="知识库默认思考强度"
    size="sm"
    :model-value="effort ?? 'inherit'"
    :options="options"
    @update:model-value="update"
  />
</template>
