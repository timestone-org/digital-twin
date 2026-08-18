/**
 * @fileoverview 契约：帮助面板按 `shortcutGroups` 分组渲染，修饰键随平台变形。
 * ⚠ Mac 上显示 Ctrl 等于把整页手势写错，而这一步没有任何报错。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'

import {
  modLabel,
  shortcutGroups,
} from '@/pages/DashboardEditor/scripts/shortcuts'
import ShortcutsDialog from '@/pages/DashboardEditor/components/ShortcutsDialog.vue'

function stubPlatform(platform: string, userAgent: string): void {
  vi.stubGlobal('navigator', { platform, userAgent })
}

function groupsInDom(): Element[] {
  return [...document.querySelectorAll('[data-test="sc-group"]')]
}

afterEach(() => {
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

describe('快捷键帮助', () => {
  it('分组数与清单一致', () => {
    stubPlatform('Win32', 'Windows NT')
    mount(ShortcutsDialog, { props: { open: true } })

    expect(groupsInDom()).toHaveLength(shortcutGroups('Ctrl').length)
  })

  it('每一组的标题与条数都照清单摆', () => {
    stubPlatform('Win32', 'Windows NT')
    mount(ShortcutsDialog, { props: { open: true } })
    const expected = shortcutGroups(modLabel('Win32'))

    expect(
      groupsInDom().map((group) => group.querySelector('h3')?.textContent),
    ).toEqual(expected.map((group) => group.title))
    expect(groupsInDom()[0]?.querySelectorAll('kbd')).toHaveLength(
      expected[0]?.items.length ?? 0,
    )
  })

  it('Mac 上修饰键显示 ⌘', () => {
    stubPlatform('MacIntel', 'Macintosh')
    mount(ShortcutsDialog, { props: { open: true } })

    const keys = [...document.querySelectorAll('kbd')].map(
      (kbd) => kbd.textContent,
    )
    expect(keys.some((text) => text?.includes('⌘') === true)).toBe(true)
    expect(keys.some((text) => text?.includes('Ctrl') === true)).toBe(false)
  })

  it('非 Mac 上修饰键显示 Ctrl', () => {
    stubPlatform('Win32', 'Windows NT 10.0')
    mount(ShortcutsDialog, { props: { open: true } })

    const keys = [...document.querySelectorAll('kbd')].map(
      (kbd) => kbd.textContent,
    )
    expect(keys.some((text) => text?.includes('Ctrl') === true)).toBe(true)
    expect(keys.some((text) => text?.includes('⌘') === true)).toBe(false)
  })

  it('关着的时候一个字都不画', () => {
    stubPlatform('Win32', 'Windows NT')
    mount(ShortcutsDialog, { props: { open: false } })

    expect(groupsInDom()).toHaveLength(0)
  })

  it('点关闭把开合状态交还给父组件', async () => {
    stubPlatform('Win32', 'Windows NT')
    const wrapper = mount(ShortcutsDialog, { props: { open: true } })
    const close = [...document.querySelectorAll('button')].find(
      (button) => button.getAttribute('aria-label') === '关闭',
    )

    close?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await wrapper.vm.$nextTick()

    expect(wrapper.emitted('update:open')?.[0]).toEqual([false])
  })
})
