/**
 * @fileoverview 画布手势：平移、拖动只在结束时提交一次、框选、连线，
 * 以及每次手势结束都要把窗口上的监听摘掉。
 */
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'

import { useCanvasPointer } from '@/pages/Modeling/Canvas/scripts/useCanvasPointer'
import type { CanvasPoint } from '@/pages/Modeling/Canvas/scripts/useCanvasViewport'

/** 屏幕坐标直接当画布坐标，让断言只盯手势本身。 */
function identity(left: number, top: number): CanvasPoint {
  return { left, top }
}

/**
 * 把组合式装进一个宿主组件里跑。
 * ⚠ 直接调会让 `onBeforeUnmount` 找不到组件实例，Vue 会告警——而闸门要求零告警。
 */
function setup(hooks: ReturnType<typeof handlers>) {
  let pointer!: ReturnType<typeof useCanvasPointer>
  const wrapper = mount(
    defineComponent({
      setup() {
        pointer = useCanvasPointer(identity, hooks)
        return () => h('div')
      },
    }),
  )
  return { pointer, wrapper }
}

function handlers() {
  return {
    onPan: vi.fn(),
    onDragMove: vi.fn(),
    onDragEnd: vi.fn(),
    onMarquee: vi.fn(),
    onWire: vi.fn(),
  }
}

function down(left: number, top: number): PointerEvent {
  return new PointerEvent('pointerdown', { clientX: left, clientY: top })
}

function move(left: number, top: number): void {
  window.dispatchEvent(
    new PointerEvent('pointermove', { clientX: left, clientY: top }),
  )
}

function up(target: EventTarget | null = null): void {
  const event = new PointerEvent('pointerup', { bubbles: true })
  if (target === null) window.dispatchEvent(event)
  else target.dispatchEvent(event)
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('画布手势', () => {
  it('平移把屏幕位移交给视口，并且是增量不是累计', () => {
    const hooks = handlers()
    const { pointer } = setup(hooks)

    pointer.startPan(down(100, 100))
    move(110, 100)
    move(130, 100)
    up()

    expect(hooks.onPan.mock.calls).toEqual([
      [10, 0],
      [20, 0],
    ])
  })

  it('拖动过程中逐帧给位移，但只在松手时提交一次撤销', () => {
    const hooks = handlers()
    const { pointer } = setup(hooks)

    pointer.startDrag(down(0, 0), ['n1', 'n2'])
    move(10, 20)
    move(30, 40)
    up()

    expect(hooks.onDragMove).toHaveBeenCalledTimes(2)
    expect(hooks.onDragMove).toHaveBeenLastCalledWith(['n1', 'n2'], {
      left: 30,
      top: 40,
    })
    expect(hooks.onDragEnd).toHaveBeenCalledExactlyOnceWith(['n1', 'n2'])
  })

  it('框选在松手时给出两个角，中途不提交', () => {
    const hooks = handlers()
    const { pointer } = setup(hooks)

    pointer.startMarquee(down(10, 10))
    move(50, 60)
    expect(hooks.onMarquee).not.toHaveBeenCalled()
    up()

    expect(hooks.onMarquee).toHaveBeenCalledExactlyOnceWith(
      { left: 10, top: 10 },
      { left: 50, top: 60 },
    )
  })

  it('连线在松手时把落点那个元素交出去，由调用方去认接点', () => {
    const hooks = handlers()
    const { pointer } = setup(hooks)
    const target = document.createElement('div')
    document.body.append(target)

    pointer.startWiring(down(0, 0), { node: 'n1', port: 'out', side: 'out' })
    move(80, 0)
    up(target)

    expect(hooks.onWire).toHaveBeenCalledExactlyOnceWith(
      { node: 'n1', port: 'out', side: 'out' },
      target,
    )
    target.remove()
  })

  it('手势结束回到 idle，窗口上的监听也摘干净', () => {
    const remove = vi.spyOn(window, 'removeEventListener')
    const { pointer } = setup(handlers())

    pointer.startPan(down(0, 0))
    up()

    expect(pointer.gesture.value.kind).toBe('idle')
    expect(remove).toHaveBeenCalledWith('pointermove', expect.any(Function))
    expect(remove).toHaveBeenCalledWith('pointerup', expect.any(Function))
  })

  it('没超过阈值的一下算「点」不算「拖」', () => {
    const { pointer } = setup(handlers())

    pointer.startDrag(down(0, 0), ['n1'])
    move(1, 1)

    expect(pointer.hasMoved.value).toBe(false)
  })

  it('组件卸载时手势还没结束，监听照样要摘掉', () => {
    const remove = vi.spyOn(window, 'removeEventListener')
    const { pointer, wrapper } = setup(handlers())
    pointer.startPan(down(0, 0))

    wrapper.unmount()

    expect(remove).toHaveBeenCalledWith('pointermove', expect.any(Function))
  })

  it('拖过一段之后 hasMoved 立起来，用来区分点选与拖动', () => {
    const { pointer } = setup(handlers())

    pointer.startDrag(down(0, 0), ['n1'])
    move(30, 30)

    expect(pointer.hasMoved.value).toBe(true)
  })
})
