/** @fileoverview 文本列表参数框的提示语：schema 没写说明时不留一个孤零零的分号。 */
import { mount } from '@vue/test-utils'
import { expect, it } from 'vitest'

import ArrayConfigInput from '@/features/modeling-config/components/ArrayConfigInput.vue'
import { fieldsOf } from '@/features/modeling-config/scripts/schemaForm'

function fieldOf(property: Record<string, unknown>) {
  const field = fieldsOf({ properties: { lags: property } })[0]
  if (field === undefined) throw new Error('字段不存在')
  return field
}

it('没有说明时提示只剩「多项用逗号分隔」', () => {
  const wrapper = mount(ArrayConfigInput, {
    props: {
      field: fieldOf({ type: 'array', items: { type: 'integer' } }),
      modelValue: [1],
      isReadonly: false,
    },
  })

  expect(wrapper.text()).toContain('多项用逗号分隔')
  expect(wrapper.text()).not.toContain('；多项用逗号分隔')
})

it('有说明时两句用分号接起来', () => {
  const wrapper = mount(ArrayConfigInput, {
    props: {
      field: fieldOf({
        type: 'array',
        items: { type: 'integer' },
        description: '往前错几行',
      }),
      modelValue: [1],
      isReadonly: false,
    },
  })

  expect(wrapper.text()).toContain('往前错几行；多项用逗号分隔')
})
