<script setup lang="ts">
/** @fileoverview 按列配置聚合方式；未配置的列沿用算子的默认口径。 */
import type { DtSelectOption } from '@dt/contracts'
import { DtField, DtInput, DtSelect } from '@dt/ui'
import { computed, ref } from 'vue'

const props = defineProps<{
  modelValue: unknown
  columns: readonly { key: string; name: string }[]
  options: readonly DtSelectOption[]
  label: string
  note: string
  isReadonly: boolean
}>()
const emit = defineEmits<{
  'update:modelValue': [value: Record<string, string>]
}>()
const keyword = ref('')

const configured = computed<Record<string, string>>(() => {
  const value = props.modelValue
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return {}
  const entries: [string, unknown][] = Object.entries(value)
  const rules: Record<string, string> = {}
  for (const [key, method] of entries) {
    if (typeof method === 'string') rules[key] = method
  }
  return rules
})
const methods = computed(() => [
  { value: '', label: '沿用默认' },
  ...props.options,
])
const rows = computed(() => {
  const known = new Set(props.columns.map((column) => column.key))
  const missing = Object.keys(configured.value)
    .filter((key) => !known.has(key))
    .map((key) => ({ key, name: `${key}（上游没有这一列）` }))
  const needle = keyword.value.trim().toLowerCase()
  return [...props.columns, ...missing].filter((column) =>
    `${column.name} ${column.key}`.toLowerCase().includes(needle),
  )
})

function change(key: string, value: string): void {
  if (props.isReadonly) return
  const next = { ...configured.value }
  if (value === '') delete next[key]
  else next[key] = value
  emit('update:modelValue', next)
}
</script>

<template>
  <DtField
    :label="props.label"
    hint="未单独配置的列沿用默认汇总方式。计数不去重。"
  >
    <div class="dt-ml-aggregations">
      <DtInput
        v-model="keyword"
        label="搜索汇总列"
        placeholder="按名称或列名搜索"
        size="sm"
      />
      <DtSelect
        v-for="column in rows"
        :key="column.key"
        :model-value="configured[column.key] ?? ''"
        :label="column.name || column.key"
        :options="methods"
        :disabled="props.isReadonly"
        @update:model-value="change(column.key, $event)"
      />
      <p v-if="rows.length === 0" class="dt-ml-aggregations__note">
        {{ keyword ? '没有匹配的列' : props.note || '上游没有可配置的列' }}
      </p>
    </div>
  </DtField>
</template>

<style scoped lang="scss">
.dt-ml-aggregations {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;

  &__note {
    margin: 0;
    color: var(--text-secondary);
    font-size: var(--ctl-hint-fs-sm);
  }
}
</style>
