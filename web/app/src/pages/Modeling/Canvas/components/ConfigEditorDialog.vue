<script setup lang="ts">
/** @fileoverview 算子配置弹窗，保留字段草稿状态与关闭语义。 */
import type { ModelingGraphNode, ModelingOperator } from '@dt/contracts'
import { DtModal } from '@dt/ui'

import type { ConfigStatus } from '../scripts/configValues'
import type { FormField, FormOptions } from '../scripts/schemaForm'

import ConfigForm from './ConfigForm.vue'
import BdmSourceConfigForm from './BdmSourceConfigForm.vue'

const props = defineProps<{
  node: ModelingGraphNode | null
  operator: ModelingOperator | undefined
  fields: readonly FormField[]
  options: FormOptions
  isReadonly: boolean
}>()
const emit = defineEmits<{
  change: [key: string, value: unknown]
  status: [value: ConfigStatus]
  reloadTables: []
  close: []
}>()
</script>

<template>
  <DtModal
    :model-value="props.node !== null"
    :title="props.operator?.name ?? '参数'"
    :description="props.operator?.description"
    :width="props.operator?.code === 'bdm_source' ? '72rem' : '48rem'"
    @update:model-value="emit('close')"
  >
    <BdmSourceConfigForm
      v-if="props.node && props.operator?.code === 'bdm_source'"
      :key="props.node.id"
      :fields="props.fields"
      :config="props.node.config"
      :options="props.options"
      :is-readonly="props.isReadonly"
      @change="(key, value) => emit('change', key, value)"
      @status="emit('status', $event)"
    />
    <ConfigForm
      v-else-if="props.node"
      :key="props.node.id"
      class="dt-ml-dialog-form"
      :fields="props.fields"
      :config="props.node.config"
      :options="props.options"
      :is-readonly="props.isReadonly"
      @change="(key, value) => emit('change', key, value)"
      @status="emit('status', $event)"
      @reload-tables="emit('reloadTables')"
    />
  </DtModal>
</template>

<style scoped lang="scss">
.dt-ml-dialog-form.dt-ml-form {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 18rem), 1fr));
  align-items: start;
  gap: 16px;

  :deep(.dt-ml-form__row) {
    min-width: 0;
  }

  :deep(
    .dt-ml-form__row:not([data-widget='number']):not(
        [data-widget='integer']
      ):not([data-widget='select']):not([data-widget='switch'])
  ) {
    grid-column: 1 / -1;
  }
}
</style>
