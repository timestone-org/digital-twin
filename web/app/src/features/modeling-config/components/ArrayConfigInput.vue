<script setup lang="ts">
/** @fileoverview 周期、统计项和滞后期数等算子列表参数的编辑器。 */
import { DtCheckbox, DtField, DtInput } from '@dt/ui'
import { computed, ref, watch } from 'vue'

import type { FormField } from '../scripts/schemaForm'
import { parseArrayConfig } from '../scripts/arrayConfig'
import { arrayError } from '../scripts/configValues'
import type { ConfigStatus } from '../scripts/configValues'

const props = defineProps<{
  field: FormField
  modelValue: unknown
  isReadonly: boolean
}>()
const emit = defineEmits<{
  'update:modelValue': [value: (string | number)[]]
  status: [value: ConfigStatus]
}>()
const values = computed<readonly unknown[]>(() =>
  Array.isArray(props.modelValue) ? props.modelValue : [],
)
const draft = ref('')
watch(
  () => JSON.stringify(props.modelValue),
  () => {
    const saved = values.value.map(String).join(', ')
    if (
      JSON.stringify(parseArrayConfig(draft.value, props.field).value) !==
      JSON.stringify(values.value)
    )
      draft.value = saved
  },
  { immediate: true },
)
const parsed = computed(() => parseArrayConfig(draft.value, props.field))
const selectionError = computed(() => arrayError(props.field, values.value))
const unknown = computed(() =>
  values.value.filter(
    (item): item is string =>
      typeof item === 'string' &&
      !props.field.options.some((option) => option.value === item),
  ),
)
const status = computed<ConfigStatus>(() => {
  if (props.isReadonly) return { message: '', hasDraft: false }
  if (props.field.widget === 'multi-select')
    return { message: selectionError.value, hasDraft: false }
  const hasDraft =
    JSON.stringify(parsed.value.value) !== JSON.stringify(values.value)
  return { message: parsed.value.error, hasDraft }
})
watch(status, (value) => emit('status', value), { immediate: true })

function input(raw: string): void {
  draft.value = raw
  if (props.isReadonly) return
  const next = parseArrayConfig(raw, props.field)
  if (next.value !== null) emit('update:modelValue', next.value)
}

function toggle(key: string, isOn: boolean): void {
  if (props.isReadonly) return
  const selected = new Set(values.value)
  if (isOn) selected.add(key)
  else selected.delete(key)
  const ordered = [
    ...props.field.options.map((option) => option.value),
    ...unknown.value,
  ]
  emit(
    'update:modelValue',
    ordered.filter((item) => selected.has(item)),
  )
}
</script>

<template>
  <DtField
    v-if="props.field.widget === 'multi-select'"
    :label="props.field.label"
    :hint="props.field.hint"
    :error="selectionError"
  >
    <div class="dt-ml-array__choices">
      <DtCheckbox
        v-for="option in props.field.options"
        :key="option.value"
        :label="option.label"
        :model-value="values.includes(option.value)"
        :disabled="props.isReadonly"
        @update:model-value="toggle(option.value, $event)"
      />
      <DtCheckbox
        v-for="value in unknown"
        :key="value"
        :label="`${value}（不在可选项中）`"
        :model-value="true"
        :disabled="props.isReadonly"
        @update:model-value="toggle(value, $event)"
      />
    </div>
  </DtField>
  <DtInput
    v-else
    :model-value="draft"
    :label="props.field.label"
    :hint="`${props.field.hint}；多项用逗号分隔`"
    :error="parsed.error"
    :disabled="props.isReadonly"
    @update:model-value="input"
  />
</template>

<style scoped lang="scss">
.dt-ml-array__choices {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}
</style>
