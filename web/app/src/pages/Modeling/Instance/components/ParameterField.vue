<script setup lang="ts">
/** @fileoverview 一个参数字段的类型控件与复杂 JSON 校验。 */
import { DtInput, DtNumberInput, DtSelect, DtSwitch, DtTextarea } from '@dt/ui'
import { computed, ref, watch } from 'vue'
import type { ParameterField } from '../scripts/parameters'
const props = defineProps<{
  field: ParameterField
  value: unknown
  disabled: boolean
}>()
const emit = defineEmits<{
  change: [value: unknown]
  error: [message: string]
}>()
const draft = ref('')
const error = ref('')
watch(
  () => JSON.stringify(props.value),
  () => {
    draft.value = JSON.stringify(props.value ?? null, null, 2)
    error.value = ''
    emit('error', '')
  },
  { immediate: true },
)
const text = computed(() =>
  typeof props.value === 'string' ? props.value : '',
)
const number = computed(() =>
  typeof props.value === 'number' ? props.value : undefined,
)
function updateJson(value: string): void {
  draft.value = value
  try {
    const parsed: unknown = JSON.parse(value)
    error.value = ''
    emit('error', '')
    emit('change', parsed)
  } catch {
    error.value = 'JSON 格式不完整'
    emit('error', `${props.field.label}：JSON 格式不完整`)
  }
}
</script>
<template>
  <DtInput
    v-if="field.kind === 'string'"
    :model-value="text"
    :label="field.label"
    :hint="field.hint"
    :required="field.required"
    :disabled="disabled"
    @update:model-value="emit('change', $event)"
  />

  <DtNumberInput
    v-else-if="field.kind === 'number'"
    :model-value="number"
    :label="field.label"
    :hint="field.hint"
    :disabled="disabled"
    @update:model-value="emit('change', $event ?? null)"
  />

  <DtSwitch
    v-else-if="field.kind === 'boolean'"
    :model-value="value === true"
    :label="field.label"
    :disabled="disabled"
    @update:model-value="emit('change', $event)"
  />

  <DtSelect
    v-else-if="field.kind === 'select'"
    :model-value="text"
    :options="field.options"
    :label="field.label"
    :hint="field.hint"
    :disabled="disabled"
    @update:model-value="emit('change', $event)"
  />

  <DtTextarea
    v-else
    :model-value="draft"
    :label="field.label"
    :hint="field.hint || '填写 JSON 数组或对象，字段格式遵循模板 Schema。'"
    :rows="5"
    :error="error"
    :disabled="disabled"
    @update:model-value="updateJson"
  />
</template>
