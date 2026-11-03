<script setup lang="ts">
/** @fileoverview 流水线列表的进入、导出与设计管理操作。 */
import type { ModelingPipelineSummary } from '@dt/contracts'
import { PERMISSION_CODES } from '@dt/contracts'
import { DtButton, DtIconButton } from '@dt/ui'
import PermGuard from '@/components/PermGuard.vue'

defineProps<{
  row: ModelingPipelineSummary
  isSaving: boolean
  exportingId: string | null
}>()
const emit = defineEmits<{
  open: [row: ModelingPipelineSummary]
  export: [row: ModelingPipelineSummary]
  copy: [row: ModelingPipelineSummary]
  edit: [row: ModelingPipelineSummary]
  remove: [row: ModelingPipelineSummary]
}>()
</script>

<template>
  <div class="pipeline-actions">
    <PermGuard :codes="[PERMISSION_CODES.modelingManage]">
      <DtIconButton
        variant="ghost"
        size="sm"
        icon="download"
        label="导出已保存的流水线 JSON"
        :disabled="exportingId !== null"
        :loading="exportingId === row.id"
        @click="emit('export', row)"
      />
    </PermGuard>
    <DtButton
      variant="soft"
      size="sm"
      icon="workflow"
      @click="emit('open', row)"
      >打开流程图</DtButton
    >
    <PermGuard :codes="[PERMISSION_CODES.modelingManage]">
      <DtIconButton
        variant="ghost"
        size="sm"
        icon="copy"
        label="复制流水线"
        :disabled="isSaving"
        @click="emit('copy', row)"
      />
      <DtIconButton
        variant="ghost"
        size="sm"
        icon="pencil"
        label="编辑信息"
        @click="emit('edit', row)"
      />
      <DtIconButton
        variant="ghost"
        size="sm"
        icon="trash"
        label="删除流水线"
        @click="emit('remove', row)"
      />
    </PermGuard>
  </div>
</template>

<style scoped lang="scss">
.pipeline-actions {
  display: flex;
  gap: 0.25rem;
  justify-content: flex-end;
}
</style>
