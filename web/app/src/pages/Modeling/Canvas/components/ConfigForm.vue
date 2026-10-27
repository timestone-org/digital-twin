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
import { computed, ref, watch } from 'vue'

import type { FieldWidget, FormField, FormOptions } from '../scripts/schemaForm'
import { isDefault } from '../scripts/schemaForm'
import { configError, fieldValue, numberRange } from '../scripts/configValues'
import type { ConfigStatus } from '../scripts/configValues'

import ArrayConfigInput from './ArrayConfigInput.vue'
import ColumnPicker from './ColumnPicker.vue'
import ColumnAggregations from './ColumnAggregations.vue'
import MomentInput from './MomentInput.vue'
import StructuredConfigInput from './StructuredConfigInput.vue'
import BdmIdentifierPicker from './BdmIdentifierPicker.vue'
import ConfigResetButton from './ConfigResetButton.vue'

const INLINE_RESET_WIDGETS: readonly FieldWidget[] = [
  'text',
  'number',
  'integer',
  'switch',
  'select',
  'column',
  'table',
]

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
  status: [value: ConfigStatus]
}>()

const drafts = ref<Record<string, ConfigStatus>>({})
const status = computed<ConfigStatus>(() => {
  if (props.isReadonly) return { message: '', hasDraft: false }
  const issues = props.fields.map((field) => ({
    field,
    draft: drafts.value[field.key],
    message:
      drafts.value[field.key]?.message ||
      configError(field, fieldValue(field, props.config)),
  }))
  const first =
    issues.find((issue) => issue.draft?.hasDraft === true) ??
    issues.find((issue) => issue.message !== '')
  return {
    message: first ? `${first.field.label}：${first.message}` : '',
    hasDraft: issues.some((issue) => issue.draft?.hasDraft === true),
  }
})
watch(status, (value) => emit('status', value), { immediate: true })

function setDraft(key: string, value: ConfigStatus): void {
  drafts.value = { ...drafts.value, [key]: value }
}

/** 台账下拉总带搜索框：台账靠编码认，只有一张也要能敲编码定位。 */
const TABLE_DISPLAY = {
  searchable: true,
  placeholder: '选一张台账',
  searchPlaceholder: '按名称或编码搜索',
}

/** 单值列引用的下拉。宽表上没有搜索就只能一路滚。 */
const COLUMN_DISPLAY = {
  searchable: true,
  placeholder: '选一列',
  searchPlaceholder: '按列名搜索',
}

function textOf(field: FormField): string {
  const value = fieldValue(field, props.config)
  return typeof value === 'string' ? value : ''
}

function numberOf(field: FormField): number | undefined {
  const value = fieldValue(field, props.config)
  return typeof value === 'number' ? value : undefined
}

function boolOf(field: FormField): boolean {
  return fieldValue(field, props.config) === true
}

