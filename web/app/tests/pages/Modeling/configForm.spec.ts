/**
 * @fileoverview 参数面板上跟「列」有关的三件事：单值列引用是下拉不是多选、
 * 候选跟着上游取数收窄、已勾但上游没有的列能看见也能清掉。
 *
 * ⚠ 这三条各自都是「typecheck 与 lint 双双放行」的那一类：单值字段被存成数组、
 * 候选多列出几列、勾着的列悄悄消失，编译期一个都拦不住。
 */
import type { DtSelectOption } from '@dt/contracts'
import { DtCheckbox, DtSelect } from '@dt/ui'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import ColumnPicker from '@/pages/Modeling/Canvas/components/ColumnPicker.vue'
import ConfigForm from '@/pages/Modeling/Canvas/components/ConfigForm.vue'
import type { FormOptions } from '@/pages/Modeling/Canvas/scripts/schemaForm'
import { fieldsOf } from '@/pages/Modeling/Canvas/scripts/schemaForm'

const COLUMNS = [
  { key: 'F2', name: 'F2' },
  { key: 'F3', name: 'F3' },
]

function options(over: Partial<FormOptions> = {}): FormOptions {
  return {
    tables: [],
    tablesState: 'ready',
    tablesNote: '',
    columns: COLUMNS,
    columnsNote: '',
    ...over,
  }
}

function picker(modelValue: readonly string[]) {
  return mount(ColumnPicker, {
    props: {
      modelValue,
      columns: COLUMNS,
      label: '处理哪些列',
      hint: '',
      note: '先在上游的取数算子里选好台账',
      isReadonly: false,
    },
  })
}

function lastPicked(wrapper: ReturnType<typeof picker>): string[] {
  const emitted = wrapper.emitted('update:modelValue') ?? []
  return (emitted.at(-1)?.[0] ?? []) as string[]
}

describe('列选择器', () => {
  // ⚠ 直接不画的话，上游取数一改窄，惹祸的那几列就从界面上消失了，而保存与
  // 运行仍被后端拦下——用户看得见一句报错，却找不到该动哪里
  it('勾着却已经不在候选里的列单独列出来，并说明上游没有', () => {
    const wrapper = picker(['F1', 'F2'])

    expect(wrapper.text()).toContain('F1（上游没有这一列）')
  })

  it('一键只清掉上游没有的那几列，已勾的正常列留着', async () => {
    const wrapper = picker(['F1', 'F2'])

    await wrapper
      .findAll('button')
      .find((item) => item.text().includes('清掉上游没有的'))
      ?.trigger('click')

    expect(lastPicked(wrapper)).toEqual(['F2'])
  })

  it('勾一列不会顺手把上游没有的那几列悄悄丢掉', async () => {
    const wrapper = picker(['F1'])
    const boxes = wrapper.findAllComponents(DtCheckbox)

    boxes[0]?.vm.$emit('update:modelValue', true)
    await wrapper.vm.$nextTick()

    expect(lastPicked(wrapper)).toEqual(['F2', 'F1'])
  })

  it('候选一列都没有、也没有勾错的列时，只说那一句原因', () => {
    const wrapper = mount(ColumnPicker, {
      props: {
        modelValue: [],
        columns: [],
        label: '处理哪些列',
        hint: '',
        note: '先在上游的取数算子里选好台账',
        isReadonly: false,
      },
    })

    expect(wrapper.text()).toContain('先在上游的取数算子里选好台账')
    expect(wrapper.findAllComponents(DtCheckbox)).toHaveLength(0)
  })
})

const TARGET_SCHEMA = {
  properties: {
    target_column: {
      title: '目标列',
      type: 'string',
      'x-dt-widget': 'column',
    },
  },
  required: ['target_column'],
  type: 'object',
}

function form(config: Record<string, unknown>) {
  return mount(ConfigForm, {
    props: {
      fields: fieldsOf(TARGET_SCHEMA),
      config,
      options: options(),
      isReadonly: false,
    },
  })
}

describe('单值列引用', () => {
  // ⚠ 一律当多选渲染的话，`target_column` 会被存成 `['F2']`，而后端报的是
  // 「参数「目标列」要填一段文字」——看着像算子坏了
  it('渲染成下拉，选中之后发出去的是一个字符串', async () => {
    const wrapper = form({ target_column: '' })

    wrapper.findComponent(DtSelect).vm.$emit('update:modelValue', 'F3')
    await wrapper.vm.$nextTick()

    expect(wrapper.emitted('change')?.at(-1)).toEqual(['target_column', 'F3'])
  })

  it('存着的列已经不在候选里时仍列出来并标注，不空着显示「请选择」', () => {
    const wrapper = form({ target_column: 'F1' })
    const listed = wrapper
      .findComponent(DtSelect)
      .props('options') as DtSelectOption[]

    expect(listed[0]).toEqual({ value: 'F1', label: 'F1（上游没有这一列）' })
  })
})
