/**
 * @fileoverview DtNumberInput 的受控与步进契约。
 * ⚠ 归一只在落定时做：键入过程中就夹取会让「先删一位再补一位」变成不可能，
 * 而落定后不按父组件实际回写的值刷新显示，被拒的值会留在框里像是生效了。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { nextTick } from 'vue'

import DtNumberInput from '../../../src/components/DtNumberInput/DtNumberInput.vue'

type NumberProps = InstanceType<typeof DtNumberInput>['$props']

function mountInput(props: Partial<NumberProps> = {}) {
  return mount(DtNumberInput, { props })
}

/**
 * 只敲字、不落定。
 * ⚠ 不能用 `setValue`：它会连带触发 change，把「键入」直接变成「落定」，
 * 于是「键入过程中不 emit」这条契约在测试里根本没被走到。
 */
async function type(
  wrapper: ReturnType<typeof mountInput>,
  text: string,
): Promise<void> {
  const input = wrapper.find('input')
  input.element.value = text
  await input.trigger('input')
}

function stepButtons(wrapper: ReturnType<typeof mountInput>) {
  return {
    minus: wrapper.get('[aria-label="减少"]'),
    plus: wrapper.get('[aria-label="增加"]'),
  }
}

describe('DtNumberInput 显示', () => {
  it('渲染受控值', () => {
    const wrapper = mountInput({ modelValue: 42 })
    expect(wrapper.find('input').element.value).toBe('42')
  })

  it('按 precision 补足小数位', () => {
    const wrapper = mountInput({ modelValue: 1.5, range: { precision: 2 } })
    expect(wrapper.find('input').element.value).toBe('1.50')
  })

  it('modelValue 为 undefined 时框里是空的', () => {
    const wrapper = mountInput()
    expect(wrapper.find('input').element.value).toBe('')
  })

  it('0 照实显示，不被当成空', () => {
    const wrapper = mountInput({ modelValue: 0 })
    expect(wrapper.find('input').element.value).toBe('0')
  })

  it('外部改值时跟着变', async () => {
    const wrapper = mountInput({ modelValue: 1 })
    await wrapper.setProps({ modelValue: 9 })
    expect(wrapper.find('input').element.value).toBe('9')
  })

  it('unit 渲染在数字右侧', () => {
    const wrapper = mountInput({ modelValue: 1, unit: 'kW' })
    expect(wrapper.find('.dt-number__unit').text()).toBe('kW')
  })
})

describe('DtNumberInput 键入', () => {
  it('键入过程中不 emit，也不夹取', async () => {
    const wrapper = mountInput({ modelValue: 5, range: { min: 3 } })
    await type(wrapper, '1')
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
    expect(wrapper.find('input').element.value).toBe('1')
  })

  it('落定时归一并 emit', async () => {
    const wrapper = mountInput({ modelValue: 5, range: { min: 3 } })
    await type(wrapper, '1')
    await wrapper.find('input').trigger('change')
    expect(wrapper.emitted('update:modelValue')).toEqual([[3]])
  })

  it('清空落定为 undefined', async () => {
    const wrapper = mountInput({ modelValue: 5 })
    await type(wrapper, '')
    await wrapper.find('input').trigger('change')
    expect(wrapper.emitted('update:modelValue')).toEqual([[undefined]])
  })

  it('只有空白的输入也算清空', async () => {
    const wrapper = mountInput({ modelValue: 5 })
    await type(wrapper, '   ')
    await wrapper.find('input').trigger('change')
    expect(wrapper.emitted('update:modelValue')).toEqual([[undefined]])
  })

  it('键入解析不出的文本时回滚到上一个合法值，不清空', async () => {
    const wrapper = mountInput({ modelValue: 5 })
    await type(wrapper, 'abc')
    await wrapper.find('input').trigger('change')
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
    expect(wrapper.find('input').element.value).toBe('5')
  })

  it('父组件拒绝回写时，显示回滚到 modelValue', async () => {
    const wrapper = mountInput({ modelValue: 5 })
    await type(wrapper, '8')
    await wrapper.find('input').trigger('change')
    await nextTick()
    expect(wrapper.find('input').element.value).toBe('5')
  })
})

