/**
 * @fileoverview 契约：大纲的一行——主名与副名两段都要画得出来，选中态落在
 * `aria-pressed` 上，修饰键与画布那一下同一条判据（`ctrlKey || metaKey`）。
 *
 * ⚠ 行是 `<button>` 而不是 `role="option"`：`role="listbox"` 会被本轮的
 * `isFormFocused` 当成可交互祖先，套上去之后大纲一被点中，快捷键就整片让位给它。
 * ⚠ 只画一段的话几十行大纲里认不出谁是谁，所以副名有值时必须落进 DOM。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import OutlineRow from '@/pages/Twin2dEditor/components/OutlineRow.vue'

function mountRow(props: Record<string, unknown> = {}) {
  return mount(OutlineRow, {
    props: { title: '一号泵', icon: 'layout-grid', ...props },
  })
}

type Wrapper = ReturnType<typeof mountRow>

/** 最后一次点出去的加选标记。 */
function lastPick(wrapper: Wrapper): boolean {
  const events = wrapper.emitted('pick')
  if (!events?.length) throw new Error('没有点出去')
  return events[events.length - 1]?.[0] as boolean
}

describe('一行画什么', () => {
  it('主名照写，副名与徽标不给就整个不出现', () => {
    const wrapper = mountRow()

    expect(wrapper.text()).toContain('一号泵')
    expect(wrapper.find('[data-test="row-note"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="row-badge"]').exists()).toBe(false)
  })

  it('副名与徽标给了就各占一格', () => {
    const wrapper = mountRow({ note: '蒸汽锅炉', badge: 'P1' })

    expect(wrapper.find('[data-test="row-note"]').text()).toBe('蒸汽锅炉')
    expect(wrapper.find('[data-test="row-badge"]').text()).toBe('P1')
  })

  it('悬浮提示把主名与副名并起来——窄栏里两段都会被截断', () => {
    const wrapper = mountRow({ note: '蒸汽锅炉' })

    expect(wrapper.attributes('title')).toBe('一号泵 · 蒸汽锅炉')
  })

  it('没有副名时悬浮提示就是主名', () => {
    expect(mountRow().attributes('title')).toBe('一号泵')
  })

  it('副名是警告时另换一种颜色的类', () => {
    const warned = mountRow({ note: '样式缺失 · ghost', warn: true })
    const plain = mountRow({ note: '蒸汽锅炉' })

    expect(warned.find('[data-test="row-note"]').classes()).toContain(
      'text-state-warning',
    )
    expect(plain.find('[data-test="row-note"]').classes()).not.toContain(
      'text-state-warning',
    )
  })
})

describe('选中与点选', () => {
  it('行是 button 而不是 listbox 的选项——listbox 会让快捷键整片让位', () => {
    const wrapper = mountRow()
    const root: Element = wrapper.element

    expect(root.tagName).toBe('BUTTON')
    expect(wrapper.attributes('type')).toBe('button')
    expect(wrapper.attributes('role')).toBeUndefined()
  })

  it('选中态落在 aria-pressed 上', async () => {
    const wrapper = mountRow({ selected: true })
    expect(wrapper.attributes('aria-pressed')).toBe('true')

    await wrapper.setProps({ selected: false })
    expect(wrapper.attributes('aria-pressed')).toBe('false')
  })

  it('直接点是顶替，带 Ctrl 或 ⌘ 点是加选', async () => {
    const wrapper = mountRow()

    await wrapper.trigger('click')
    expect(lastPick(wrapper)).toBe(false)

    await wrapper.trigger('click', { ctrlKey: true })
    expect(lastPick(wrapper)).toBe(true)

    await wrapper.trigger('click', { metaKey: true })
    expect(lastPick(wrapper)).toBe(true)
  })
})
