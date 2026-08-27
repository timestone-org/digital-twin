/**
 * @fileoverview 契约：一次手势只在收场那一下落一次 `commit`（一手势一步撤销）、
 * 拖到一半被卸载要补上这一次、卸载之后 window 上不许再留下任何一副指针监听。
 *
 * ⚠ 逐帧 commit 不会报错，只是撤销键从此按不回上一步——拖一个节点就能塞进几百帧。
 * ⚠ 卸载不补收场同样不报错：拖到一半切走的改动既没进撤销栈也没落库。
 * ⚠ 监听留在 window 上的表现更隐蔽：离开这一页之后，整站的指针事件都还在被它拦。
 */
import type { Pt } from '@dt/twin2d'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { defineComponent, h, shallowRef } from 'vue'

import { useCanvasPointer } from '@/pages/Twin2dEditor/scripts/useCanvasPointer'
import type {
  Twin2dCanvasPointer,
  Twin2dGestureEnd,
  Twin2dGestureFrame,
  Twin2dGestureKind,
  Twin2dGestureSpec,
} from '@/pages/Twin2dEditor/scripts/useCanvasPointer'
import type { Twin2dClientPoint } from '@/pages/Twin2dEditor/scripts/viewportOps'

/** 下游画布层接手势的那副样子：`onMove` 只写草稿，`onEnd` 才落库。 */
interface Recorder {
  moves: Twin2dGestureFrame[]
  ends: Twin2dGestureEnd[]
  commits: number
  last: Twin2dGestureFrame | null
}

/** 测试里视口不缩不移，client 坐标直接当设计坐标用。 */
function identity(at: Twin2dClientPoint): Pt {
  return { x: at.clientX, y: at.clientY }
}

function recorder(): Recorder {
  return { moves: [], ends: [], commits: 0, last: null }
}

/**
 * 造一份手势说明书。
 * ⚠ 只有 `'cancelled'` 那一档不落库，另外两档都要 commit。
 */
function specOf(
  rec: Recorder,
  event: PointerEvent,
  kind: Twin2dGestureKind = 'move',
): Twin2dGestureSpec {
  return {
    kind,
    event,
    onMove: (frame) => {
      rec.moves.push(frame)
    },
    onEnd: (frame, end) => {
      rec.ends.push(end)
      rec.last = frame
      if (end !== 'cancelled') rec.commits += 1
    },
  }
}

function mountPointer(
  toDesign: (at: Twin2dClientPoint) => Pt | null = identity,
): { wrapper: ReturnType<typeof mount>; pointer: Twin2dCanvasPointer } {
  const holder = shallowRef<Twin2dCanvasPointer | null>(null)
  const host = defineComponent({
    setup() {
      holder.value = useCanvasPointer({ toDesign })
      return () => h('div')
    },
  })
  const wrapper = mount(host)
  const pointer = holder.value
  if (pointer === null) throw new Error('手势状态机没装上')
  return { wrapper, pointer }
}

function down(x: number, y: number, init: PointerEventInit = {}): PointerEvent {
  return new PointerEvent('pointerdown', { clientX: x, clientY: y, ...init })
}

function fire(
  type: 'pointermove' | 'pointerup' | 'pointercancel',
  x: number,
  y: number,
  init: PointerEventInit = {},
): void {
  window.dispatchEvent(
    new PointerEvent(type, { clientX: x, clientY: y, ...init }),
  )
}

describe('一手势一步撤销', () => {
  it('拖过几十帧也只在松手那一下落一次 commit', () => {
    const { wrapper, pointer } = mountPointer()
    const rec = recorder()

    pointer.start(specOf(rec, down(0, 0)))
    for (let step = 1; step <= 50; step += 1) fire('pointermove', step, step)

    expect(rec.moves).toHaveLength(50)
    expect(rec.commits).toBe(0)

    fire('pointerup', 50, 50)

    expect(rec.ends).toEqual(['done'])
    expect(rec.commits).toBe(1)
    wrapper.unmount()
  })

  it('起手那一帧两种位移都是零，也还没算「拖过」', () => {
    const { wrapper, pointer } = mountPointer()
    const rec = recorder()

    pointer.start(specOf(rec, down(30, 40)))

    expect(pointer.frame.value).toMatchObject({
      kind: 'move',
      from: { x: 30, y: 40 },
      to: { x: 30, y: 40 },
      dx: 0,
      dy: 0,
      clientDx: 0,
      clientDy: 0,
      moved: false,
    })
    wrapper.unmount()
  })

  it('每一帧都带着相对起手点的位移', () => {
    const { wrapper, pointer } = mountPointer()
    const rec = recorder()

    pointer.start(specOf(rec, down(10, 10)))
    fire('pointermove', 40, 30)

    expect(rec.moves[0]).toMatchObject({ dx: 30, dy: 20, moved: true })
    wrapper.unmount()
  })

  it('挪出阈值才算拖过，而且拖回原点也不再变回点击', () => {
    const { wrapper, pointer } = mountPointer()
    const rec = recorder()

    pointer.start(specOf(rec, down(0, 0)))
    fire('pointermove', 2, 0)

    expect(rec.moves[0]?.moved).toBe(false)

    fire('pointermove', 40, 0)
    fire('pointermove', 0, 0)

    expect(rec.moves[2]?.moved).toBe(true)
    wrapper.unmount()
  })

  it('平移画布只认屏幕位移：设计位移全程是零', () => {
    const anchored = (): Pt => ({ x: 500, y: 500 })
    const { wrapper, pointer } = mountPointer(anchored)
    const rec = recorder()

    pointer.start(specOf(rec, down(0, 0), 'pan'))
    fire('pointermove', 80, 60)

    expect(rec.moves[0]).toMatchObject({ dx: 0, dy: 0 })
    expect(rec.moves[0]).toMatchObject({ clientDx: 80, clientDy: 60 })
    wrapper.unmount()
  })

  it('修饰键逐帧带上，Ctrl 与 ⌘ 都算加选', () => {
    const { wrapper, pointer } = mountPointer()
    const rec = recorder()

    pointer.start(specOf(rec, down(0, 0), 'marquee'))
    fire('pointermove', 20, 20, { altKey: true, ctrlKey: true })
    fire('pointermove', 30, 30, { shiftKey: true, metaKey: true })

    expect(rec.moves[0]).toMatchObject({ alt: true, additive: true })
    expect(rec.moves[1]).toMatchObject({ shift: true, additive: true })
    wrapper.unmount()
  })
})

