/** @fileoverview 复杂参数草稿不因其它字段修改而被覆盖。 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import ParameterField from '@/pages/Modeling/Instance/components/ParameterField.vue'

describe('复杂参数编辑', () => {
  it('同值新对象不能清掉尚未完成的 JSON 草稿', async () => {
    const wrapper = mount(ParameterField, {
      props: {
        field: {
          key: 'columns',
          label: '输入列',
          hint: '',
          kind: 'json',
          options: [],
          required: true,
        },
        value: ['temperature'],
        disabled: false,
      },
    })
    await wrapper.get('textarea').setValue('["temperature",')
    expect(wrapper.text()).toContain('JSON 格式不完整')
    await wrapper.setProps({ value: ['temperature'] })
    expect(wrapper.get('textarea').element.value).toBe('["temperature",')
    expect(wrapper.text()).toContain('JSON 格式不完整')
    await wrapper.get('textarea').setValue('["temperature","load"]')
    expect(wrapper.emitted('change')?.at(-1)).toEqual([['temperature', 'load']])
    expect(wrapper.text()).not.toContain('JSON 格式不完整')
  })
})