describe('DtNumberInput 步进', () => {
  it('加号按 step 递增', async () => {
    const wrapper = mountInput({ modelValue: 5, range: { step: 3 } })
    await stepButtons(wrapper).plus.trigger('click')
    expect(wrapper.emitted('update:modelValue')).toEqual([[8]])
  })

  it('减号按 step 递减', async () => {
    const wrapper = mountInput({ modelValue: 5, range: { step: 3 } })
    await stepButtons(wrapper).minus.trigger('click')
    expect(wrapper.emitted('update:modelValue')).toEqual([[2]])
  })

  it.each([
    ['up', 6],
    ['down', 4],
  ] as const)('方向键 %s 同样步进', async (key, expected) => {
    const wrapper = mountInput({ modelValue: 5 })
    await wrapper.find('input').trigger(`keydown.${key}`)
    expect(wrapper.emitted('update:modelValue')).toEqual([[expected]])
  })

  it('步进基准取当前尚未落定的文本，不取过期的 modelValue', async () => {
    const wrapper = mountInput({ modelValue: 5 })
    await type(wrapper, '10')
    await stepButtons(wrapper).plus.trigger('click')
    expect(wrapper.emitted('update:modelValue')).toEqual([[11]])
  })

  it('空框从下限起步', async () => {
    const wrapper = mountInput({ range: { min: 4 } })
    await stepButtons(wrapper).plus.trigger('click')
    expect(wrapper.emitted('update:modelValue')).toEqual([[5]])
  })

  it('空框且无下限时从 0 起步', async () => {
    const wrapper = mountInput()
    await stepButtons(wrapper).plus.trigger('click')
    expect(wrapper.emitted('update:modelValue')).toEqual([[1]])
  })

  it('步进结果被夹在上限内', async () => {
    const wrapper = mountInput({ modelValue: 99, range: { max: 99.5 } })
    await stepButtons(wrapper).plus.trigger('click')
    expect(wrapper.emitted('update:modelValue')).toEqual([[99.5]])
  })

  it('到达上限后加号禁用', () => {
    const wrapper = mountInput({ modelValue: 10, range: { max: 10 } })
    expect(stepButtons(wrapper).plus.attributes('disabled')).toBe('')
  })

  it('到达下限后减号禁用', () => {
    const wrapper = mountInput({ modelValue: 0, range: { min: 0 } })
    expect(stepButtons(wrapper).minus.attributes('disabled')).toBe('')
  })

  it('没有上下限时两个键都可用', () => {
    const wrapper = mountInput({ modelValue: 0 })
    const { minus, plus } = stepButtons(wrapper)
    expect(minus.attributes('disabled')).toBeUndefined()
    expect(plus.attributes('disabled')).toBeUndefined()
  })

  it('steppers=false 时不渲染步进键', () => {
    const wrapper = mountInput({ modelValue: 1, steppers: false })
    expect(wrapper.find('[aria-label="增加"]').exists()).toBe(false)
  })

  it('禁用时点步进键不 emit', async () => {
    const wrapper = mountInput({ modelValue: 5, disabled: true })
    await stepButtons(wrapper).plus.trigger('click')
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })

  it('⚠ 步进键不进 Tab 序：否则每个数字输入都要按三下才跳得过去', () => {
    const wrapper = mountInput({ modelValue: 1 })
    expect(stepButtons(wrapper).plus.attributes('tabindex')).toBe('-1')
  })

  it('⚠ readonly 时步进键一并禁用：原生 readonly 只挡键入，挡不住步进', () => {
    const wrapper = mount(DtNumberInput, {
      props: { modelValue: 5 },
      attrs: { readonly: true },
    })
    const { minus, plus } = stepButtons(wrapper)
    expect(minus.attributes('disabled')).toBe('')
    expect(plus.attributes('disabled')).toBe('')
  })

  it('⚠ readonly 时方向键也改不动值', async () => {
    const wrapper = mount(DtNumberInput, {
      props: { modelValue: 5 },
      attrs: { readonly: true },
    })
    await wrapper.find('input').trigger('keydown.up')
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })
})

describe('DtNumberInput 无障碍与外壳', () => {
  it('以 role=spinbutton 承载语义', () => {
    const wrapper = mountInput({ modelValue: 1 })
    expect(wrapper.find('input').attributes('role')).toBe('spinbutton')
  })

  it('当前值与上下限落到 aria-value* 上', () => {
    const wrapper = mountInput({
      modelValue: 5,
      range: { min: 0, max: 10 },
    })
    const input = wrapper.find('input')
    expect(input.attributes('aria-valuenow')).toBe('5')
    expect(input.attributes('aria-valuemin')).toBe('0')
    expect(input.attributes('aria-valuemax')).toBe('10')
  })

  it('label 与输入框通过 id 关联', () => {
    const wrapper = mountInput({ label: '采样周期' })
    const id = wrapper.find('input').attributes('id')
    expect(wrapper.find('label').attributes('for')).toBe(id)
  })

  it('hint 经 aria-describedby 关联', () => {
    const wrapper = mountInput({ hint: '单位秒' })
    const described = wrapper.find('input').attributes('aria-describedby')
    expect(wrapper.find(`#${described}`).text()).toBe('单位秒')
  })

  it('error 时标 aria-invalid 并用 role=alert 播报', () => {
    const wrapper = mountInput({ error: '超出量程' })
    expect(wrapper.find('input').attributes('aria-invalid')).toBe('true')
    expect(wrapper.find('[role="alert"]').text()).toBe('超出量程')
  })

  it('required 透到原生属性并标星', () => {
    const wrapper = mountInput({ label: '周期', required: true })
    expect(wrapper.find('input').attributes('required')).toBeDefined()
    expect(wrapper.find('.dt-field__required').exists()).toBe(true)
  })

  it('disabled 时禁用输入且加修饰类', () => {
    const wrapper = mountInput({ modelValue: 1, disabled: true })
    expect(wrapper.find('input').attributes('disabled')).toBe('')
    expect(wrapper.find('.dt-number').classes()).toContain(
      'dt-number--disabled',
    )
  })

  it('placeholder 经 $attrs 落到 input 而不是外层', () => {
    const wrapper = mount(DtNumberInput, { attrs: { placeholder: '不限' } })
    expect(wrapper.find('input').attributes('placeholder')).toBe('不限')
  })

  it.each(['sm', 'md', 'lg'] as const)('size=%s 落到档位类上', (size) => {
    const wrapper = mountInput({ modelValue: 1, size })
    expect(wrapper.find('.dt-number').classes()).toContain(`dt-number--${size}`)
  })
})
