/**
 * @fileoverview DtPopover 的开合、关闭路径与焦点归还契约。
 * ⚠ 每一条关闭路径（Esc、点外面、面板内 close、受控回写）都必须归还焦点：
 * 漏掉任何一条，焦点会掉回 body，键盘用户得从页首重新 Tab。
 * ⚠ 这里刻意**不用** `stubs: { teleport: true }`：存根会让传送内容里的模板 ref
 * 绑不上，于是焦点相关的用例全部空跑成绿灯。面板一律从 document 上查。
 */
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'

import DtPopover from '../../../src/components/DtPopover/DtPopover.vue'

const TRIGGER = `<template #default="{ toggle, isOpen, panelId }">
  <button class="trigger" :aria-expanded="isOpen" :aria-controls="panelId" @click="toggle">开</button>
</template>`
const CONTENT = `<template #content="{ close }">
  <button class="inside" @click="close">面板里的按钮</button>
</template>`

type PopoverProps = InstanceType<typeof DtPopover>['$props']

function mountPopover(props: Partial<PopoverProps> = {}, content = CONTENT) {
  return mount(DtPopover, {
    props,
    slots: { default: TRIGGER, content },
    attachTo: document.body,
  })
}

function panel(): HTMLElement | null {
  return document.querySelector('[role="dialog"]')
}

function inside(): HTMLElement | null {
  return document.querySelector('.inside')
}

function clickOutside(): void {
  document.dispatchEvent(new Event('pointerdown'))
}

function pressEscapeOn(node: Element | null): void {
  node?.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
  )
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('DtPopover 开合', () => {
  it('缺省是收起的', () => {
    const wrapper = mountPopover()
    expect(panel()).toBeNull()
    wrapper.unmount()
  })

  it('点触发器展开', async () => {
    const wrapper = mountPopover()
    await wrapper.find('.trigger').trigger('click')
    expect(panel()).not.toBeNull()
    wrapper.unmount()
  })

  it('再点一次收起', async () => {
    const wrapper = mountPopover()
    await wrapper.find('.trigger').trigger('click')
    await wrapper.find('.trigger').trigger('click')
    expect(panel()).toBeNull()
    wrapper.unmount()
  })

  it('disabled 时点不开', async () => {
    const wrapper = mountPopover({ disabled: true })
    await wrapper.find('.trigger').trigger('click')
    expect(panel()).toBeNull()
    wrapper.unmount()
  })

  it('触发器插槽拿得到开合状态，供自己标 aria-expanded', async () => {
    const wrapper = mountPopover()
    expect(wrapper.find('.trigger').attributes('aria-expanded')).toBe('false')
    await wrapper.find('.trigger').trigger('click')
    expect(wrapper.find('.trigger').attributes('aria-expanded')).toBe('true')
    wrapper.unmount()
  })

  it('触发器插槽拿得到面板 id，供自己标 aria-controls', async () => {
    const wrapper = mountPopover()
    await wrapper.find('.trigger').trigger('click')
    expect(wrapper.find('.trigger').attributes('aria-controls')).toBe(
      panel()?.id,
    )
    wrapper.unmount()
  })

  it('面板定位成 fixed 并挂上层级，不被宿主的堆叠上下文压住', async () => {
    const wrapper = mountPopover()
    await wrapper.find('.trigger').trigger('click')
    await nextTick()
    const style = panel()?.getAttribute('style') ?? ''
    expect(style).toContain('position: fixed')
    expect(style).toContain('z-index')
    wrapper.unmount()
  })

  it('缺省挂到 body 上，跨得过任何 overflow 容器', async () => {
    const wrapper = mountPopover()
    await wrapper.find('.trigger').trigger('click')
    expect(panel()?.parentElement).toBe(document.body)
    wrapper.unmount()
  })

  it('⚠ 在弹窗里要挂进弹窗面板：挂 body 会跑出焦点陷阱，读屏也读不到', async () => {
    const modal = document.createElement('div')
    modal.className = 'dt-modal__panel'
    document.body.appendChild(modal)
    const wrapper = mount(DtPopover, {
      slots: { default: TRIGGER, content: CONTENT },
      attachTo: modal,
    })
    await wrapper.find('.trigger').trigger('click')
    expect(modal.contains(panel())).toBe(true)
    wrapper.unmount()
  })
})