describe('收场', () => {
  it('系统抢走指针时按撤算，一次 commit 都不落', () => {
    const { wrapper, pointer } = mountPointer()
    const rec = recorder()

    pointer.start(specOf(rec, down(0, 0)))
    fire('pointermove', 30, 30)
    fire('pointercancel', 30, 30)

    expect(rec.ends).toEqual(['cancelled'])
    expect(rec.commits).toBe(0)
    expect(pointer.frame.value).toBeNull()
    wrapper.unmount()
  })

  it('主动收场也按撤算', () => {
    const { wrapper, pointer } = mountPointer()
    const rec = recorder()

    pointer.start(specOf(rec, down(0, 0)))
    pointer.cancel()

    expect(rec.ends).toEqual(['cancelled'])
    expect(pointer.kind.value).toBeNull()
    wrapper.unmount()
  })

  it('没有手势时收场是一次空动作', () => {
    const { wrapper, pointer } = mountPointer()

    pointer.cancel()

    expect(pointer.frame.value).toBeNull()
    wrapper.unmount()
  })

  it('松手之后再动指针不再有帧', () => {
    const { wrapper, pointer } = mountPointer()
    const rec = recorder()

    pointer.start(specOf(rec, down(0, 0)))
    fire('pointerup', 10, 10)
    fire('pointermove', 90, 90)

    expect(rec.moves).toEqual([])
    expect(rec.ends).toEqual(['done'])
    wrapper.unmount()
  })

  it('上一次还没收场就起下一手势时，前一次按被顶掉收并照样 commit', () => {
    const { wrapper, pointer } = mountPointer()
    const first = recorder()
    const second = recorder()

    pointer.start(specOf(first, down(0, 0)))
    fire('pointermove', 20, 20)
    pointer.start(specOf(second, down(100, 100), 'marquee'))
    fire('pointermove', 120, 130)

    expect(first.ends).toEqual(['interrupted'])
    expect(first.commits).toBe(1)
    expect(first.moves).toHaveLength(1)
    expect(second.moves).toHaveLength(1)
    expect(pointer.kind.value).toBe('marquee')
    wrapper.unmount()
  })
})

describe('卸载', () => {
  it('拖到一半被卸载时补一次收场，改动照样落一次 commit', () => {
    const { wrapper, pointer } = mountPointer()
    const rec = recorder()

    pointer.start(specOf(rec, down(0, 0)))
    fire('pointermove', 30, 20)
    wrapper.unmount()

    expect(rec.ends).toEqual(['interrupted'])
    expect(rec.commits).toBe(1)
    expect(rec.last).toMatchObject({ dx: 30, dy: 20 })
  })

  it('卸载之后 window 上再动指针一声不响', () => {
    const { wrapper, pointer } = mountPointer()
    const rec = recorder()

    pointer.start(specOf(rec, down(0, 0)))
    wrapper.unmount()
    fire('pointermove', 40, 40)
    fire('pointerup', 40, 40)

    expect(rec.moves).toEqual([])
    expect(rec.ends).toEqual(['interrupted'])
    expect(pointer.frame.value).toBeNull()
  })

  it('没起过手势的卸载不回调任何一次收场', () => {
    const { wrapper, pointer } = mountPointer()

    wrapper.unmount()

    expect(pointer.frame.value).toBeNull()
  })
})

describe('舞台还没挂上', () => {
  it('起点算不出来时手势不起，也不挂监听', () => {
    const { wrapper, pointer } = mountPointer(() => null)
    const rec = recorder()

    const started = pointer.start(specOf(rec, down(0, 0)))
    fire('pointermove', 10, 10)

    expect(started).toBe(false)
    expect(rec.moves).toEqual([])
    expect(pointer.kind.value).toBeNull()
    wrapper.unmount()
  })

  it('手势中途算不出设计坐标时沿用上一帧的落点，不产出 NaN', () => {
    let live = true
    const { wrapper, pointer } = mountPointer((at) =>
      live ? identity(at) : null,
    )
    const rec = recorder()

    pointer.start(specOf(rec, down(0, 0)))
    fire('pointermove', 10, 10)
    live = false
    fire('pointermove', 30, 30)

    expect(rec.moves[1]).toMatchObject({
      to: { x: 10, y: 10 },
      dx: 10,
      clientDx: 30,
    })
    wrapper.unmount()
  })
})
