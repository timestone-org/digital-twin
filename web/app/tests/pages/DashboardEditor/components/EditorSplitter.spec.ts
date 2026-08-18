/**
 * @fileoverview 契约：分隔条的 side 只写一次。
 * ⚠ 在调用处逐个手写 side 时，把宽度、取值域与三个动作里的任意一个写成另一侧，
 * typecheck 与 lint 都放行——表现是拖左边的条改的是右边的栏。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

import EditorSplitter from '@/pages/DashboardEditor/components/EditorSplitter.vue'
import type { EditorPanes } from '@/pages/DashboardEditor/scripts/useEditorPanes'
import type { PaneSide } from '@/pages/DashboardEditor/scripts/paneWidths'

function fakePanes() {
  const startDrag = vi.fn()
  const nudge = vi.fn()
  const reset = vi.fn()
  const limitsOf = vi.fn((side: PaneSide) =>
    side === 'left' ? { min: 200, max: 600 } : { min: 100, max: 300 },
  )
  const panes: EditorPanes = {
    hostRef: ref<HTMLElement | null>(null),
    left: ref(240),
    right: ref(320),
    gridStyle: ref({}) as EditorPanes['gridStyle'],
    limitsOf,
    startDrag,
    nudge,
    reset,
  }
  return { panes, startDrag, nudge, reset, limitsOf }
}

function render(side: PaneSide) {
  const seam = fakePanes()
  const wrapper = mount(EditorSplitter, {
    props: { side, label: `${side} 宽度`, panes: seam.panes },
  })
  return { ...seam, wrapper }
}

describe('取哪一侧的宽度', () => {
  it('左条读左栏宽度与左栏取值域', () => {
    const { wrapper } = render('left')

    expect(wrapper.attributes('aria-valuenow')).toBe('240')
    expect(wrapper.attributes('aria-valuemax')).toBe('600')
  })

  it('右条读右栏宽度与右栏取值域', () => {
    const { wrapper } = render('right')

    expect(wrapper.attributes('aria-valuenow')).toBe('320')
    expect(wrapper.attributes('aria-valuemax')).toBe('300')
  })
})

describe('动作都带着自己那一侧', () => {
  it('按下把 side 一起交给拖拽', async () => {
    const { wrapper, startDrag } = render('right')

    await wrapper.trigger('pointerdown')

    expect(startDrag.mock.calls[0]?.[0]).toBe('right')
  })

  it('方向键微调带着 side', async () => {
    const { wrapper, nudge } = render('left')

    await wrapper.trigger('keydown', { key: 'ArrowRight' })

    expect(nudge).toHaveBeenCalledWith('left', 16)
  })

  it('双击复位带着 side', async () => {
    const { wrapper, reset } = render('right')

    await wrapper.trigger('dblclick')

    expect(reset).toHaveBeenCalledWith('right')
  })
})
