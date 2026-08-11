/**
 * @fileoverview DtHelpTip 的触发器语义与内容契约。
 * ⚠ 问号按钮必须有可访问名称：一个只画着「?」的图标按钮，读屏读出来是空的。
 */
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'

import DtHelpTip from '../../src/components/DtHelpTip/DtHelpTip.vue'

type HelpTipProps = InstanceType<typeof DtHelpTip>['$props']

function mountHelpTip(props: Partial<HelpTipProps> = {}) {
  return mount(DtHelpTip, {
    props: { text: '留空表示不限', ...props },
    attachTo: document.body,
  })
}

function bubble(): HTMLElement | null {
  return document.querySelector('[role="dialog"]')
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('DtHelpTip', () => {
  it('缺省收起，点问号才展开', async () => {
    const wrapper = mountHelpTip()
    expect(bubble()).toBeNull()
    await wrapper.find('button').trigger('click')
    expect(bubble()?.textContent?.trim()).toBe('留空表示不限')
    wrapper.unmount()
  })

  it('再点一次收起', async () => {
    const wrapper = mountHelpTip()
    await wrapper.find('button').trigger('click')
    await wrapper.find('button').trigger('click')
    expect(bubble()).toBeNull()
    wrapper.unmount()
  })

  it('⚠ 问号按钮有缺省可访问名称，不是一个读不出来的图标', () => {
    const wrapper = mountHelpTip()
    expect(wrapper.find('button').attributes('aria-label')).toBe('说明')
    wrapper.unmount()
  })

  it('同页多个时可以各给各的名称', () => {
    const wrapper = mountHelpTip({ label: '采样周期说明' })
    expect(wrapper.find('button').attributes('aria-label')).toBe('采样周期说明')
    wrapper.unmount()
  })

  it('触发器标明它会弹出浮层并跟着开合变', async () => {
    const wrapper = mountHelpTip()
    const button = wrapper.find('button')
    expect(button.attributes('aria-haspopup')).toBe('dialog')
    expect(button.attributes('aria-expanded')).toBe('false')
    await button.trigger('click')
    expect(wrapper.find('button').attributes('aria-expanded')).toBe('true')
    wrapper.unmount()
  })

  it('aria-controls 指向真正的浮层', async () => {
    const wrapper = mountHelpTip()
    await wrapper.find('button').trigger('click')
    expect(wrapper.find('button').attributes('aria-controls')).toBe(
      bubble()?.id,
    )
    wrapper.unmount()
  })

  it('type=button：放进表单里不许提交', () => {
    const wrapper = mountHelpTip()
    expect(wrapper.find('button').attributes('type')).toBe('button')
    wrapper.unmount()
  })

  it('Esc 收起', async () => {
    const wrapper = mountHelpTip()
    await wrapper.find('button').trigger('click')
    await wrapper.find('.dt-popover').trigger('keydown.escape')
    expect(bubble()).toBeNull()
    wrapper.unmount()
  })

  it('点外面收起', async () => {
    const wrapper = mountHelpTip()
    await wrapper.find('button').trigger('click')
    document.dispatchEvent(new Event('pointerdown'))
    await nextTick()
    expect(bubble()).toBeNull()
    wrapper.unmount()
  })

  it.each(['top', 'bottom', 'left', 'right'] as const)(
    'side=%s 透传给浮层',
    async (side) => {
      const wrapper = mountHelpTip({ side })
      await wrapper.find('button').trigger('click')
      await nextTick()
      expect(bubble()?.className).toContain(`dt-popover__panel--${side}`)
      wrapper.unmount()
    },
  )
})
