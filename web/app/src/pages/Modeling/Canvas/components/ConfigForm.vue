<script setup lang="ts">
/**
 * @fileoverview 由算子 schema 驱动的参数表单。
 *
 * 新增算子**不用改这里**：控件由 `x-dt-widget` 与 JSON Schema 的类型推出来
 * （MODELING_DESIGN §9.3）。
 * ⚠ 每一项都能一键回到默认值：schema 里给了默认的字段，改坏之后用户没有别的
 * 路能确认「原来是多少」——而参数写歪的表现往往是模型指标莫名其妙地差。
 * ⚠ 台账一律**选**不手填：手打的编码要等运行时取数才报「找不到台账」。只有
 * 没有 `dataset:view` 拉不到清单时才退回手填，拉失败了给重试而不是手填。
 */
import type { DtSelectOption } from '@dt/contracts'
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
  /** 台账清单拉失败了，用户按了「重试」。 */
  reloadTables: []
}>()

/** 台账下拉总带搜索框：台账靠编码认，只有一张也要能敲编码定位。 */
const TABLE_DISPLAY = {
  searchable: true,
  placeholder: '选一张台账',
  searchPlaceholder: '按名称或编码搜索',
}

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

/**
 * 台账下拉的选项：清单里的每一张，外加图里存着却不在清单里的那一个。
 * 编码即值，名字用来认，两者都能搜。
 *
 * ⚠ 存着的编码不在清单里时不能空着显示「请选择」：台账可能被删了、清单可能
 * 没拉全，用户得先看见自己配的是哪一个，才谈得上换不换。
 */
function tableOptions(field: FormField): readonly DtSelectOption[] {
  const listed = props.options.tables.map((item) => ({
    value: item.code,
    label: `${item.name}（${item.code}）`,
  }))
  const current = textOf(field.key)
  if (current === '' || listed.some((item) => item.value === current)) {
    return listed
  }
  return [{ value: current, label: missingLabel(current) }, ...listed]
}

/** 清单还没回来之前先别说「没有这张」——那句话要等清单到了才算数。 */
function missingLabel(code: string): string {
  return props.options.tablesState === 'loading'
    ? code
    : `${code}（清单里没有这张台账）`
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
      <DtField
        v-else-if="
          field.widget === 'table' && props.options.tablesState === 'denied'
        "
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
        <p class="dt-ml-form__note">{{ props.options.tablesNote }}</p>
      </DtField>
      <div v-else-if="field.widget === 'table'" class="dt-ml-form__stack">
        <DtSelect
          :model-value="textOf(field.key)"
          :options="tableOptions(field)"
          :display="TABLE_DISPLAY"
          :label="field.label"
          :hint="hintOf(field)"
          :error="errorOf(field)"
          :required="field.isRequired"
          :disabled="props.isReadonly"
          @update:model-value="emit('change', field.key, $event)"
        />
        <p v-if="props.options.tablesNote" class="dt-ml-form__note">
          {{ props.options.tablesNote }}
          <button
            v-if="props.options.tablesState === 'failed'"
            type="button"
            class="dt-ml-form__reload"
            @click="emit('reloadTables')"
          >
            重试
          </button>
        </p>
      </div>
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

  &__stack {
    display: flex;
    flex-direction: column;
  }

  &__note {
    margin: 0.25rem 0 0;
    color: var(--text-disabled);
    font-size: var(--ctl-hint-fs-sm);
  }

  &__reload {
    margin-left: 0.25rem;
    padding: 0;
    border: 0;
    background: none;
    color: var(--accent-primary);
    font-size: inherit;
    cursor: pointer;

    &:hover {
      text-decoration: underline;
    }
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
