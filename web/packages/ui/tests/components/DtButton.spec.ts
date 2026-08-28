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

  it('aria-label 经 attrs 透传到根 button，图标键才有可访问名称', () => {
    const wrapper = mount(DtButton, {
      props: { icon: 'user' },
      attrs: { 'aria-label': '当前用户' },
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

describe('开关语义（pressed）', () => {
  it('pressed=true 是按下态：soft 外观 + primary 强调 + aria-pressed=true', () => {
    const wrapper = mount(DtButton, { props: { pressed: true } })
    const button = wrapper.find('button')
    expect(button.classes()).toContain('dt-btn--soft')
    expect(button.attributes('style')).toContain('--accent-primary')
    expect(button.attributes('aria-pressed')).toBe('true')
  })

  it('pressed=false 是弹起态：ghost 外观 + neutral 强调 + aria-pressed=false', () => {
    const wrapper = mount(DtButton, { props: { pressed: false } })
    const button = wrapper.find('button')
    expect(button.classes()).toContain('dt-btn--ghost')
    expect(button.attributes('style')).toContain('--text-secondary')
    expect(button.attributes('aria-pressed')).toBe('false')
  })

  it('pressed 存在时显式传入的 variant 与 intent 被完全忽略', () => {
    const on = mount(DtButton, {
      props: { pressed: true, variant: 'outline', intent: 'danger' },
    }).find('button')
    expect(on.classes()).toContain('dt-btn--soft')
    expect(on.classes()).not.toContain('dt-btn--outline')
    expect(on.attributes('style')).toContain('--accent-primary')
    expect(on.attributes('style')).not.toContain('--state-danger')

    const off = mount(DtButton, {
      props: { pressed: false, variant: 'solid', intent: 'danger' },
    }).find('button')
    expect(off.classes()).toContain('dt-btn--ghost')
    expect(off.classes()).not.toContain('dt-btn--solid')
    expect(off.attributes('style')).toContain('--text-secondary')
    expect(off.attributes('style')).not.toContain('--state-danger')
  })

  // ⚠ Boolean prop 缺省会被 Vue 强转成 false，undefined 分支必须显式守住：
  //   缺省一旦变 false，全仓普通按钮都会退化成 ghost 并被读屏当成开关
  it('不传 pressed 时不落 aria-pressed，外观仍由 variant/intent 决定', () => {
    const button = mount(DtButton, {
      props: { variant: 'outline', intent: 'danger' },
    }).find('button')
    expect(button.attributes('aria-pressed')).toBeUndefined()
    expect(button.classes()).toContain('dt-btn--outline')
    expect(button.attributes('style')).toContain('--state-danger')
  })

  it('pressed 态点击照常 emit click，交给上层翻转状态', async () => {
    const wrapper = mount(DtButton, { props: { pressed: true } })
    await wrapper.find('button').trigger('click')
    expect(wrapper.emitted('click')).toHaveLength(1)
  })
})

describe('xs 档', () => {
  it('size=xs 落 dt-btn--xs 且保留 dt-btn 基类（焦点环挂在基类上）', () => {
    const button = mount(DtButton, {
      props: { size: 'xs', icon: 'trash' },
    }).find('button')
    expect(button.classes()).toContain('dt-btn')
    expect(button.classes()).toContain('dt-btn--xs')
  })

  it('xs 的内嵌图标压到 12px', () => {
    const svg = mount(DtButton, { props: { size: 'xs', icon: 'trash' } }).find(
      'svg',
    )
    expect(svg.attributes('width')).toBe('12')
    expect(svg.attributes('height')).toBe('12')
  })

  it('无文字时压成正方形图标键', () => {
    const button = mount(DtButton, {
      props: { size: 'xs', icon: 'trash' },
    }).find('button')
    expect(button.classes()).toContain('dt-btn--icon-only')
  })

  // ⚠ 带标签的 xs 曾被无条件压成 20px 宽，文字裁成两个字加一个省略号；typecheck、
  // lint 与全部单测一律放行，只有人眼盯着那一处才看得见。宽度归 CSS，这里守的是
  // 「不认作 icon-only」——正方形那条规则正是挂在这个类上的
  it('带文字时不认作 icon-only，宽度让给文字', () => {
    const button = mount(DtButton, {
      props: { size: 'xs', icon: 'trash' },
      slots: { default: '反转方向' },
    }).find('button')

    expect(button.classes()).toContain('dt-btn--xs')
    expect(button.classes()).not.toContain('dt-btn--icon-only')
    expect(button.text()).toBe('反转方向')
  })

  it('xs 也吃 disabled：禁用且不 emit click', async () => {
    const wrapper = mount(DtButton, {
      props: { size: 'xs', icon: 'trash', disabled: true },
    })
    await wrapper.find('button').trigger('click')
    expect(wrapper.find('button').attributes('disabled')).toBe('')
    expect(wrapper.emitted('click')).toBeUndefined()
  })

  it('xs 键键盘可达：原生 button 不带负 tabindex，focus 拿得到焦点', () => {
    const wrapper = mount(DtButton, {
      props: { size: 'xs', icon: 'trash' },
      attachTo: document.body,
    })
    const element = wrapper.find('button').element
    expect(element.getAttribute('tabindex')).toBeNull()
    element.focus()
    expect(document.activeElement).toBe(element)
    wrapper.unmount()
  })

  it('xs 与 pressed 组合：微型键也能表达按压态', () => {
    const button = mount(DtButton, {
      props: { size: 'xs', icon: 'eye', pressed: true },
    }).find('button')
    expect(button.classes()).toContain('dt-btn--xs')
    expect(button.classes()).toContain('dt-btn--soft')
    expect(button.attributes('aria-pressed')).toBe('true')
  })
})
