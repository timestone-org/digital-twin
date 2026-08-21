/**
 * @fileoverview 大纲行组件的契约：文档序号常驻并写明用途、名字高亮用切片渲染
 * 不走 v-html、eye-off 警示态常驻、菜单值逐一译成语义动作（含 folder-into 前缀
 * 解析）、二次确认条只按上层递进来的文案画。
 */
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'

import OutlineRow from '@/pages/TwinEditor/components/OutlineRow.vue'
import type { TwinOutlineRow } from '@/pages/TwinEditor/scripts/outlineNodes'

function row(over: Partial<TwinOutlineRow> = {}): TwinOutlineRow {
  return {
    key: 'anchors:0:a1',
    id: 'a1',
    kind: 'anchors',
    index: 1,
    label: '进水温度',
    meta: '℃',
    visible: true,
    flagged: false,
    canMoveUp: true,
    canMoveDown: true,
    ...over,
  }
}

interface Over {
  row?: Partial<TwinOutlineRow>
  selected?: boolean
  searching?: boolean
  slices?: { before: string; match: string; after: string } | null
  folders?: readonly { id: string; label: string }[]
  folderId?: string | null
  confirmText?: string | null
}

function render(over: Over = {}) {
  return mount(OutlineRow, {
    props: {
      row: row(over.row ?? {}),
      selected: over.selected ?? false,
      searching: over.searching ?? false,
      slices: over.slices ?? null,
      folders: over.folders ?? [],
      folderId: over.folderId ?? null,
      confirmText: over.confirmText ?? null,
    },
    attachTo: document.body,
  })
}

type Wrapper = ReturnType<typeof render>

async function openMenu(wrapper: Wrapper): Promise<void> {
  await wrapper.get('[data-test="row-menu"]').trigger('click')
  await flushPromises()
}