describe('DtPopover 关闭路径', () => {
  it('面板上按 Esc 收起', async () => {
    const wrapper = mountPopover()
    await wrapper.find('.trigger').trigger('click')
    pressEscapeOn(panel())
    await nextTick()
    expect(panel()).toBeNull()
    wrapper.unmount()
  })

  it('触发器上按 Esc 也收起', async () => {
    const wrapper = mountPopover()
    await wrapper.find('.trigger').trigger('click')
    await wrapper.find('.dt-popover').trigger('keydown.escape')
    expect(panel()).toBeNull()
    wrapper.unmount()
  })

  it('点外面收起', async () => {
    const wrapper = mountPopover()
    await wrapper.find('.trigger').trigger('click')
    clickOutside()
    await nextTick()
    expect(panel()).toBeNull()
    wrapper.unmount()
  })

  it('⚠ 点面板自己不算点外面：它 teleport 出去了，不在触发器子树里', async () => {
    const wrapper = mountPopover()
    await wrapper.find('.trigger').trigger('click')
    panel()?.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    await nextTick()
    expect(panel()).not.toBeNull()
    wrapper.unmount()
  })

  it('内容插槽拿得到 close，面板里的按钮能自己关掉它', async () => {
    const wrapper = mountPopover()
    await wrapper.find('.trigger').trigger('click')
    inside()?.click()
    await nextTick()
    expect(panel()).toBeNull()
    wrapper.unmount()
  })

  it('收起后不再重复 emit', async () => {
    const wrapper = mountPopover()
    await wrapper.find('.trigger').trigger('click')
    await wrapper.find('.dt-popover').trigger('keydown.escape')
    await wrapper.find('.dt-popover').trigger('keydown.escape')
    expect(wrapper.emitted('update:open')).toEqual([[true], [false]])
    wrapper.unmount()
  })
})

describe('DtPopover 焦点', () => {
  it('展开后焦点进面板里第一个可聚焦元素', async () => {
    const wrapper = mountPopover()
    await wrapper.find('.trigger').trigger('click')
    await nextTick()
    expect(document.activeElement).toBe(inside())
    wrapper.unmount()
  })

  it('⚠ 收起后焦点还给触发器，否则会掉回 body 从头 Tab', async () => {
    const wrapper = mountPopover()
    const trigger = wrapper.find<HTMLButtonElement>('.trigger').element
    trigger.focus()
    await wrapper.find('.trigger').trigger('click')
    await nextTick()
    await wrapper.find('.dt-popover').trigger('keydown.escape')
    expect(document.activeElement).toBe(trigger)
    wrapper.unmount()
  })

  it('点外面收起同样归还焦点', async () => {
    const wrapper = mountPopover()
    const trigger = wrapper.find<HTMLButtonElement>('.trigger').element
    trigger.focus()
    await wrapper.find('.trigger').trigger('click')
    await nextTick()
    clickOutside()
    await nextTick()
    expect(document.activeElement).toBe(trigger)
    wrapper.unmount()
  })

  it('面板里没有可聚焦元素时焦点落在面板上', async () => {
    const wrapper = mountPopover({}, '<p>只有一段字</p>')
    await wrapper.find('.trigger').trigger('click')
    await nextTick()
    expect(document.activeElement).toBe(panel())
    wrapper.unmount()
  })
})

describe('DtPopover 受控', () => {
  it('传了 open 就以它为准，自己不再持状态', async () => {
    const wrapper = mountPopover({ open: false })
    await wrapper.find('.trigger').trigger('click')
    expect(panel()).toBeNull()
    expect(wrapper.emitted('update:open')).toEqual([[true]])
    wrapper.unmount()
  })

  it('父组件回写后才真正展开', async () => {
    const wrapper = mountPopover({ open: false })
    await wrapper.setProps({ open: true })
    expect(panel()).not.toBeNull()
    wrapper.unmount()
  })

  it('⚠ 受控下点外面只发请求，不自己收起', async () => {
    const wrapper = mountPopover({ open: true })
    await nextTick()
    clickOutside()
    await nextTick()
    expect(wrapper.emitted('update:open')).toEqual([[false]])
    expect(panel()).not.toBeNull()
    wrapper.unmount()
  })

  it('受控回写关闭时同样归还焦点', async () => {
    const wrapper = mountPopover({ open: false })
    const trigger = wrapper.find<HTMLButtonElement>('.trigger').element
    trigger.focus()
    await wrapper.setProps({ open: true })
    await nextTick()
    await wrapper.setProps({ open: false })
    expect(document.activeElement).toBe(trigger)
    wrapper.unmount()
  })
})
