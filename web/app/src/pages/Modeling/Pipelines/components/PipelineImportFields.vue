<script setup lang="ts">
/** @fileoverview 导入独立流水线时的目标名称、编码与说明。 */
import { DtInput, DtTextarea } from '@dt/ui'
import type { usePipelineTransfer } from '../scripts/usePipelineTransfer'
defineProps<{ transfer: ReturnType<typeof usePipelineTransfer> }>()
</script>

<template>
  <form
    id="pipeline-import-form"
    class="dt-form-grid"
    @submit.prevent="void transfer.submit()"
  >
    <DtInput
      :model-value="transfer.name.value"
      label="流水线名称"
      :maxlength="128"
      :disabled="transfer.isSaving.value"
      required
      @update:model-value="transfer.setName"
    />
    <DtInput
      :model-value="transfer.code.value"
      label="新流水线编码"
      :maxlength="64"
      :error="transfer.codeError.value"
      :disabled="transfer.isSaving.value"
      required
      @update:model-value="transfer.setCode"
    />
    <DtTextarea
      :model-value="transfer.description.value"
      class="dt-form-grid__wide"
      label="说明"
      :maxlength="512"
      :rows="3"
      :disabled="transfer.isSaving.value"
      @update:model-value="transfer.setDescription"
    />
  </form>
</template>
