/**
 * @fileoverview DtTooltip 的显隐、a11y 关联与内容失效契约。
 * ⚠ 没内容时不能挂 aria-describedby：它会指向一个不存在的节点，读屏读出一片空。
 * ⚠ 不用 teleport 存根，理由同 DtPopover.spec。
 */
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'

import DtTooltip from '../../src/components/DtTooltip/DtTooltip.vue'

type TooltipProps = InstanceType<typeof DtTooltip>['$props']

function mountTooltip(props: Partial<TooltipProps> = {}) {
  return mount(DtTooltip, {
    props: { content: '这里是提示', ...props },
    slots: { default: '<button class="trigger">悬停我</button>' },
    attachTo: document.body,
  })
}

function bubble(): HTMLElement | null {
  return document.querySelector('[role="tooltip"]')
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('DtTooltip 显隐', () => {
  it('缺省不显示', () => {
    const wrapper = mountTooltip()
    expect(bubble()).toBeNull()
    wrapper.unmount()
  })

  it('指针移入时弹出', async () => {
    const wrapper = mountTooltip()
    await wrapper.find('.dt-tooltip').trigger('mouseenter')
    expect(bubble()?.textContent?.trim()).toBe('这里是提示')
    wrapper.unmount()
  })

  it('指针移开时收起', async () => {
    const wrapper = mountTooltip()
    await wrapper.find('.dt-tooltip').trigger('mouseenter')
    await wrapper.find('.dt-tooltip').trigger('mouseleave')
    expect(bubble()).toBeNull()
    wrapper.unmount()
  })

  it('⚠ 键盘聚焦同样弹出：只认 hover 的提示键盘用户永远看不到', async () => {
    const wrapper = mountTooltip()
    await wrapper.find('.dt-tooltip').trigger('focusin')
    expect(bubble()).not.toBeNull()
    wrapper.unmount()
  })

  it('焦点移开时收起', async () => {
    const wrapper = mountTooltip()
    await wrapper.find('.dt-tooltip').trigger('focusin')
    await wrapper.find('.dt-tooltip').trigger('focusout')
    expect(bubble()).toBeNull()
    wrapper.unmount()
  })

  it('⚠ Esc 可关掉，覆盖 WCAG 对悬浮内容的可消除要求', async () => {
    const wrapper = mountTooltip()
    await wrapper.find('.dt-tooltip').trigger('mouseenter')
    await wrapper.find('.dt-tooltip').trigger('keydown.escape')
    expect(bubble()).toBeNull()
    wrapper.unmount()
  })

  it('disabled 时不弹', async () => {
    const wrapper = mountTooltip({ disabled: true })
    await wrapper.find('.dt-tooltip').trigger('mouseenter')
    expect(bubble()).toBeNull()
    wrapper.unmount()
  })

  it('内容为空时不弹，不留一个空气泡', async () => {
    const wrapper = mountTooltip({ content: '' })
    await wrapper.find('.dt-tooltip').trigger('mouseenter')
    expect(bubble()).toBeNull()
    wrapper.unmount()
  })

  it('压根没给 content 时同样不弹', async () => {
    const wrapper = mount(DtTooltip, {
      slots: { default: '<button class="trigger">悬停我</button>' },
      attachTo: document.body,
    })
    await wrapper.find('.dt-tooltip').trigger('mouseenter')
    expect(bubble()).toBeNull()
    wrapper.unmount()
  })

  it('⚠ 点别处不收起：提示靠移开指针收，外点收会让它在滚动条上一点就消失', async () => {
    const wrapper = mountTooltip()
    await wrapper.find('.dt-tooltip').trigger('mouseenter')
    document.dispatchEvent(new Event('pointerdown'))
    await nextTick()
    expect(bubble()).not.toBeNull()
    wrapper.unmount()
  })

  it('⚠ 展开期间内容被清空要立刻收起，否则挂着一句已经作废的话', async () => {
    const wrapper = mountTooltip()
    await wrapper.find('.dt-tooltip').trigger('mouseenter')
    await wrapper.setProps({ content: '' })
    await nextTick()
    expect(bubble()).toBeNull()
    wrapper.unmount()
  })

  it('展开期间被禁用同样收起', async () => {
    const wrapper = mountTooltip()
    await wrapper.find('.dt-tooltip').trigger('mouseenter')
    await wrapper.setProps({ disabled: true })
    await nextTick()
    expect(bubble()).toBeNull()
    wrapper.unmount()
  })
})

describe('DtTooltip 无障碍', () => {
  it('触发器经 aria-describedby 指向气泡', async () => {
    const wrapper = mountTooltip()
    await wrapper.find('.dt-tooltip').trigger('mouseenter')
    expect(wrapper.find('.dt-tooltip').attributes('aria-describedby')).toBe(
      bubble()?.id,
    )
    wrapper.unmount()
  })

  it('⚠ 没内容时不挂 describedby：它会指向不存在的节点', () => {
    const wrapper = mountTooltip({ content: '' })
    expect(
      wrapper.find('.dt-tooltip').attributes('aria-describedby'),
    ).toBeUndefined()
    wrapper.unmount()
  })

  it('气泡以 role=tooltip 承载语义', async () => {
    const wrapper = mountTooltip()
    await wrapper.find('.dt-tooltip').trigger('mouseenter')
    expect(bubble()).not.toBeNull()
    wrapper.unmount()
  })

  it('触发内容照常渲染', () => {
    const wrapper = mountTooltip()
    expect(wrapper.find('.trigger').text()).toBe('悬停我')
    wrapper.unmount()
  })
})

describe('DtTooltip 定位', () => {
  it('气泡定位成 fixed，跨得过 overflow 容器', async () => {
    const wrapper = mountTooltip()
    await wrapper.find('.dt-tooltip').trigger('mouseenter')
    await nextTick()
    expect(bubble()?.getAttribute('style')).toContain('position: fixed')
    wrapper.unmount()
  })

  it.each(['top', 'bottom', 'left', 'right'] as const)(
    'side=%s 落到方向类上，供箭头朝对边',
    async (side) => {
      const wrapper = mountTooltip({ side })
      await wrapper.find('.dt-tooltip').trigger('mouseenter')
      await nextTick()
      expect(bubble()?.className).toContain(`dt-tooltip__bubble--${side}`)
      wrapper.unmount()
    },
  )
})
