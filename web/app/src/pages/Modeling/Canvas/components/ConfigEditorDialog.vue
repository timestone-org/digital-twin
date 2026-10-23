<script setup lang="ts">
/** @fileoverview 算子配置弹窗，保留字段草稿状态与关闭语义。 */
import type { ModelingGraphNode, ModelingOperator } from '@dt/contracts'
import { DtModal } from '@dt/ui'

import type { ConfigStatus } from '../scripts/configValues'
import type { FormField, FormOptions } from '../scripts/schemaForm'

import ConfigForm from './ConfigForm.vue'

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
    width="34rem"
    @update:model-value="emit('close')"
  >
    <ConfigForm
      v-if="props.node"
      :key="props.node.id"
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
