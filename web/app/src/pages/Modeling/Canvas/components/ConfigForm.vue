<script setup lang="ts">
/** @fileoverview 画布配置表单与能管标识专用选择器适配。 */
import SharedConfigForm from '@/features/modeling-config/components/ConfigForm.vue'
import type {
  FormField,
  FormOptions,
} from '@/features/modeling-config/scripts/schemaForm'
import type { ConfigStatus } from '@/features/modeling-config/scripts/configValues'
import BdmIdentifierPicker from './BdmIdentifierPicker.vue'
const props = defineProps<{
  fields: readonly FormField[]
  config: Record<string, unknown>
  options: FormOptions
  isReadonly: boolean
}>()
const emit = defineEmits<{
  change: [key: string, value: unknown]
  status: [value: ConfigStatus]
  reloadTables: []
}>()
</script>
<template>
  <SharedConfigForm
    :fields="props.fields"
    :config="props.config"
    :options="props.options"
    :is-readonly="props.isReadonly"
    @change="(key, value) => emit('change', key, value)"
    @status="emit('status', $event)"
    @reload-tables="emit('reloadTables')"
  >
    <template #bdm-identifiers="slot">
      <BdmIdentifierPicker
        :field="slot.field"
        :kind="props.config['kind']"
        :model-value="slot.value"
        :is-readonly="props.isReadonly"
        @update:model-value="slot.change(slot.field.key, $event)"
        @status="slot.status(slot.field.key, $event)"
      />
    </template>
  </SharedConfigForm>
</template>
