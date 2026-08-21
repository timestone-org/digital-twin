/**
 * @fileoverview 夹头行组件的契约：双击就地重命名、Enter/失焦落名、Esc 取消、
 * IME 组合期回车不落名，「⋯」菜单只有重命名与删夹（删夹不删成员写在文案里）。
 */
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'

import OutlineFolderRow from '@/pages/TwinEditor/components/OutlineFolderRow.vue'
import type { TwinOutlineFolderView } from '@/pages/TwinEditor/scripts/outlineNodes'

function folder(
  over: Partial<TwinOutlineFolderView> = {},
): TwinOutlineFolderView {
  return {
    key: 'folder:f1',
    id: 'f1',
    kind: 'anchors',
    label: '温度组',
    rows: [],
    ...over,
  }
}

interface Over {
  folder?: Partial<TwinOutlineFolderView>
  collapsed?: boolean
  renaming?: boolean
  slices?: { before: string; match: string; after: string } | null
  countText?: string
}

function render(over: Over = {}) {
  return mount(OutlineFolderRow, {
    props: {
      folder: folder(over.folder ?? {}),
      collapsed: over.collapsed ?? false,
      renaming: over.renaming ?? false,
      slices: over.slices ?? null,
      countText: over.countText ?? '2',
    },
    attachTo: document.body,
  })
}

type Wrapper = ReturnType<typeof render>

/** 由外部拉起重命名的路径：renaming false → true，watch 把夹名灌进草稿。 */
async function startRenaming(wrapper: Wrapper): Promise<void> {
  await wrapper.setProps({ renaming: true })
}

function menuItem(label: string): HTMLElement | undefined {
  return [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
    (item) => item.textContent?.includes(label) === true,
  )
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('展示', () => {
  it('夹名、计数与折叠开关都画出来', () => {
    const wrapper = render()

    expect(wrapper.get('[data-test="folder-name"]').text()).toBe('温度组')
    expect(wrapper.get('[data-test="folder-count"]').text()).toBe('2')
    expect(
      wrapper.get('[data-test="folder-toggle"]').attributes('aria-expanded'),
    ).toBe('true')
  })

  it('折叠态 aria-expanded 翻成 false', () => {
    expect(
      render({ collapsed: true })
        .get('[data-test="folder-toggle"]')
        .attributes('aria-expanded'),
    ).toBe('false')
  })

  it('点折叠开关抛 toggle', async () => {
    const wrapper = render()

    await wrapper.get('[data-test="folder-toggle"]').trigger('click')

    expect(wrapper.emitted('toggle')).toHaveLength(1)
  })

  it('夹名的命中段包进 <mark>', () => {
    const wrapper = render({
      slices: { before: '', match: '温度', after: '组' },
    })

    expect(wrapper.get('[data-test="folder-name"] mark').text()).toBe('温度')
  })
})

describe('就地重命名', () => {
  it('双击夹名抛 renameStart', async () => {
    const wrapper = render()

    await wrapper.get('[data-test="folder-name"]').trigger('dblclick')

    expect(wrapper.emitted('renameStart')).toHaveLength(1)
  })

  it('进入重命名后输入框顶替夹名，草稿带着当前名字', async () => {
    const wrapper = render()
    await startRenaming(wrapper)

    const input = wrapper.get<HTMLInputElement>('[data-test="folder-rename"]')
    expect(input.element.value).toBe('温度组')
    expect(wrapper.find('[data-test="folder-name"]').exists()).toBe(false)
  })

  it('Enter 落名，抛 renameCommit 带新名字', async () => {
    const wrapper = render()
    await startRenaming(wrapper)

    const input = wrapper.get('[data-test="folder-rename"]')
    await input.setValue('进水段')
    await input.trigger('keydown', { key: 'Enter' })

    expect(wrapper.emitted('renameCommit')).toEqual([['进水段']])
  })

  it('失焦也落名', async () => {
    const wrapper = render()
    await startRenaming(wrapper)

    const input = wrapper.get('[data-test="folder-rename"]')
    await input.setValue('后段')
    await input.trigger('blur')

    expect(wrapper.emitted('renameCommit')).toEqual([['后段']])
  })

  it('Esc 抛 renameCancel，不落名', async () => {
    const wrapper = render()
    await startRenaming(wrapper)

    const input = wrapper.get('[data-test="folder-rename"]')
    await input.setValue('半途而废')
    await input.trigger('keydown', { key: 'Escape' })

    expect(wrapper.emitted('renameCancel')).toHaveLength(1)
    expect(wrapper.emitted('renameCommit')).toBeUndefined()
  })

  // 拼音选词的回车只是确认候选词，值还没定稿
  it('IME 组合期的回车不落名，组合结束后才落', async () => {
    const wrapper = render()
    await startRenaming(wrapper)
    const input = wrapper.get('[data-test="folder-rename"]')

    await input.trigger('compositionstart')
    await input.trigger('keydown', { key: 'Enter' })
    expect(wrapper.emitted('renameCommit')).toBeUndefined()

    await input.setValue('现场组')
    await input.trigger('compositionend')
    await input.trigger('keydown', { key: 'Enter' })
    expect(wrapper.emitted('renameCommit')).toEqual([['现场组']])
  })

  it('静息态没有重命名输入框', () => {
    expect(render().find('[data-test="folder-rename"]').exists()).toBe(false)
  })
})

describe('夹头菜单', () => {
  it('「重命名」抛 renameStart', async () => {
    const wrapper = render()

    await wrapper.get('[data-test="folder-menu"]').trigger('click')
    await flushPromises()
    menuItem('重命名')?.click()
    await flushPromises()

    expect(wrapper.emitted('renameStart')).toHaveLength(1)
  })

  it('「删除文件夹」抛 remove，文案写明不删里面的实体', async () => {
    const wrapper = render()

    await wrapper.get('[data-test="folder-menu"]').trigger('click')
    await flushPromises()
    const item = menuItem('删除文件夹')
    expect(item?.textContent).toContain('不删里面的实体')

    item?.click()
    await flushPromises()
    expect(wrapper.emitted('remove')).toHaveLength(1)
  })
})
