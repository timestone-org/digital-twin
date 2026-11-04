<script setup lang="ts">
/** @fileoverview JSON 工作流的文件选择、兼容预检与独立导入。 */
import { DtButton, DtFilePicker, DtModal, DtNotice } from '@dt/ui'
import PipelineImportPreview from './PipelineImportPreview.vue'
import PipelineImportFields from './PipelineImportFields.vue'
import type { usePipelineTransfer } from '../scripts/usePipelineTransfer'

defineProps<{ transfer: ReturnType<typeof usePipelineTransfer> }>()
</script>

<template>
  <DtModal
    :model-value="transfer.isOpen.value"
    title="导入工作流 JSON"
    description="从其他部署迁移分析设计，创建独立工作流。"
    width="52rem"
    :dirty="transfer.fileName.value !== ''"
    :close-on-backdrop="!transfer.isSaving.value"
    @update:model-value="transfer.close"
  >
    <div class="pipeline-import">
      <DtNotice intent="info">
        文件仅包含已保存的算子、配置、连线和位置，以及算子版本清单。运行记录、模型产物与部署不在迁移范围内。
      </DtNotice>
      <div class="pipeline-import__file">
        <DtFilePicker
          label="选择 JSON 文件"
          accept=".json,application/json"
          :disabled="transfer.isSaving.value"
          @select="(files) => void transfer.select(files)"
        />
        <span>{{ transfer.fileName.value || '最大 2 MB' }}</span>
      </div>
      <DtNotice v-if="transfer.isReading.value" intent="info" role="status"
        >正在检查格式、算子兼容性和数据源引用…</DtNotice
      >
      <DtNotice v-if="transfer.error.value" intent="danger" role="alert">{{
        transfer.error.value
      }}</DtNotice>
      <PipelineImportPreview
        v-if="transfer.inspection.value"
        :inspection="transfer.inspection.value"
      />
      <PipelineImportFields
        v-if="transfer.inspection.value"
        :transfer="transfer"
      />
    </div>
    <template #footer>
      <DtButton
        variant="ghost"
        intent="neutral"
        :disabled="transfer.isSaving.value"
        @click="transfer.close"
        >取消</DtButton
      >
      <DtButton
        form="pipeline-import-form"
        type="submit"
        :disabled="!transfer.canSubmit.value"
        :loading="transfer.isSaving.value"
        >导入并进入流程图</DtButton
      >
    </template>
  </DtModal>
</template>

<style scoped lang="scss">
.pipeline-import {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  min-width: 0;
  &__file {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.75rem;
    overflow-wrap: anywhere;
    font-size: var(--font-size-caption);
    color: var(--text-secondary);
  }
}
</style>
