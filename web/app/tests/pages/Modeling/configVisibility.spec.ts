/** @fileoverview 算子模式条件同时控制字段展示与校验，并保留隐藏配置。 */
import { DtInput } from '@dt/ui'
import { mount } from '@vue/test-utils'
import { expect, it } from 'vitest'
import ConfigForm from '@/pages/Modeling/Canvas/components/ConfigForm.vue'
import { fieldsOf } from '@/pages/Modeling/Canvas/scripts/schemaForm'

const fields = fieldsOf({
  properties: {
    method: { type: 'string', enum: ['mean', 'constant'], default: 'mean' },
    enabled: { type: 'boolean', default: true },
    value: {
      type: 'string',
      title: '填充值',
      minLength: 2,
      'x-dt-visible-when': { method: ['constant'], enabled: [true] },
    },
  },
})
it('缺省模式隐藏无效字段且不参与阻止状态，切换后恢复原值', async () => {
  const wrapper = mount(ConfigForm, {
    props: {
      fields,
      config: { value: 'x' },
      options: {
        tables: [],
        tablesState: 'ready',
        tablesNote: '',
        columns: [],
        columnsNote: '',
      },
      isReadonly: false,
    },
  })
  expect(wrapper.findComponent(DtInput).exists()).toBe(false)
  expect(wrapper.emitted('status')?.at(-1)?.[0]).toEqual({
    message: '',
    hasDraft: false,
  })
  await wrapper.setProps({ config: { method: 'constant', value: 'x' } })
  expect(wrapper.getComponent(DtInput).props('modelValue')).toBe('x')
  expect(wrapper.text()).toContain('至少填写 2 个字符')
  await wrapper.setProps({
    config: { method: 'constant', enabled: false, value: 'x' },
  })
  expect(wrapper.findComponent(DtInput).exists()).toBe(false)
  expect(wrapper.emitted('status')?.at(-1)?.[0]).toEqual({
    message: '',
    hasDraft: false,
  })
  expect(wrapper.emitted('change')).toBeUndefined()
  wrapper.unmount()
})
it('nullable数值仍渲染为数值控件并保留上下界', () => {
  const field = fieldsOf({
    properties: {
      cap: {
        anyOf: [
          { type: 'integer', minimum: 1, maximum: 100 },
          { type: 'null' },
        ],
        default: null,
      },
    },
  })[0]
  expect(field?.widget).toBe('integer')
  expect(field?.min).toBe(1)
  expect(field?.max).toBe(100)
})
