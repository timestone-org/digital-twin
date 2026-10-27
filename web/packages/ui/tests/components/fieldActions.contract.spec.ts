/** @fileoverview 字段操作插槽透传、校验提示关联与按钮交互契约。 */
import { defineComponent } from 'vue'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import { DtButton, DtInput, DtNumberInput, DtSelect } from '../../src'

const Form = defineComponent({
  components: { DtButton, DtInput, DtNumberInput, DtSelect },
  props: { invalid: Boolean },
  emits: ['check'],
  template: `<div>
    <DtInput label="名称" model-value="示例" hint="这是一段会换行的字段说明"
      :error="invalid ? '请检查名称' : undefined">
      <template #actions><DtButton @click="$emit('check')">检查</DtButton></template>
    </DtInput>
    <DtSelect label="选项" model-value="a" :options="[{value:'a',label:'A'}]">
      <template #actions><DtButton>刷新</DtButton></template>
    </DtSelect>
    <DtNumberInput label="比例" :model-value="0.2">
      <template #actions><DtButton>恢复默认</DtButton></template>
    </DtNumberInput>
  </div>`,
})

describe('字段的行内操作', () => {
  it('文本、下拉和数字控件均透传操作按钮', () => {
    const wrapper = mount(Form)
    expect(
      wrapper.findAll('.dt-field__actions').map((row) => row.text()),
    ).toEqual(['检查', '刷新', '恢复默认'])
    wrapper.unmount()
  })

  it('校验提示变化后仍保留按钮交互和输入的错误关联', async () => {
    const wrapper = mount(Form)
    await wrapper.setProps({ invalid: true })
    const input = wrapper.get('input[type="text"]')
    const error = wrapper.get('.dt-field__error')
    expect(input.attributes('aria-describedby')).toBe(error.attributes('id'))
    expect(input.attributes('aria-invalid')).toBe('true')
    await wrapper.get('.dt-field__actions button').trigger('click')
    expect(wrapper.emitted('check')).toHaveLength(1)
    wrapper.unmount()
  })

  it('未提供操作时保留普通字段结构', () => {
    const wrapper = mount(DtInput, { props: { label: '名称', modelValue: '' } })
    expect(wrapper.find('.dt-field__actions').exists()).toBe(false)
    expect(wrapper.find('.dt-field--actions').exists()).toBe(false)
    wrapper.unmount()
  })
})
