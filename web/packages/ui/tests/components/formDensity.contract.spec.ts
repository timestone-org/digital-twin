/** @fileoverview 表单原语与内嵌控件统一使用最小默认档，显式档位仍由组件库支持。 */
import { defineComponent } from 'vue'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { DT_CONTROL_DEFAULT_SIZE } from '@dt/contracts'
import {
  DtButton,
  DtColorInput,
  DtDateTimeInput,
  DtField,
  DtFilePicker,
  DtInput,
  DtNumberInput,
  DtRadioGroup,
  DtSelect,
  DtSlider,
  DtSwitch,
  DtTextarea,
} from '../../src'

const Form = defineComponent({
  components: {
    DtButton,
    DtColorInput,
    DtDateTimeInput,
    DtField,
    DtFilePicker,
    DtInput,
    DtNumberInput,
    DtRadioGroup,
    DtSelect,
    DtSlider,
    DtSwitch,
    DtTextarea,
  },
  template: `<form>
    <DtField label="名称"><DtInput model-value="abc" /></DtField>
    <DtNumberInput :model-value="1" label="数量" />
    <DtSelect model-value="a" :options="[{value:'a',label:'A'}]" label="选项" />
    <DtTextarea model-value="说明" label="描述" />
    <DtDateTimeInput model-value="" label="时间" />
    <DtColorInput model-value="" label="颜色" />
    <DtSlider :model-value="10" label="比例" />
    <DtRadioGroup model-value="a" :options="[{value:'a',label:'A'}]" />
    <DtSwitch :model-value="false" />
    <DtFilePicker />
    <DtButton>保存</DtButton>
  </form>`,
})

describe('紧凑表单默认档', () => {
  it('默认值为 sm', () => {
    expect(DT_CONTROL_DEFAULT_SIZE).toBe('sm')
  })
  it('嵌套字段、输入控件与表单按钮都落到 sm', () => {
    const wrapper = mount(Form)
    for (const name of [
      'field',
      'input',
      'number',
      'select',
      'textarea',
      'datetime',
      'color',
      'slider',
      'radio',
      'switch',
      'btn',
    ]) {
      const controls = wrapper.findAll(`.dt-${name}`)
      expect(controls.length, name).toBeGreaterThan(0)
      for (const control of controls)
        expect(control.classes(), name).toContain(`dt-${name}--sm`)
    }
    wrapper.unmount()
  })
})
