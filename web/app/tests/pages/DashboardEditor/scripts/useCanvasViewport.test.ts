/**
 * @fileoverview 契约：生效倍率在「适应窗口」与固定倍率之间切换、⌘滚轮以指针为锚
 * 缩放后把滚动推回去、空格与中键平移，以及空格键态的 window 监听在卸载时收干净——
 * 收不干净的话切走编辑器后按空格还会把别处的滚动条拖着走。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { defineComponent, h, nextTick, ref } from 'vue'

import type { CanvasZoom } from '@/features/dashboard/canvasZoom'
import type { CanvasViewportView } from '@/pages/DashboardEditor/scripts/canvasViewport'
import { useCanvasViewport } from '@/pages/DashboardEditor/scripts/useCanvasViewport'

const DESIGN = { width: 1000, height: 500 }

function mountViewport(initial: CanvasZoom = null) {
  const zoom = ref<CanvasZoom>(initial)
  const asked: number[] = []
  let view: CanvasViewportView | null = null
  const host = defineComponent({
    setup() {
      view = useCanvasViewport({
        design: () => DESIGN,
        zoom: () => zoom.value,
        onZoom: (next) => {
          asked.push(next)
          zoom.value = next
        },
      })
      const current = view
      return () =>
        h('div', { ref: current.viewportRef, onWheel: current.onWheel }, [
          h('div', { ref: current.stageRef }),
        ])
    },
  })
  const wrapper = mount(host, { attachTo: document.body })
  return { wrapper, zoom, asked, view: view as unknown as CanvasViewportView }
}

function key(type: string, code: string): void {
  window.dispatchEvent(new KeyboardEvent(type, { code }))
}

describe('倍率换挡', () => {
  it('不给倍率就跟随适应窗口', () => {
    const { view, wrapper } = mountViewport(null)

    expect(view.effScale.value).toBe(view.fitScale.value)
    wrapper.unmount()
  })

  it('给了倍率就按倍率铺开舞台的占位框', () => {
    const { view, wrapper } = mountViewport(2)

    expect(view.effScale.value).toBe(2)
    expect(view.wrapStyle.value.width).toBe('2000px')
    expect(view.stageStyle.value.transform).toBe('scale(2)')
    wrapper.unmount()
  })

  it('倍率越界夹回合法区间，不把 0 当倍率去除', () => {
    const { view, wrapper } = mountViewport(0.01)

    expect(view.effScale.value).toBe(0.1)
    wrapper.unmount()
  })
})

describe('滚轮缩放', () => {
  it('不带 ⌘ / Ctrl 的滚轮留给画布自己滚，不改倍率', async () => {
    const { asked, wrapper } = mountViewport(1)

    await wrapper.trigger('wheel', { deltaY: -100 })

    expect(asked).toEqual([])
    wrapper.unmount()
  })

  it('⌘滚轮上抛新倍率，并把指针底下的设计坐标钉回原处', async () => {
    const { asked, wrapper } = mountViewport(1)

    await wrapper.trigger('wheel', {
      deltaY: -400,
      ctrlKey: true,
      clientX: 100,
      clientY: 50,
    })
    await nextTick()
    await nextTick()

    expect(asked[0]).toBeCloseTo(Math.E, 5)
    const element = wrapper.element as HTMLElement
    expect(element.scrollLeft).toBeCloseTo(100 * Math.E - 100, 3)
    expect(element.scrollTop).toBeCloseTo(50 * Math.E - 50, 3)
    wrapper.unmount()
  })

  it('居中某个矩形：把它的中心滚到视口中心', () => {
    const { view, wrapper } = mountViewport(2)

    view.centerOn({ left: 100, top: 0, width: 200, height: 100 })

    expect((wrapper.element as HTMLElement).scrollLeft).toBe(400)
    wrapper.unmount()
  })
})

describe('平移', () => {
  it('没按空格时左键不接管指针', () => {
    const { view, wrapper } = mountViewport(1)

    const taken = view.startPan(
      new MouseEvent('pointerdown', { button: 0 }) as PointerEvent,
    )

    expect(taken).toBe(false)
    wrapper.unmount()
  })

  it('中键拖拽平移，松手之后再动鼠标不再滚', () => {
    const { view, wrapper } = mountViewport(1)
    const element = wrapper.element as HTMLElement

    view.startPan(
      new MouseEvent('pointerdown', {
        button: 1,
        clientX: 40,
        clientY: 30,
      }) as PointerEvent,
    )
    window.dispatchEvent(
      new MouseEvent('pointermove', { clientX: 10, clientY: 10 }),
    )
    const moved = element.scrollLeft
    window.dispatchEvent(new MouseEvent('pointerup'))
    window.dispatchEvent(
      new MouseEvent('pointermove', { clientX: 0, clientY: 0 }),
    )

    expect(moved).toBe(30)
    expect(element.scrollLeft).toBe(30)
    wrapper.unmount()
  })

  it('按住空格进平移态，失焦一律复位——不然切回来会卡住', () => {
    const { view, wrapper } = mountViewport(1)

    key('keydown', 'Space')
    const held = view.isPanMode.value
    window.dispatchEvent(new Event('blur'))

    expect(held).toBe(true)
    expect(view.isPanMode.value).toBe(false)
    wrapper.unmount()
  })

  it('卸载之后再按空格不再进平移态', () => {
    const { view, wrapper } = mountViewport(1)

    wrapper.unmount()
    key('keydown', 'Space')

    expect(view.isPanMode.value).toBe(false)
  })
})
