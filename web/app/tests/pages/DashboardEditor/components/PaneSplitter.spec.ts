/**
 * @fileoverview 契约：分隔条是 role="separator" 而不是按钮，读屏要能报出
 * 「现在多宽、能拖到多宽」；键盘也要挪得动，不然只有鼠标用户能改宽。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import { NUDGE_COARSE_PX, NUDGE_PX } from '@/pages/DashboardEditor/paneWidths'
import PaneSplitter from '@/pages/DashboardEditor/components/PaneSplitter.vue'

function render(width = 240) {
  return mount(PaneSplitter, {
    props: { label: '模块栏宽度', width, limits: { min: 200, max: 600 } },
  })
}

describe('无障碍标记', () => {
  it('是纵向分隔条，且报出当前值与上下限', () => {
    const root = render(248)

    expect(root.attributes('role')).toBe('separator')
    expect(root.attributes('aria-orientation')).toBe('vertical')
    expect(root.attributes('aria-valuenow')).toBe('248')
    expect(root.attributes('aria-valuemin')).toBe('200')
    expect(root.attributes('aria-valuemax')).toBe('600')
    expect(root.attributes('aria-label')).toBe('模块栏宽度')
  })

  it('能被 Tab 走到', () => {
    expect(render().attributes('tabindex')).toBe('0')
  })
})

describe('抛出的动作', () => {
  it('按下抛 grab，交给上层起手拖拽', async () => {
    const wrapper = render()

    await wrapper.trigger('pointerdown')

    expect(wrapper.emitted('grab')).toHaveLength(1)
  })

  it('左右方向键各挪一步，Shift 走粗档', async () => {
    const wrapper = render()

    await wrapper.trigger('keydown', { key: 'ArrowRight' })
    await wrapper.trigger('keydown', { key: 'ArrowLeft' })
    await wrapper.trigger('keydown', { key: 'ArrowRight', shiftKey: true })

    expect(wrapper.emitted('nudge')).toEqual([
      [NUDGE_PX],
      [-NUDGE_PX],
      [NUDGE_COARSE_PX],
    ])
  })

  // 一步迈得足够大，交给上层 clamp 就正好落在端点上
  it('Home / End 直接顶到两端', async () => {
    const wrapper = render()

    await wrapper.trigger('keydown', { key: 'Home' })
    await wrapper.trigger('keydown', { key: 'End' })

    const moves = wrapper.emitted<[number]>('nudge') ?? []
    expect(moves[0]?.[0]).toBeLessThan(-1000)
    expect(moves[1]?.[0]).toBeGreaterThan(1000)
  })

  it('别的键不抛动作，交还给浏览器', async () => {
    const wrapper = render()

    await wrapper.trigger('keydown', { key: 'Tab' })

    expect(wrapper.emitted('nudge')).toBeUndefined()
  })

  it('双击复位', async () => {
    const wrapper = render()

    await wrapper.trigger('dblclick')

    expect(wrapper.emitted('reset')).toHaveLength(1)
  })
})
