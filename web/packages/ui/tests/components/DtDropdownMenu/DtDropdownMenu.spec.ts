/**
 * @fileoverview DtDropdownMenu 的菜单语义、选中与键盘导航契约。
 * ⚠ 选中之后必须收起：菜单装的是动作，动作发出去了还开着，用户会以为没生效再点一次。
 * ⚠ 面板不用 teleport 存根，理由同 DtPopover.spec。
 */
import type { DtMenuItem } from '@dt/contracts'
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'

import DtDropdownMenu from '../../../src/components/DtDropdownMenu/DtDropdownMenu.vue'

const EDIT: DtMenuItem = { value: 'edit', label: '编辑', icon: 'pencil' }
const CLONE: DtMenuItem = { value: 'clone', label: '复制' }
const REMOVE: DtMenuItem = { value: 'remove', label: '删除', danger: true }
const ITEMS: DtMenuItem[] = [EDIT, CLONE, REMOVE]

type MenuProps = InstanceType<typeof DtDropdownMenu>['$props']

function mountMenu(props: Partial<MenuProps> = {}) {
  return mount(DtDropdownMenu, {
    props: { items: ITEMS, ...props },
    attachTo: document.body,
  })
}

function items(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
}

function menu(): HTMLElement | null {
  return document.querySelector('[role="menu"]')
}

async function openMenu(wrapper: ReturnType<typeof mountMenu>) {
  await wrapper.find('button').trigger('click')
  await nextTick()
}

function pressOnMenu(key: string): void {
  menu()?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('DtDropdownMenu 渲染', () => {
  it('缺省触发器是一个图标按钮，带可读名称', () => {
    const wrapper = mountMenu({ label: '行操作' })
    expect(wrapper.find('button').attributes('aria-label')).toBe('行操作')
    wrapper.unmount()
  })

  it('触发器标明它会弹出菜单', () => {
    const wrapper = mountMenu()
    expect(wrapper.find('button').attributes('aria-haspopup')).toBe('menu')
    wrapper.unmount()
  })

  it('展开后每个动作渲染一项', async () => {
    const wrapper = mountMenu()
    await openMenu(wrapper)
    expect(items()).toHaveLength(3)
    wrapper.unmount()
  })

  it('以 role=menu 承载语义', async () => {
    const wrapper = mountMenu()
    await openMenu(wrapper)
    expect(menu()).not.toBeNull()
    wrapper.unmount()
  })

  it('危险动作单独标记，供渲染成警示色', async () => {
    const wrapper = mountMenu()
    await openMenu(wrapper)
    expect(items()[2]?.className).toContain('dt-menu__item--danger')
    wrapper.unmount()
  })

  it('禁用项落到原生 disabled 上，键盘也点不动', async () => {
    const wrapper = mountMenu({
      items: [EDIT, { ...CLONE, disabled: true }, REMOVE],
    })
    await openMenu(wrapper)
    expect(items()[1]?.hasAttribute('disabled')).toBe(true)
    wrapper.unmount()
  })

  it('空菜单给一句空态，不留一个没内容的浮层', async () => {
    const wrapper = mountMenu({ items: [] })
    await openMenu(wrapper)
    expect(menu()?.textContent).toContain('暂无可用操作')
    wrapper.unmount()
  })

  it('自备触发器接管默认按钮', async () => {
    const wrapper = mount(DtDropdownMenu, {
      props: { items: ITEMS },
      slots: {
        trigger: `<template #trigger="{ toggle }">
          <a class="custom" href="#" @click.prevent="toggle">操作</a>
        </template>`,
      },
      attachTo: document.body,
    })
    expect(wrapper.find('button').exists()).toBe(false)
    await wrapper.find('.custom').trigger('click')
    await nextTick()
    expect(items()).toHaveLength(3)
    wrapper.unmount()
  })
})

describe('DtDropdownMenu 选中', () => {
  it('点一项 emit 整个 item', async () => {
    const wrapper = mountMenu()
    await openMenu(wrapper)
    items()[0]?.click()
    await nextTick()
    expect(wrapper.emitted('select')).toEqual([[EDIT]])
    wrapper.unmount()
  })

  it('⚠ 选中后收起：动作发出去还开着，用户会以为没生效', async () => {
    const wrapper = mountMenu()
    await openMenu(wrapper)
    items()[1]?.click()
    await nextTick()
    expect(menu()).toBeNull()
    wrapper.unmount()
  })

  it('禁用项点不出 select', async () => {
    const wrapper = mountMenu({
      items: [EDIT, { ...CLONE, disabled: true }, REMOVE],
    })
    await openMenu(wrapper)
    items()[1]?.dispatchEvent(new Event('click', { bubbles: true }))
    await nextTick()
    expect(wrapper.emitted('select')).toBeUndefined()
    wrapper.unmount()
  })
})

describe('DtDropdownMenu 键盘', () => {
  it('下行键把焦点移到第一项', async () => {
    const wrapper = mountMenu()
    await openMenu(wrapper)
    pressOnMenu('ArrowDown')
    await nextTick()
    expect(document.activeElement).toBe(items()[0])
    wrapper.unmount()
  })

  it('继续按下行键逐项下移', async () => {
    const wrapper = mountMenu()
    await openMenu(wrapper)
    pressOnMenu('ArrowDown')
    pressOnMenu('ArrowDown')
    await nextTick()
    expect(document.activeElement).toBe(items()[1])
    wrapper.unmount()
  })

  it('上行键从头环绕到末项', async () => {
    const wrapper = mountMenu()
    await openMenu(wrapper)
    pressOnMenu('ArrowDown')
    pressOnMenu('ArrowUp')
    await nextTick()
    expect(document.activeElement).toBe(items()[2])
    wrapper.unmount()
  })

  it('跳过禁用项', async () => {
    const wrapper = mountMenu({
      items: [EDIT, { ...CLONE, disabled: true }, REMOVE],
    })
    await openMenu(wrapper)
    pressOnMenu('ArrowDown')
    pressOnMenu('ArrowDown')
    await nextTick()
    expect(document.activeElement).toBe(items()[2])
    wrapper.unmount()
  })

  it('全部禁用时方向键不动，也不抛错', async () => {
    const wrapper = mountMenu({
      items: [
        { ...EDIT, disabled: true },
        { ...CLONE, disabled: true },
      ],
    })
    await openMenu(wrapper)
    pressOnMenu('ArrowDown')
    await nextTick()
    expect(menu()).not.toBeNull()
    wrapper.unmount()
  })

  it('⚠ Tab 移出时收起：菜单浮在别处，留着它会挡住下一个焦点', async () => {
    const wrapper = mountMenu()
    await openMenu(wrapper)
    pressOnMenu('Tab')
    await nextTick()
    expect(menu()).toBeNull()
    wrapper.unmount()
  })

  it('无关按键不拦截，也不改焦点', async () => {
    const wrapper = mountMenu()
    await openMenu(wrapper)
    const before = document.activeElement
    pressOnMenu('a')
    await nextTick()
    expect(document.activeElement).toBe(before)
    wrapper.unmount()
  })

  it('重新展开时高亮回到头，不接着上次的位置', async () => {
    const wrapper = mountMenu()
    await openMenu(wrapper)
    pressOnMenu('ArrowDown')
    pressOnMenu('ArrowDown')
    await nextTick()
    await wrapper.find('button').trigger('click')
    await openMenu(wrapper)
    pressOnMenu('ArrowDown')
    await nextTick()
    expect(document.activeElement).toBe(items()[0])
    wrapper.unmount()
  })
})
