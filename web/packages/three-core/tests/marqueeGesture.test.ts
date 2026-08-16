/**
 * @fileoverview 守框选手势：只有按住 Shift 才接管、太小的框当手抖、
 * 框自己不吃指针事件、取消与卸载都不留残留的方块。
 */
import { afterEach, describe, expect, it } from 'vitest'

import { MarqueeGesture } from '../src/marqueeGesture'
import type { ScreenRect } from '../src/marqueeSelect'

const hosts: HTMLElement[] = []

function setup() {
  const host = document.createElement('div')
  document.body.append(host)
  hosts.push(host)
  const finished: ScreenRect[] = []
  const gesture = new MarqueeGesture({
    host: () => host,
    onFinish: (rect) => finished.push(rect),
  })
  return { gesture, host, finished }
}

function pointer(
  x: number,
  y: number,
  init: PointerEventInit = {},
): PointerEvent {
  return new PointerEvent('pointerdown', {
    clientX: x,
    clientY: y,
    button: 0,
    ...init,
  })
}

function boxIn(host: HTMLElement): HTMLElement | null {
  return host.querySelector('[data-test="twin-marquee"]')
}

afterEach(() => {
  for (const host of hosts.splice(0)) host.remove()
})

describe('接管条件', () => {
  it('按住 Shift 才接管', () => {
    const { gesture } = setup()

    expect(gesture.down(pointer(0, 0, { shiftKey: true }))).toBe(true)
    expect(gesture.isActive).toBe(true)
  })

  // 不按 Shift 时这一下要留给轨道相机与点选
  it('没按 Shift 时不接管', () => {
    const { gesture } = setup()

    expect(gesture.down(pointer(0, 0))).toBe(false)
    expect(gesture.isActive).toBe(false)
  })

  it('右键不接管', () => {
    const { gesture } = setup()

    expect(gesture.down(pointer(0, 0, { shiftKey: true, button: 2 }))).toBe(
      false,
    )
  })
})

describe('画框', () => {
  it('拖开之后画出框来', () => {
    const { gesture, host } = setup()
    gesture.down(pointer(10, 10, { shiftKey: true }))

    gesture.move(pointer(120, 90, { shiftKey: true }))

    expect(boxIn(host)).not.toBeNull()
  })

  // ⚠ 框吃了指针事件的话，光标一进框内后续 pointermove 就打在框上，框会停住不动
  it('框不吃指针事件', () => {
    const { gesture, host } = setup()
    gesture.down(pointer(10, 10, { shiftKey: true }))

    gesture.move(pointer(120, 90, { shiftKey: true }))

    expect(boxIn(host)?.style.pointerEvents).toBe('none')
  })

  it('只动了一两像素时还不画，免得点一下闪一个方块', () => {
    const { gesture, host } = setup()
    gesture.down(pointer(10, 10, { shiftKey: true }))

    gesture.move(pointer(12, 11, { shiftKey: true }))

    expect(boxIn(host)).toBeNull()
  })

  it('反着拖也画得出来', () => {
    const { gesture, host } = setup()
    gesture.down(pointer(200, 200, { shiftKey: true }))

    gesture.move(pointer(50, 50, { shiftKey: true }))

    expect(boxIn(host)?.style.width).toBe('150px')
  })
})

describe('松手', () => {
  it('交出框住的那块区域', () => {
    const { gesture, finished } = setup()
    gesture.down(pointer(10, 20, { shiftKey: true }))

    const handled = gesture.up(pointer(110, 220, { shiftKey: true }))

    expect(handled).toBe(true)
    expect(finished).toEqual([{ left: 10, top: 20, width: 100, height: 200 }])
  })

  // 轻轻一动就选中一堆是最难受的那种误操作
  it('太小的框当手抖，不去选一片', () => {
    const { gesture, finished } = setup()
    gesture.down(pointer(10, 10, { shiftKey: true }))

    const handled = gesture.up(pointer(12, 12, { shiftKey: true }))

    expect(handled).toBe(false)
    expect(finished).toEqual([])
  })

  it('没接管过的松手不当框选', () => {
    const { gesture, finished } = setup()

    expect(gesture.up(pointer(100, 100))).toBe(false)
    expect(finished).toEqual([])
  })

  it('松手后框从页面上摘掉', () => {
    const { gesture, host } = setup()
    gesture.down(pointer(10, 10, { shiftKey: true }))
    gesture.move(pointer(120, 90, { shiftKey: true }))

    gesture.up(pointer(120, 90, { shiftKey: true }))

    expect(boxIn(host)).toBeNull()
  })
})

describe('中断', () => {
  // 指针被系统收走时不收框的话，画面上会留一个删不掉的方块
  it('取消时把框收掉', () => {
    const { gesture, host } = setup()
    gesture.down(pointer(10, 10, { shiftKey: true }))
    gesture.move(pointer(120, 90, { shiftKey: true }))

    gesture.cancel()

    expect(boxIn(host)).toBeNull()
    expect(gesture.isActive).toBe(false)
  })

  it('卸载时同样收掉', () => {
    const { gesture, host } = setup()
    gesture.down(pointer(10, 10, { shiftKey: true }))
    gesture.move(pointer(120, 90, { shiftKey: true }))

    gesture.dispose()

    expect(boxIn(host)).toBeNull()
  })

  it('取消之后的松手不再交出区域', () => {
    const { gesture, finished } = setup()
    gesture.down(pointer(10, 10, { shiftKey: true }))
    gesture.cancel()

    gesture.up(pointer(200, 200, { shiftKey: true }))

    expect(finished).toEqual([])
  })

  it('宿主没了也不炸，且松手照常交出区域', () => {
    const finished: ScreenRect[] = []
    const gesture = new MarqueeGesture({
      host: () => null,
      onFinish: (rect) => finished.push(rect),
    })
    gesture.down(pointer(10, 10, { shiftKey: true }))

    expect(() =>
      gesture.move(pointer(120, 90, { shiftKey: true })),
    ).not.toThrow()
    gesture.up(pointer(120, 90, { shiftKey: true }))

    expect(finished).toHaveLength(1)
    gesture.dispose()
  })
})
