/**
 * @fileoverview 契约：手势帧的两条纯判定——主键才接、接了就不再往上冒，Shift 只走
 * 位移大的那根轴。
 *
 * ⚠ 中键与右键必须放过去：一并吞掉的表现是「按在节点上就平移不了 / 弹不出菜单」，
 * 而按在空白处一切正常，从界面上看像是节点自己坏了。
 * ⚠ 接下的那一下不 `stopPropagation` 的话，「点节点」会连带被画布壳当成「点空白」，
 * 于是选中当场又被清掉。
 */
import { describe, expect, it, vi } from 'vitest'

import {
  twin2dAxisLocked,
  twin2dClaimPointer,
} from '@/pages/Twin2dEditor/scripts/gestureFrame'
import type { Twin2dGestureFrame } from '@/pages/Twin2dEditor/scripts/useCanvasPointer'

/**
 * 一下按键，连它的「别再往上冒」探针。
 * ⚠ 探针单独交出来，不从事件对象上再取一次：`@typescript-eslint/unbound-method`
 * 认那是一次脱离对象的方法引用。
 * @param button 鼠标键位
 */
function pointerDown(button: number) {
  const event = new PointerEvent('pointerdown', { button, bubbles: true })
  return { event, stop: vi.spyOn(event, 'stopPropagation') }
}

/**
 * 一帧位移。
 * @param dx 横向位移
 * @param dy 纵向位移
 * @param shift 按着 Shift 没有
 */
function frameOf(dx: number, dy: number, shift: boolean): Twin2dGestureFrame {
  return {
    kind: 'move',
    from: { x: 0, y: 0 },
    to: { x: dx, y: dy },
    dx,
    dy,
    clientDx: dx,
    clientDy: dy,
    alt: false,
    shift,
    additive: false,
    moved: true,
  }
}

describe('这一按归不归本层接', () => {
  it('左键接下来，并且不再往上冒', () => {
    const { event, stop } = pointerDown(0)

    expect(twin2dClaimPointer(event)).toBe(true)
    expect(stop).toHaveBeenCalled()
  })

  it('中键放过去——它归画布壳平移', () => {
    const { event, stop } = pointerDown(1)

    expect(twin2dClaimPointer(event)).toBe(false)
    expect(stop).not.toHaveBeenCalled()
  })

  it('右键放过去——它留给上下文菜单', () => {
    const { event, stop } = pointerDown(2)

    expect(twin2dClaimPointer(event)).toBe(false)
    expect(stop).not.toHaveBeenCalled()
  })
})

describe('Shift 锁轴', () => {
  it('不按 Shift 时两轴原样带过去', () => {
    expect(twin2dAxisLocked(frameOf(30, 10, false))).toEqual({ dx: 30, dy: 10 })
  })

  it('按着 Shift 且横向更大时只走横向', () => {
    expect(twin2dAxisLocked(frameOf(30, 10, true))).toEqual({ dx: 30, dy: 0 })
  })

  it('按着 Shift 且纵向更大时只走纵向', () => {
    expect(twin2dAxisLocked(frameOf(10, 30, true))).toEqual({ dx: 0, dy: 30 })
  })

  it('两轴一样多时走横向，不留一个两边都动的中间态', () => {
    expect(twin2dAxisLocked(frameOf(20, -20, true))).toEqual({ dx: 20, dy: 0 })
  })
})
