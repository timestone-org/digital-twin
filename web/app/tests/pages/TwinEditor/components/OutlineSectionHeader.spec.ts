/**
 * @fileoverview 类别新增与菜单常驻，折叠开关带 aria-expanded，标题命中走 <mark> 切片。
 */
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'

import OutlineSectionHeader from '@/pages/TwinEditor/components/OutlineSectionHeader.vue'
import type { TwinEntityKind } from '@/pages/TwinEditor/scripts/types'

interface Over {
  kind?: TwinEntityKind
  title?: string
  slices?: { before: string; match: string; after: string } | null
  countText?: string
  collapsed?: boolean
}

function render(over: Over = {}) {
  return mount(OutlineSectionHeader, {
    props: {
      kind: over.kind ?? 'anchors',
      title: over.title ?? '锚点',
      slices: over.slices ?? null,
      countText: over.countText ?? '2',
      collapsed: over.collapsed ?? false,
    },
    attachTo: document.body,
  })
}

type Wrapper = ReturnType<typeof render>

async function openMenu(wrapper: Wrapper): Promise<void> {
  await wrapper.get('[data-test="section-menu"]').trigger('click')
  await flushPromises()
}

function menuItems(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
}

function menuItem(label: string): HTMLElement | undefined {
  return menuItems().find((item) => item.textContent?.includes(label) === true)
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('展示', () => {
  it('标题与计数都画出来', () => {
    const wrapper = render()

    expect(wrapper.text()).toContain('锚点')
    expect(wrapper.get('[data-test="section-count"]').text()).toBe('2')
  })

  it('标题命中段包进 <mark>', () => {
    const wrapper = render({
      slices: { before: '', match: '锚', after: '点' },
    })

    expect(wrapper.get('mark').text()).toBe('锚')
  })

  it('折叠开关带 aria-expanded，点了抛 toggle', async () => {
    const wrapper = render({ collapsed: true })
    const toggle = wrapper.get('[aria-label="展开或折叠锚点"]')

    expect(toggle.attributes('aria-expanded')).toBe('false')
    await toggle.trigger('click')
    expect(wrapper.emitted('toggle')).toHaveLength(1)
  })
})

describe('新增入口', () => {
  it('非 parts 段直出「+」，点了抛 add', async () => {
    const wrapper = render()

    await wrapper.get('[data-test="section-add"]').trigger('click')

    expect(wrapper.emitted('add')).toHaveLength(1)
  })

  it('部件也显示新增入口，两个操作按钮不依赖悬停', async () => {
    const wrapper = render({ kind: 'parts', title: '部件' })
    const add = wrapper.get('[data-test="section-add"]')
    const menu = wrapper.get('[data-test="section-menu"]')
    expect(add.classes()).not.toContain('opacity-0')
    expect(menu.classes()).not.toContain('opacity-0')
    await add.trigger('click')
    expect(wrapper.emitted('add')).toHaveLength(1)
  })
})

describe('段菜单', () => {
  it('parts 段菜单给新增、批量建与新建文件夹三项', async () => {
    const wrapper = render({ kind: 'parts', title: '部件' })

    await openMenu(wrapper)

    expect(menuItems().map((item) => item.textContent?.trim())).toEqual([
      '新增部件',
      '从模型节点批量建',
      '新建文件夹',
    ])
  })

  it('非 parts 段菜单只有新建文件夹', async () => {
    const wrapper = render()

    await openMenu(wrapper)

    expect(menuItems().map((item) => item.textContent?.trim())).toEqual([
      '新建文件夹',
    ])
  })

  it('「新增部件」抛 add', async () => {
    const wrapper = render({ kind: 'parts', title: '部件' })

    await openMenu(wrapper)
    menuItem('新增部件')?.click()
    await flushPromises()

    expect(wrapper.emitted('add')).toHaveLength(1)
  })

  it('「从模型节点批量建」抛 bulkAdd', async () => {
    const wrapper = render({ kind: 'parts', title: '部件' })

    await openMenu(wrapper)
    menuItem('从模型节点批量建')?.click()
    await flushPromises()

    expect(wrapper.emitted('bulkAdd')).toHaveLength(1)
  })

  it('「新建文件夹」抛 folderNew', async () => {
    const wrapper = render()

    await openMenu(wrapper)
    menuItem('新建文件夹')?.click()
    await flushPromises()

    expect(wrapper.emitted('folderNew')).toHaveLength(1)
  })
})
