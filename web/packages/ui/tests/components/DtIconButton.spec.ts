/** @fileoverview 图标按钮的名称、提示、状态与事件转发契约。 */
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import DtIconButton from '../../src/components/DtIconButton/DtIconButton.vue'

type Props = InstanceType<typeof DtIconButton>['$props']
const wrappers: ReturnType<typeof mountIconButton>[] = []

function mountIconButton(props: Partial<Props> = {}) {
  const wrapper = mount(DtIconButton, {
    props: { icon: 'undo', label: '撤销', ...props },
    attrs: { 'data-test': 'action', 'aria-keyshortcuts': 'Control+z' },
    attachTo: document.body,
  })
  return wrapper
}

afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount())
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('DtIconButton', () => {
  it('原生按钮保留中文名称、真实图标和 32px 尺寸档', () => {
    const wrapper = mountIconButton()
    wrappers.push(wrapper)
    const button = wrapper.get('button')
    expect(button.classes()).toContain('dt-btn--icon-only')
    expect(button.classes()).toContain('dt-btn--sm')
    expect(button.classes()).toContain('dt-btn--ghost')
    expect(button.attributes('aria-label')).toBe('撤销')
    expect(button.attributes('aria-pressed')).toBeUndefined()
    expect(button.get('.dt-icon-button__label').text()).toBe('撤销')
    expect(button.findAll('svg path').length).toBeGreaterThan(0)
    expect(button.attributes('data-test')).toBe('action')
    expect(button.attributes('aria-keyshortcuts')).toBe('Control+z')
  })

  it('悬停和键盘聚焦都有中文提示，Escape 关闭提示', async () => {
    const wrapper = mountIconButton()
    wrappers.push(wrapper)
    await wrapper.get('.dt-tooltip').trigger('mouseenter')
    expect(document.querySelector('[role="tooltip"]')?.textContent).toBe('撤销')
    await wrapper.get('.dt-tooltip').trigger('mouseleave')
    expect(document.querySelector('[role="tooltip"]')).toBeNull()
    wrapper.get('button').element.focus()
    await vi.waitFor(() => {
      expect(document.querySelector('[role="tooltip"]')?.textContent).toBe(
        '撤销',
      )
    })
    expect(wrapper.get('button').attributes('aria-describedby')).toBe(
      document.querySelector('[role="tooltip"]')?.id,
    )
    await wrapper.get('button').trigger('keydown', { key: 'Escape' })
    expect(document.querySelector('[role="tooltip"]')).toBeNull()
  })

  it.each([{ disabled: true }, { loading: true }])(
    '不可用状态 %j 阻止点击但仍可悬停查看说明',
    async (state) => {
      const wrapper = mountIconButton(state)
      wrappers.push(wrapper)
      await wrapper.get('button').trigger('click')
      expect(wrapper.emitted('click')).toBeUndefined()
      expect(wrapper.get('button').attributes('disabled')).toBeDefined()
      await wrapper.get('.dt-tooltip').trigger('mouseenter')
      expect(document.querySelector('[role="tooltip"]')?.textContent).toBe(
        '撤销',
      )
      if ('loading' in state) {
        expect(wrapper.get('button').attributes('aria-busy')).toBe('true')
        expect(wrapper.find('.dt-btn__spinner').exists()).toBe(true)
      }
    },
  )

  it('点击只转发一次，焦点可达，按压状态原样呈现', async () => {
    const wrapper = mountIconButton({ pressed: true })
    wrappers.push(wrapper)
    const button = wrapper.get('button')
    button.element.focus()
    expect(document.activeElement).toBe(button.element)
    await button.trigger('click')
    expect(wrapper.emitted('click')).toHaveLength(1)
    expect(button.attributes('aria-pressed')).toBe('true')
    await wrapper.setProps({ pressed: false })
    expect(button.attributes('aria-pressed')).toBe('false')
  })

  it('额外说明可更新，用户内容按纯文字渲染', async () => {
    const wrapper = mountIconButton({ tooltip: '撤销（⌘Z）' })
    wrappers.push(wrapper)
    await wrapper.get('.dt-tooltip').trigger('mouseenter')
    expect(document.querySelector('[role="tooltip"]')?.textContent).toBe(
      '撤销（⌘Z）',
    )
    await wrapper.setProps({
      label: '添加',
      tooltip: '<img src=x onerror=alert(1)>',
    })
    expect(wrapper.get('button').attributes('aria-label')).toBe('添加')
    expect(document.querySelector('[role="tooltip"]')?.textContent).toBe(
      '<img src=x onerror=alert(1)>',
    )
    expect(document.querySelector('[role="tooltip"] img')).toBeNull()
  })

  it('允许保存使用主色实心并按父级尺寸渲染', () => {
    const wrapper = mountIconButton({
      icon: 'save',
      label: '保存',
      size: 'md',
      variant: 'solid',
      intent: 'primary',
    })
    wrappers.push(wrapper)
    expect(wrapper.get('button').classes()).toContain('dt-btn--md')
    expect(wrapper.get('button').classes()).toContain('dt-btn--solid')
    expect(wrapper.get('button').attributes('style')).toContain(
      '--accent-primary',
    )
  })
})
