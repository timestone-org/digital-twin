/**
 * @fileoverview DtButton 的 prop / 插槽契约。
 * ⚠ prop 名与插槽名写错时 typecheck 与 lint 双双放行，组件只是静默不生效，
 * 所以每个 prop 与具名插槽都要有一条断言它生效的用例。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import DtButton from '../../src/components/DtButton/DtButton.vue'

describe('DtButton', () => {
  it('默认渲染 solid / primary / md 的 button', () => {
    const wrapper = mount(DtButton, { slots: { default: '确定' } })
    const button = wrapper.find('button')
    expect(button.attributes('type')).toBe('button')
    expect(button.classes()).toContain('dt-btn--solid')
    expect(button.classes()).toContain('dt-btn--md')
    expect(button.text()).toBe('确定')
  })

  it.each(['solid', 'soft', 'ghost', 'outline'] as const)(
    'variant=%s 落到修饰类上',
    (variant) => {
      const wrapper = mount(DtButton, { props: { variant } })
      expect(wrapper.find('button').classes()).toContain(`dt-btn--${variant}`)
    },
  )

  it.each(['sm', 'md', 'lg'] as const)('size=%s 落到档位类上', (size) => {
    const wrapper = mount(DtButton, { props: { size } })
    expect(wrapper.find('button').classes()).toContain(`dt-btn--${size}`)
  })

  it('intent 换掉局部强调色变量', () => {
    const wrapper = mount(DtButton, { props: { intent: 'danger' } })
    expect(wrapper.find('button').attributes('style')).toContain(
      '--state-danger',
    )
  })

  it('type=submit 透到原生属性上', () => {
    const wrapper = mount(DtButton, { props: { type: 'submit' } })
    expect(wrapper.find('button').attributes('type')).toBe('submit')
  })

  it('block 加满宽类', () => {
    const wrapper = mount(DtButton, { props: { block: true } })
    expect(wrapper.find('button').classes()).toContain('dt-btn--block')
  })

  it('disabled 时禁用且不 emit click', async () => {
    const wrapper = mount(DtButton, { props: { disabled: true } })
    await wrapper.find('button').trigger('click')
    expect(wrapper.find('button').attributes('disabled')).toBe('')
    expect(wrapper.emitted('click')).toBeUndefined()
  })

  it('loading 时自动禁用、出 spinner、标 aria-busy', async () => {
    const wrapper = mount(DtButton, { props: { loading: true } })
    await wrapper.find('button').trigger('click')
    expect(wrapper.find('.dt-btn__spinner').exists()).toBe(true)
    expect(wrapper.find('button').attributes('aria-busy')).toBe('true')
    expect(wrapper.emitted('click')).toBeUndefined()
  })

  it('可用时点击会 emit click', async () => {
    const wrapper = mount(DtButton)
    await wrapper.find('button').trigger('click')
    expect(wrapper.emitted('click')).toHaveLength(1)
  })

  it('icon 与 iconRight 各渲染一个图标', () => {
    const wrapper = mount(DtButton, {
      props: { icon: 'user', iconRight: 'arrow-right' },
      slots: { default: '走' },
    })
    expect(wrapper.findAll('svg')).toHaveLength(2)
  })

  it('leading 槽存在时压过 icon prop，不出现两个前置元素', () => {
    const wrapper = mount(DtButton, {
      props: { icon: 'user' },
      slots: { default: '走', leading: '<i class="mine" />' },
    })
    expect(wrapper.find('.mine').exists()).toBe(true)
    expect(wrapper.findAll('svg')).toHaveLength(0)
  })

  it('trailing 槽渲染在末尾', () => {
    const wrapper = mount(DtButton, {
      slots: { default: '走', trailing: '<i class="tail" />' },
    })
    expect(wrapper.find('.tail').exists()).toBe(true)
  })

  it('无文字内容时压成正方形图标键', () => {
    const wrapper = mount(DtButton, { props: { icon: 'user' } })
    expect(wrapper.find('button').classes()).toContain('dt-btn--icon-only')
  })

  it('ariaLabel 透到 aria-label，图标键才有可访问名称', () => {
    const wrapper = mount(DtButton, {
      props: { icon: 'user', ariaLabel: '当前用户' },
    })
    expect(wrapper.find('button').attributes('aria-label')).toBe('当前用户')
  })

  it('loading 时不渲染前后置图标，避免与 spinner 并排', () => {
    const wrapper = mount(DtButton, {
      props: { icon: 'user', iconRight: 'arrow-right', loading: true },
    })
    expect(wrapper.findAll('svg')).toHaveLength(0)
  })
})
