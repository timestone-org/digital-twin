/**
 * @fileoverview DtInput / DtField 的 prop、插槽与 a11y 契约。
 * ⚠ 标签与错误的 id 关联写错时页面看着完全正常，只有读屏用户受影响，
 * 所以 `for` / `aria-describedby` 必须有断言。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import DtInput from '../../src/components/DtInput/DtInput.vue'

describe('DtInput', () => {
  it('渲染受控值', () => {
    const wrapper = mount(DtInput, { props: { modelValue: 'abc' } })
    expect(wrapper.find('input').element.value).toBe('abc')
  })

  it('输入时 emit update:modelValue', async () => {
    const wrapper = mount(DtInput)
    await wrapper.find('input').setValue('x')
    expect(wrapper.emitted('update:modelValue')).toEqual([['x']])
  })

  it('IME 组合期间不 emit，组合结束才 emit 最终值', async () => {
    const wrapper = mount(DtInput)
    const input = wrapper.find('input')
    await input.trigger('compositionstart')
    await input.setValue('ni')
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
    await input.trigger('compositionend')
    expect(wrapper.emitted('update:modelValue')).toEqual([['ni']])
  })

  it('回车时 emit enter', async () => {
    const wrapper = mount(DtInput)
    await wrapper.find('input').trigger('keydown', { key: 'Enter' })
    expect(wrapper.emitted('enter')).toHaveLength(1)
  })

  it('组合输入中的回车不算提交', async () => {
    const wrapper = mount(DtInput)
    await wrapper.find('input').trigger('compositionstart')
    await wrapper.find('input').trigger('keydown', { key: 'Enter' })
    expect(wrapper.emitted('enter')).toBeUndefined()
  })

  it('按键会 emit keystate，供上层判大写锁定', async () => {
    const wrapper = mount(DtInput)
    await wrapper.find('input').trigger('keyup')
    expect(wrapper.emitted('keystate')).toHaveLength(1)
  })

  it('label 与输入框通过 id 关联', () => {
    const wrapper = mount(DtInput, { props: { label: '用户名' } })
    const id = wrapper.find('input').attributes('id')
    expect(wrapper.find('label').attributes('for')).toBe(id)
  })

  it('hint 经 aria-describedby 关联', () => {
    const wrapper = mount(DtInput, { props: { hint: '至少 10 位' } })
    const described = wrapper.find('input').attributes('aria-describedby')
    expect(wrapper.find(`#${described}`).text()).toBe('至少 10 位')
  })

  it('error 时标 aria-invalid，并用 role=alert 播报', () => {
    const wrapper = mount(DtInput, { props: { error: '不能为空' } })
    expect(wrapper.find('input').attributes('aria-invalid')).toBe('true')
    expect(wrapper.find('[role="alert"]').text()).toBe('不能为空')
  })

  it('error 与 hint 同传时只渲染 error，describedby 不指向未渲染节点', () => {
    const wrapper = mount(DtInput, {
      props: { error: '不能为空', hint: '提示' },
    })
    expect(wrapper.text()).not.toContain('提示')
    const described = wrapper.find('input').attributes('aria-describedby')
    expect(wrapper.find(`#${described}`).exists()).toBe(true)
  })

  it('required 透到原生属性并标星', () => {
    const wrapper = mount(DtInput, {
      props: { label: '用户名', required: true },
    })
    expect(wrapper.find('input').attributes('required')).toBeDefined()
    expect(wrapper.find('.dt-field__required').exists()).toBe(true)
  })

  it.each(['text', 'password', 'email'] as const)(
    'type=%s 透到原生属性',
    (type) => {
      const wrapper = mount(DtInput, { props: { type } })
      expect(wrapper.find('input').attributes('type')).toBe(type)
    },
  )

  it.each(['sm', 'md', 'lg'] as const)('size=%s 落到档位类上', (size) => {
    const wrapper = mount(DtInput, { props: { size } })
    expect(wrapper.find('.dt-input').classes()).toContain(`dt-input--${size}`)
  })

  it('disabled 时禁用且加修饰类', () => {
    const wrapper = mount(DtInput, { props: { disabled: true } })
    expect(wrapper.find('input').attributes('disabled')).toBe('')
    expect(wrapper.find('.dt-input').classes()).toContain('dt-input--disabled')
  })

  it('placeholder / name / autocomplete 逐个透传', () => {
    const wrapper = mount(DtInput, {
      props: { placeholder: '请输入', name: 'username', autocomplete: 'off' },
    })
    const input = wrapper.find('input')
    expect(input.attributes('placeholder')).toBe('请输入')
    expect(input.attributes('name')).toBe('username')
    expect(input.attributes('autocomplete')).toBe('off')
  })

  it('leading 与 trailing 槽都渲染', () => {
    const wrapper = mount(DtInput, {
      slots: { leading: '<i class="lead" />', trailing: '<i class="tail" />' },
    })
    expect(wrapper.find('.lead').exists()).toBe(true)
    expect(wrapper.find('.tail').exists()).toBe(true)
  })
})
