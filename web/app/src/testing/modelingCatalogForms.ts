/** @fileoverview 用新鲜算子Schema挂载真实配置窗口并操作相应字段控件。 */
import { DtInput, DtNumberInput, DtSelect, DtSwitch } from '@dt/ui'
import { mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import ConfigEditorDialog from '@/pages/Modeling/Canvas/components/ConfigEditorDialog.vue'
import ColumnPicker from '@/features/modeling-config/components/ColumnPicker.vue'
import BdmIdentifierPicker from '@/pages/Modeling/Canvas/components/BdmIdentifierPicker.vue'
import {
  defaultsOf,
  fieldsOf,
  visibleFields,
} from '@/features/modeling-config/scripts/schemaForm'
import type { FormField } from '@/features/modeling-config/scripts/schemaForm'
import type { CatalogEntry } from './modelingCatalogProbe'

export function initialConfig(entry: CatalogEntry): Record<string, unknown> {
  return structuredClone(defaultsOf(fieldsOf(entry.operator.config_schema)))
}
export function catalogDialog(
  entry: CatalogEntry,
  config: Record<string, unknown>,
) {
  return mount(ConfigEditorDialog, {
    props: {
      node: {
        id: entry.operator.code,
        operator: entry.operator.code,
        alias: '',
        config,
        position: { left: 0, top: 0 },
      },
      operator: entry.operator,
      fields: fieldsOf(entry.operator.config_schema),
      options: {
        tables: [{ code: 'energy_h', name: '真实测试台账' }],
        tablesState: 'ready',
        tablesNote: '',
        columns: entry.columns,
        columnsNote: '',
      },
      isReadonly: false,
    },
    global: { stubs: { Teleport: true } },
  })
}
export async function updateConfig(
  wrapper: ReturnType<typeof catalogDialog>,
  config: Record<string, unknown>,
) {
  const node = wrapper.props('node')
  if (!node) throw new Error('缺少配置节点')
  await wrapper.setProps({ node: { ...node, config: { ...config } } })
}
export async function editField(
  wrapper: VueWrapper,
  field: FormField,
  value: unknown,
) {
  if (field.widget === 'columns') {
    const control = wrapper
      .findAllComponents(ColumnPicker)
      .find((item) => item.props('label') === field.label)
    if (!control) throw new Error(`没有列控件 ${field.key}`)
    control.vm.$emit('update:modelValue', value)
  } else if (field.widget === 'bdm-identifiers') {
    wrapper
      .getComponent(BdmIdentifierPicker)
      .vm.$emit('update:modelValue', value)
  } else if (field.widget === 'number' || field.widget === 'integer') {
    const control = wrapper
      .findAllComponents(DtNumberInput)
      .find((item) => item.props('label') === field.label)
    if (!control) throw new Error(`没有数值控件 ${field.key}`)
    await control.get('input').setValue(String(value))
  } else if (['select', 'column', 'table'].includes(field.widget)) {
    const control = wrapper
      .findAllComponents(DtSelect)
      .find((item) => item.props('label') === field.label)
    if (!control) throw new Error(`没有选项控件 ${field.key}`)
    control.vm.$emit('update:modelValue', value)
  } else {
    await editTextOrSwitch(wrapper, field, value)
  }
  await wrapper.vm.$nextTick()
}
async function editTextOrSwitch(
  wrapper: VueWrapper,
  field: FormField,
  value: unknown,
) {
  if (field.widget === 'switch') {
    const control = wrapper
      .findAllComponents(DtSwitch)
      .find((item) => item.props('label') === field.label)
    if (!control) throw new Error(`没有开关 ${field.key}`)
    await control.get('button').trigger('click')
    return
  }
  const control = wrapper
    .findAllComponents(DtInput)
    .find((item) => item.props('label') === field.label)
  if (!control) throw new Error(`没有文字控件 ${field.key}`)
  await control
    .get('input')
    .setValue(Array.isArray(value) ? value.join(', ') : String(value))
}

export function branches(entry: CatalogEntry): Record<string, unknown>[] {
  const fields = fieldsOf(entry.operator.config_schema)
  const base = { ...initialConfig(entry), ...entry.seed }
  const states = [base]
  for (const field of fields) {
    for (const [key, values] of Object.entries(field.visibleWhen ?? {})) {
      for (const value of values) {
        const conditions = Object.fromEntries(
          Object.entries(field.visibleWhen ?? {}).map(([name, options]) => [
            name,
            options[0],
          ]),
        )
        states.push({ ...base, ...conditions, [key]: value })
      }
    }
  }
  for (const state of [...states]) {
    for (const field of visibleFields(fields, state)) {
      if (field.widget !== 'select') continue
      for (const option of field.options)
        states.push({ ...state, [field.key]: option.value })
    }
  }
  return [
    ...new Map(
      states
        .map((state) => completeBranch(entry, state))
        .filter((state) =>
          fields.every(
            (field) =>
              field.widget !== 'select' ||
              field.options.some((option) => option.value === state[field.key]),
          ),
        )
        .map((state) => [JSON.stringify(state), state]),
    ).values(),
  ]
}

function completeBranch(
  entry: CatalogEntry,
  config: Record<string, unknown>,
): Record<string, unknown> {
  if (
    entry.operator.code === 'column_math' &&
    config['right_mode'] === 'column'
  )
    return { ...config, right_column: entry.columns[0]?.key }
  if (
    entry.operator.code === 'text_transform' &&
    config['method'] === 'replace'
  )
    return { ...config, find: '甲' }
  return config
}
