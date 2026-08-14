/**
 * @fileoverview 契约：拖动的 window 监听由 AbortController 持有——
 * 卸载与 `pointercancel` 都能真的把它摘掉。只在 `pointerup` 里摘监听兜不住
 * 这两条路径，留下的是一副永远跟着鼠标走的监听。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'

import type { NodeGeometry } from '@/features/dashboard/editorDoc'
import { geometryAfterDrag } from '@/pages/DashboardEditor/canvasDrag'
import {
  useCanvasDrag,
  type CanvasDrag,
} from '@/pages/DashboardEditor/useCanvasDrag'

const FROM: NodeGeometry = { x: 100, y: 100, w: 200, h: 100 }

type Change = [string, NodeGeometry, boolean]

/** 把 composable 挂进一个真实组件里，卸载路径才跑得到。 */
function mountDrag(scale = 1) {
  const changes: Change[] = []
  let drag: CanvasDrag | null = null
  const host = defineComponent({
    setup() {
      drag = useCanvasDrag({
        scale: () => scale,
        onChange: (nodeId, geometry, isContinuous) =>
          changes.push([nodeId, geometry, isContinuous]),
      })
      return () => h('div')
    },
  })
  const wrapper = mount(host)
  return { wrapper, changes, drag: drag as unknown as CanvasDrag }
}

function pointer(type: string, clientX: number, clientY: number): void {
  window.dispatchEvent(new MouseEvent(type, { clientX, clientY }))
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('位移换算', () => {
  it('拖位置只动 x / y', () => {
    expect(geometryAfterDrag('move', FROM, 10, -20)).toEqual({
      x: 110,
      y: 80,
      w: 200,
      h: 100,
    })
  })

  it('拖大小只动 w / h，且不许拖到比最小边长还小', () => {
    expect(geometryAfterDrag('resize', FROM, 50, 30)).toEqual({
      x: 100,
      y: 100,
      w: 250,
      h: 130,
    })
    expect(geometryAfterDrag('resize', FROM, -9999, -9999)).toMatchObject({
      w: 24,
      h: 24,
    })
  })
})

describe('一次拖动', () => {
  it('移动过程中连续抛出，松手那一下抛一次收尾', () => {
    const { wrapper, changes, drag } = mountDrag()

    drag.start(new MouseEvent('pointerdown', { clientX: 0, clientY: 0 }) as PointerEvent, 'move', 'n1', FROM)
    pointer('pointermove', 10, 10)
    pointer('pointerup', 20, 20)

    expect(changes.map(([, , live]) => live)).toEqual([true, false])
    expect(changes[1]?.[1]).toEqual({ x: 120, y: 120, w: 200, h: 100 })
    wrapper.unmount()
  })

  it('位移按舞台缩放折算，缩得越小拖得不该越快', () => {
    const { wrapper, changes, drag } = mountDrag(0.5)

    drag.start(new MouseEvent('pointerdown', { clientX: 0, clientY: 0 }) as PointerEvent, 'move', 'n1', FROM)
    pointer('pointerup', 10, 0)

    expect(changes[0]?.[1].x).toBe(120)
    wrapper.unmount()
  })

  it('缩放为 0 时按 1 折算，不算出 Infinity 写进坐标', () => {
    const { wrapper, changes, drag } = mountDrag(0)

    drag.start(new MouseEvent('pointerdown', { clientX: 0, clientY: 0 }) as PointerEvent, 'move', 'n1', FROM)
    pointer('pointerup', 10, 0)

    expect(changes[0]?.[1].x).toBe(110)
    wrapper.unmount()
  })
})

describe('监听的生死', () => {
  it('松手之后再动鼠标不再抛出', () => {
    const { wrapper, changes, drag } = mountDrag()

    drag.start(new MouseEvent('pointerdown', { clientX: 0, clientY: 0 }) as PointerEvent, 'move', 'n1', FROM)
    pointer('pointerup', 5, 5)
    const settled = changes.length
    pointer('pointermove', 50, 50)

    expect(changes).toHaveLength(settled)
    wrapper.unmount()
  })

  it('pointercancel 也收尾，不留下跟着鼠标走的监听', () => {
    const { wrapper, changes, drag } = mountDrag()

    drag.start(new MouseEvent('pointerdown', { clientX: 0, clientY: 0 }) as PointerEvent, 'move', 'n1', FROM)
    pointer('pointercancel', 8, 8)
    const settled = changes.length
    pointer('pointermove', 80, 80)

    expect(changes.at(-1)?.[2]).toBe(false)
    expect(changes).toHaveLength(settled)
    wrapper.unmount()
  })

  it('拖动中被卸载时监听一起摘掉', () => {
    const { wrapper, changes, drag } = mountDrag()

    drag.start(new MouseEvent('pointerdown', { clientX: 0, clientY: 0 }) as PointerEvent, 'move', 'n1', FROM)
    wrapper.unmount()
    pointer('pointermove', 99, 99)
    pointer('pointerup', 99, 99)

    expect(changes).toEqual([])
  })

  it('再起一次拖动会先摘掉上一次的监听', () => {
    const { wrapper, changes, drag } = mountDrag()

    drag.start(new MouseEvent('pointerdown', { clientX: 0, clientY: 0 }) as PointerEvent, 'move', 'n1', FROM)
    drag.start(new MouseEvent('pointerdown', { clientX: 0, clientY: 0 }) as PointerEvent, 'move', 'n2', FROM)
    pointer('pointermove', 10, 0)

    expect(changes.map(([nodeId]) => nodeId)).toEqual(['n2'])
    wrapper.unmount()
  })
})