function menuItem(label: string): HTMLElement | undefined {
  return [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
    (item) => item.textContent?.includes(label) === true,
  )
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('渲染', () => {
  it('序号写在行头，title 点明它是数组绑定的对齐位次', () => {
    const wrapper = render({ row: { index: 3 } })
    const badge = wrapper.get('[title="文档序号，数组绑定按它对齐"]')

    expect(badge.text()).toBe('3')
  })

  it('meta 非空才画，空串不留一个空 span', () => {
    expect(render().text()).toContain('℃')

    const bare = render({ row: { meta: '' } })
    const spans = bare
      .get('[data-test="row-select"]')
      .findAll('span.text-3xs.text-text-disabled')
    // 只剩序号那一枚；meta 的那枚没画
    expect(spans).toHaveLength(1)
  })

  it('切片命中段包进 <mark>，前后段原样拼接', () => {
    const wrapper = render({
      slices: { before: '进', match: '水温', after: '度' },
    })
    const name = wrapper.get('[data-test="row-select"]')

    expect(name.get('mark').text()).toBe('水温')
    expect(name.text()).toContain('进')
    expect(name.text()).toContain('度')
  })

  it('没有切片时画完整名字', () => {
    const wrapper = render()

    expect(wrapper.find('mark').exists()).toBe(false)
    expect(wrapper.text()).toContain('进水温度')
  })

  it('诊断红点跟着 flagged 走', () => {
    expect(render().find('[data-test="row-flag"]').exists()).toBe(false)
    expect(
      render({ row: { flagged: true } })
        .find('[data-test="row-flag"]')
        .exists(),
    ).toBe(true)
  })

  it('visible 为 null 的行不出显隐键', () => {
    expect(
      render({ row: { visible: null } })
        .find('[data-test="row-visible"]')
        .exists(),
    ).toBe(false)
  })
})

describe('显隐键的常驻规则', () => {
  it('显示中的行显隐键静息隐藏，悬停现身', () => {
    const button = render().get('[data-test="row-visible"]')

    expect(button.classes()).toContain('opacity-0')
    expect(button.attributes('aria-label')).toBe('隐藏进水温度')
  })

  // 已隐藏时这个键是当前状态的唯一提示，不能跟着藏
  it('已隐藏的行 eye-off 警示色常驻，不拼隐藏类', () => {
    const button = render({ row: { visible: false } }).get(
      '[data-test="row-visible"]',
    )

    expect(button.classes()).not.toContain('opacity-0')
    expect(button.classes()).toContain('dt-btn--ghost')
    expect(button.attributes('aria-label')).toBe('显示进水温度')
  })

  it('选中行的动作键常驻', () => {
    const wrapper = render({ selected: true })

    expect(wrapper.get('[data-test="row-visible"]').classes()).not.toContain(
      'opacity-0',
    )
  })
})

describe('动作出口', () => {
  it('点名字抛 select', async () => {
    const wrapper = render()

    await wrapper.get('[data-test="row-select"]').trigger('click')

    expect(wrapper.emitted('act')?.[0]).toEqual([{ type: 'select' }])
  })

  it('点显隐键抛 toggle-visible', async () => {
    const wrapper = render()

    await wrapper.get('[data-test="row-visible"]').trigger('click')

    expect(wrapper.emitted('act')?.[0]).toEqual([{ type: 'toggle-visible' }])
  })

  it('菜单里的上移下移抛带方向的 move', async () => {
    const wrapper = render()

    await openMenu(wrapper)
    menuItem('上移')?.click()
    await flushPromises()

    expect(wrapper.emitted('act')?.[0]).toEqual([{ type: 'move', delta: -1 }])
  })

  it('菜单里的复制抛 duplicate', async () => {
    const wrapper = render()

    await openMenu(wrapper)
    menuItem('复制')?.click()
    await flushPromises()

    expect(wrapper.emitted('act')?.[0]).toEqual([{ type: 'duplicate' }])
  })

  it('菜单里的删除抛 remove-request，不直接抛确认', async () => {
    const wrapper = render()

    await openMenu(wrapper)
    menuItem('删除')?.click()
    await flushPromises()

    expect(wrapper.emitted('act')?.[0]).toEqual([{ type: 'remove-request' }])
  })

  it('「移入某夹」解析 folder-into 前缀，抛出夹 id', async () => {
    const wrapper = render({
      folders: [{ id: 'f-99', label: '温度组' }],
    })

    await openMenu(wrapper)
    menuItem('移入「温度组」')?.click()
    await flushPromises()

    expect(wrapper.emitted('act')?.[0]).toEqual([
      { type: 'folder-into', folderId: 'f-99' },
    ])
  })

  it('夹内行的「移出文件夹」抛 folder-out', async () => {
    const wrapper = render({
      folders: [{ id: 'f1', label: '温度组' }],
      folderId: 'f1',
    })

    await openMenu(wrapper)
    menuItem('移出文件夹')?.click()
    await flushPromises()

    expect(wrapper.emitted('act')?.[0]).toEqual([{ type: 'folder-out' }])
  })

  it('「新建文件夹并移入」抛 folder-new', async () => {
    const wrapper = render()

    await openMenu(wrapper)
    menuItem('新建文件夹并移入')?.click()
    await flushPromises()

    expect(wrapper.emitted('act')?.[0]).toEqual([{ type: 'folder-new' }])
  })

  it('搜索态菜单里的上移是禁用项，点了不抛', async () => {
    const wrapper = render({ searching: true })

    await openMenu(wrapper)
    const item = menuItem('上移（搜索中不能重排）')
    expect(item?.hasAttribute('disabled')).toBe(true)

    item?.click()
    await flushPromises()
    expect(wrapper.emitted('act')).toBeUndefined()
  })
})

describe('二次确认条', () => {
  it('confirmText 为 null 时不画确认条', () => {
    expect(render().find('[data-test="row-remove-confirm"]').exists()).toBe(
      false,
    )
  })

  it('确认条写行名与连带影响文案', () => {
    const wrapper = render({ confirmText: '1 张信息牌会悬空' })
    const bar = wrapper.get('[data-test="row-remove-confirm"]')

    expect(bar.text()).toContain('删除「进水温度」？')
    expect(bar.text()).toContain('1 张信息牌会悬空')
  })

  it('确认抛 remove-confirm，取消抛 remove-cancel', async () => {
    const wrapper = render({ confirmText: '有连带' })

    await wrapper.get('[data-test="row-remove-yes"]').trigger('click')
    await wrapper.get('[data-test="row-remove-no"]').trigger('click')

    expect(wrapper.emitted('act')).toEqual([
      [{ type: 'remove-confirm' }],
      [{ type: 'remove-cancel' }],
    ])
  })
})
