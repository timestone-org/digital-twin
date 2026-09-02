<script setup lang="ts">
/**
 * @fileoverview 由算子 schema 驱动的参数表单。
 *
 * 新增算子**不用改这里**：控件由 `x-dt-widget` 与 JSON Schema 的类型推出来
 * （MODELING_DESIGN §9.3）。
 * ⚠ 每一项都能一键回到默认值：schema 里给了默认的字段，改坏之后用户没有别的
 * 路能确认「原来是多少」——而参数写歪的表现往往是模型指标莫名其妙地差。
 */
import { DtField, DtInput, DtNumberInput, DtSelect, DtSwitch } from '@dt/ui'

import type { FormField, FormOptions } from '../scripts/schemaForm'
import { isDefault, missingHint } from '../scripts/schemaForm'

import ColumnPicker from './ColumnPicker.vue'
import MomentInput from './MomentInput.vue'

const props = defineProps<{
  fields: readonly FormField[]
  config: Record<string, unknown>
  options: FormOptions
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
  return props.options.tables.map((item) => ({
    value: item.code,
    label: `${item.name}（${item.code}）`,
  }))
}

/** 这一项现在偏离默认值了吗——偏离了才给「恢复默认」。 */
function canReset(field: FormField): boolean {
  if (props.isReadonly || field.fallback === undefined) return false
  return !isDefault(field, props.config[field.key])
}

/** 这一项的提示语：必填没填时说出来，否则用 schema 的说明。 */
function hintOf(field: FormField): string {
  return missingHint(field, props.config[field.key]) || field.hint
}

function errorOf(field: FormField): string {
  return missingHint(field, props.config[field.key])
}
</script>

<template>
  <div class="dt-ml-form">
    <div v-for="field in props.fields" :key="field.key" class="dt-ml-form__row">
      <MomentInput
        v-if="field.widget === 'moment'"
        :model-value="textOf(field.key)"
        :label="field.label"
        :hint="field.hint"
        :is-readonly="props.isReadonly"
        @update:model-value="emit('change', field.key, $event)"
      />
      <ColumnPicker
        v-else-if="field.widget === 'columns'"
        :model-value="listOf(field.key)"
        :columns="props.options.columns"
        :label="field.label"
        :hint="field.hint"
        :note="props.options.columnsNote"
        :is-readonly="props.isReadonly"
        @update:model-value="emit('change', field.key, $event)"
      />
      <DtSelect
        v-else-if="field.widget === 'table' && tableOptions().length > 0"
        :model-value="textOf(field.key)"
        :options="tableOptions()"
        :label="field.label"
        :hint="hintOf(field)"
        :error="errorOf(field)"
        :required="field.isRequired"
        :disabled="props.isReadonly"
        @update:model-value="emit('change', field.key, $event)"
      />
      <DtSelect
        v-else-if="field.widget === 'select'"
        :model-value="textOf(field.key)"
        :options="field.options"
        :label="field.label"
        :hint="hintOf(field)"
        :error="errorOf(field)"
        :required="field.isRequired"
        :disabled="props.isReadonly"
        @update:model-value="emit('change', field.key, $event)"
      />
      <DtNumberInput
        v-else-if="field.widget === 'number' || field.widget === 'integer'"
        :model-value="numberOf(field.key)"
        :range="rangeOf(field)"
        :label="field.label"
        :hint="hintOf(field)"
        :error="errorOf(field)"
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
        v-else-if="field.widget === 'table'"
        :label="field.label"
        :hint="field.hint"
      >
        <DtInput
          :model-value="textOf(field.key)"
          placeholder="填台账编码"
          :error="errorOf(field)"
          :required="field.isRequired"
          :disabled="props.isReadonly"
          @update:model-value="emit('change', field.key, $event)"
        />
        <!-- ⚠ 这句必须**总是**看得见：空下拉读起来是「一张台账都没建」，
             而真相往往是「你看不到」，两者的处置完全不同 -->
        <p v-if="props.options.tablesNote" class="dt-ml-form__note">
          {{ props.options.tablesNote }}
        </p>
      </DtField>
      <DtInput
        v-else
        :model-value="textOf(field.key)"
        :label="field.label"
        :hint="hintOf(field)"
        :error="errorOf(field)"
        :required="field.isRequired"
        :disabled="props.isReadonly"
        @update:model-value="emit('change', field.key, $event)"
      />
      <button
        v-if="canReset(field)"
        type="button"
        class="dt-ml-form__reset"
        :title="`恢复默认：${JSON.stringify(field.fallback)}`"
        @click="emit('change', field.key, field.fallback)"
      >
        恢复默认
      </button>
    </div>
  </div>
</template>

<style scoped lang="scss">
.dt-ml-form {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;

  &__row {
    display: flex;
    gap: 0.5rem;
    align-items: flex-end;

    > :first-child {
      flex: 1;
      min-width: 0;
    }
  }

  &__note {
    margin: 0.25rem 0 0;
    color: var(--text-disabled);
    font-size: var(--ctl-hint-fs-sm);
  }

  &__reset {
    flex: none;
    height: var(--ctl-h-sm);
    padding: 0 0.5rem;
    border: 1px solid var(--border-default);
    border-radius: var(--radius-sm);
    background: var(--surface-base);
    color: var(--text-secondary);
    font-size: var(--ctl-hint-fs-sm);
    white-space: nowrap;
    cursor: pointer;

    &:hover {
      border-color: var(--border-hover);
      color: var(--text-primary);
    }
  }
}
</style>
