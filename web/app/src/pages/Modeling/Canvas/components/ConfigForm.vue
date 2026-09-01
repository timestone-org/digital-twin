<script setup lang="ts">
/**
 * @fileoverview 由算子 schema 驱动的参数表单。
 *
 * 新增算子**不用改这里**：控件由 `x-dt-widget` 与 JSON Schema 的类型推出来
 * （MODELING_DESIGN §9.3）。
 */
import {
  DtCheckbox,
  DtField,
  DtInput,
  DtNumberInput,
  DtSelect,
  DtSwitch,
} from '@dt/ui'

import type { FormField } from '../scripts/schemaForm'

const props = defineProps<{
  fields: readonly FormField[]
  config: Record<string, unknown>
  columns: readonly string[]
  tables: readonly { code: string; name: string }[]
  isReadonly: boolean
}>()

const emit = defineEmits<{
  change: [key: string, value: unknown]
}>()

function textOf(key: string): string {
  const value = props.config[key]
  return typeof value === 'string' ? value : ''
}

function numberOf(key: string): number | undefined {
  const value = props.config[key]
  return typeof value === 'number' ? value : undefined
}

function boolOf(key: string): boolean {
  return props.config[key] === true
}

function listOf(key: string): readonly string[] {
  const value = props.config[key]
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string')
}

function rangeOf(field: FormField): {
  min?: number
  max?: number
  step?: number
} {
  return {
    ...(field.min === null ? {} : { min: field.min }),
    ...(field.max === null ? {} : { max: field.max }),
    ...(field.widget === 'integer' ? { step: 1 } : {}),
  }
}

/** 台账下拉的选项。编码即值，名字用来认。 */
function tableOptions(): readonly { value: string; label: string }[] {
  return props.tables.map((item) => ({
    value: item.code,
    label: `${item.name}（${item.code}）`,
  }))
}

/** 勾选一列或取消一列。**保持 schema 里那份顺序**，不按点击先后排。 */
function toggleColumn(key: string, column: string, isOn: boolean): void {
  const current = new Set(listOf(key))
  if (isOn) current.add(column)
  else current.delete(column)
  emit(
    'change',
    key,
    props.columns.filter((item) => current.has(item)),
  )
}
</script>

<template>
  <div class="dt-ml-form">
    <template v-for="field in props.fields" :key="field.key">
      <DtSelect
        v-if="field.widget === 'select'"
        :model-value="textOf(field.key)"
        :options="field.options"
        :label="field.label"
        :hint="field.hint"
        :required="field.isRequired"
        :disabled="props.isReadonly"
        @update:model-value="emit('change', field.key, $event)"
      />
      <DtSelect
        v-else-if="field.widget === 'table'"
        :model-value="textOf(field.key)"
        :options="tableOptions()"
        :label="field.label"
        :hint="field.hint"
        :required="field.isRequired"
        :disabled="props.isReadonly"
        @update:model-value="emit('change', field.key, $event)"
      />
      <DtNumberInput
        v-else-if="field.widget === 'number' || field.widget === 'integer'"
        :model-value="numberOf(field.key)"
        :range="rangeOf(field)"
        :label="field.label"
        :hint="field.hint"
        :required="field.isRequired"
        :disabled="props.isReadonly"
        @update:model-value="emit('change', field.key, $event)"
      />
      <DtField v-else-if="field.widget === 'switch'" :hint="field.hint">
        <DtSwitch
          :model-value="boolOf(field.key)"
          :label="field.label"
          :disabled="props.isReadonly"
          @update:model-value="emit('change', field.key, $event)"
        />
      </DtField>
      <DtField
        v-else-if="field.widget === 'columns'"
        :label="field.label"
        :hint="field.hint"
      >
        <p v-if="props.columns.length === 0" class="dt-ml-form__empty">
          先在上游选好台账，这里才会列出可用的列
        </p>
        <div v-else class="dt-ml-form__columns">
          <DtCheckbox
            v-for="column in props.columns"
            :key="column"
            :model-value="listOf(field.key).includes(column)"
            :label="column"
            :disabled="props.isReadonly"
            @update:model-value="toggleColumn(field.key, column, $event)"
          />
        </div>
      </DtField>
      <DtInput
        v-else
        :model-value="textOf(field.key)"
        :label="field.label"
        :hint="field.hint"
        :required="field.isRequired"
        :disabled="props.isReadonly"
        @update:model-value="emit('change', field.key, $event)"
      />
    </template>
  </div>
</template>

<style scoped lang="scss">
.dt-ml-form {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;

  &__columns {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    max-height: 12rem;
    overflow-y: auto;
  }

  &__empty {
    margin: 0;
    color: var(--text-disabled);
    font-size: var(--ctl-hint-fs-sm);
  }
}
</style>