function listOf(field: FormField): readonly string[] {
  const value = fieldValue(field, props.config)
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string')
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
  const current = textOf(field)
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

/**
 * 单值列引用的选项：上游那份候选，外加图里存着却已经不在候选里的那一列。
 *
 * ⚠ 存着的列不在候选里时不能空着显示「请选择」：上游取数一改窄，用户会看到
 * 这一栏莫名其妙地空了，而保存与运行仍被后端拦下。
 */
function columnOptions(field: FormField): readonly DtSelectOption[] {
  const listed = props.options.columns.map((item) => ({
    value: item.key,
    label: item.name || item.key,
  }))
  const current = textOf(field)
  if (current === '' || listed.some((item) => item.value === current)) {
    return listed
  }
  return [{ value: current, label: `${current}（上游没有这一列）` }, ...listed]
}

/** 这一项现在偏离默认值了吗——偏离了才给「恢复默认」。 */
function canReset(field: FormField): boolean {
  if (props.isReadonly || field.fallback === undefined) return false
  return !isDefault(field, props.config[field.key])
}

/** 这一项的提示语：必填没填时说出来，否则用 schema 的说明。 */
function hintOf(field: FormField): string {
  return errorOf(field) || field.hint
}

function errorOf(field: FormField): string {
  return configError(field, fieldValue(field, props.config))
}
</script>

<template>
  <div class="dt-ml-form">
    <div
      v-for="field in props.fields"
      :key="field.key"
      class="dt-ml-form__row"
      :data-widget="field.widget"
    >
      <BdmIdentifierPicker
        v-if="field.widget === 'bdm-identifiers'"
        :field="field"
        :kind="props.config['kind']"
        :model-value="listOf(field)"
        :is-readonly="props.isReadonly"
        @update:model-value="emit('change', field.key, $event)"
        @status="setDraft(field.key, $event)"
      />
      <StructuredConfigInput
        v-else-if="field.widget === 'json'"
        :model-value="fieldValue(field, props.config)"
        :value-type="field.jsonType"
        :label="field.label"
        :hint="field.hint"
        :is-readonly="props.isReadonly"
        @update:model-value="emit('change', field.key, $event)"
        @status="setDraft(field.key, $event)"
      />
      <ArrayConfigInput
        v-else-if="
          field.widget === 'multi-select' || field.widget.endsWith('-list')
        "
        :field="field"
        :model-value="fieldValue(field, props.config)"
        :is-readonly="props.isReadonly"
        @update:model-value="emit('change', field.key, $event)"
        @status="setDraft(field.key, $event)"
      />
      <MomentInput
        v-else-if="field.widget === 'moment'"
        :model-value="textOf(field)"
        :label="field.label"
        :hint="field.hint"
        :is-readonly="props.isReadonly"
        @update:model-value="emit('change', field.key, $event)"
      />
      <ColumnAggregations
        v-else-if="field.widget === 'column-aggregations'"
        :model-value="props.config[field.key]"
        :columns="props.options.columns"
        :options="field.options"
        :label="field.label"
        :note="props.options.columnsNote"
        :is-readonly="props.isReadonly"
        @update:model-value="emit('change', field.key, $event)"
      />
      <ColumnPicker
        v-else-if="field.widget === 'columns'"
        :model-value="listOf(field)"
        :columns="props.options.columns"
        :label="field.label"
        :hint="field.hint"
        :error="errorOf(field)"
        :is-required="field.isRequired || (field.minItems ?? 0) > 0"
        :note="props.options.columnsNote"
        :is-readonly="props.isReadonly"
        @update:model-value="emit('change', field.key, $event)"
      />
      <div v-else-if="field.widget === 'column'" class="dt-ml-form__stack">
        <DtSelect
          :model-value="textOf(field)"
          :options="columnOptions(field)"
          :display="COLUMN_DISPLAY"
          :label="field.label"
          :hint="hintOf(field)"
          :error="errorOf(field)"
          :required="field.isRequired"
          :disabled="props.isReadonly"
          @update:model-value="emit('change', field.key, $event)"
        >
          <template v-if="canReset(field)" #actions>
            <ConfigResetButton
              :fallback="field.fallback"
              @reset="emit('change', field.key, field.fallback)"
            />
          </template>
        </DtSelect>
        <p v-if="props.options.columns.length === 0" class="dt-ml-form__note">
          {{ props.options.columnsNote }}
        </p>
      </div>
      <DtField
        v-else-if="
          field.widget === 'table' && props.options.tablesState === 'denied'
        "
        :label="field.label"
        :hint="field.hint"
      >
        <DtInput
          :model-value="textOf(field)"
          placeholder="填台账编码"
          :error="errorOf(field)"
          :required="field.isRequired"
          :disabled="props.isReadonly"
          @update:model-value="emit('change', field.key, $event)"
        >
          <template v-if="canReset(field)" #actions>
            <ConfigResetButton
              :fallback="field.fallback"
              @reset="emit('change', field.key, field.fallback)"
            />
          </template>
        </DtInput>
        <!-- ⚠ 这句必须**总是**看得见：空下拉读起来是「一张台账都没建」，
             而真相往往是「你看不到」，两者的处置完全不同 -->
        <p class="dt-ml-form__note">{{ props.options.tablesNote }}</p>
      </DtField>
      <div v-else-if="field.widget === 'table'" class="dt-ml-form__stack">
        <DtSelect
          :model-value="textOf(field)"
          :options="tableOptions(field)"
          :display="TABLE_DISPLAY"
          :label="field.label"
          :hint="hintOf(field)"
          :error="errorOf(field)"
          :required="field.isRequired"
          :disabled="props.isReadonly"
          @update:model-value="emit('change', field.key, $event)"
        >
          <template v-if="canReset(field)" #actions>
            <ConfigResetButton
              :fallback="field.fallback"
              @reset="emit('change', field.key, field.fallback)"
            />
          </template>
        </DtSelect>
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
        :model-value="textOf(field)"
        :options="field.options"
        :label="field.label"
        :hint="hintOf(field)"
        :error="errorOf(field)"
        :required="field.isRequired"
        :disabled="props.isReadonly"
        @update:model-value="emit('change', field.key, $event)"
      >
        <template v-if="canReset(field)" #actions>
          <ConfigResetButton
            :fallback="field.fallback"
            @reset="emit('change', field.key, field.fallback)"
          />
        </template>
      </DtSelect>
      <DtNumberInput
        v-else-if="field.widget === 'number' || field.widget === 'integer'"
        :model-value="numberOf(field)"
        :range="numberRange(field, fieldValue(field, props.config))"
        :label="field.label"
        :hint="hintOf(field)"
        :error="errorOf(field)"
        :required="field.isRequired"
        :disabled="props.isReadonly"
        @update:model-value="emit('change', field.key, $event)"
      >
        <template v-if="canReset(field)" #actions>
          <ConfigResetButton
            :fallback="field.fallback"
            @reset="emit('change', field.key, field.fallback)"
          />
        </template>
      </DtNumberInput>
      <DtField v-else-if="field.widget === 'switch'" :hint="field.hint">
        <DtSwitch
          :model-value="boolOf(field)"
          :label="field.label"
          :disabled="props.isReadonly"
          @update:model-value="emit('change', field.key, $event)"
        />
        <template v-if="canReset(field)" #actions>
          <ConfigResetButton
            :fallback="field.fallback"
            @reset="emit('change', field.key, field.fallback)"
          />
        </template>
      </DtField>
      <DtInput
        v-else
        :model-value="textOf(field)"
        :label="field.label"
        :hint="hintOf(field)"
        :error="errorOf(field)"
        :required="field.isRequired"
        :disabled="props.isReadonly"
        @update:model-value="emit('change', field.key, $event)"
      >
        <template v-if="canReset(field)" #actions>
          <ConfigResetButton
            :fallback="field.fallback"
            @reset="emit('change', field.key, field.fallback)"
          />
        </template>
      </DtInput>
      <ConfigResetButton
        v-if="canReset(field) && !INLINE_RESET_WIDGETS.includes(field.widget)"
        :fallback="field.fallback"
        @reset="emit('change', field.key, field.fallback)"
      />
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
    flex-direction: column;
    gap: 0.5rem;
    align-items: stretch;

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

  &__row > .dt-ml-form__reset {
    align-self: flex-end;
  }
}
</style>
