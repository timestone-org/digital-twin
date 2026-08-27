/**
 * @fileoverview 契约：视口壳把取景、缩放、平移与指针总线收在一处——一次平移只改视口
 * 这份纯状态、按累计位移走且松手才收一次场，卸载把 window 上的监听与 `ResizeObserver`
 * 一起摘干净，各层从插槽里接手势与换算，而 sprite 宿主在这里挂了且只挂一次。
 *
 * ⚠ 漏挂 sprite 时图标**静默消失**：`<use>` 元素照样在，只是解析不到任何目标。
 * ⚠ 卸载不摘监听同样不报错：离开这一页之后，整站的指针事件都还在被它拦。
 * ⚠ 容器 0×0（首帧、被隐藏的页签）时取景算出 NaN，`translate(NaN, NaN)` 让整块空白。
 */
import { Twin2dIconSprite, normalizeCanvas } from '@dt/twin2d'
import type { Pt } from '@dt/twin2d'
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { h } from 'vue'

import EditorCanvas from '@/pages/Twin2dEditor/components/EditorCanvas.vue'
import type {
  Twin2dGestureEnd,
  Twin2dGestureFrame,
  Twin2dGestureSpec,
} from '@/pages/Twin2dEditor/scripts/useCanvasPointer'
import {
  fitView,
  toDesignPoint,
} from '@/pages/Twin2dEditor/scripts/viewportOps'
import type {
  Twin2dViewBox,
  Twin2dViewport,
} from '@/pages/Twin2dEditor/scripts/viewportOps'

/** 画布 400×200：非方形，两轴写反了才看得出来。 */
const CANVAS = normalizeCanvas({
  width: 400,
  height: 200,
  grid: 20,
  showGrid: true,
})

/** 容器尺寸必须显式给：happy-dom 的 getBoundingClientRect 恒 0，量出来是 0×0。 */
const BOX: Twin2dViewBox = { width: 800, height: 600 }

/**
 * 各层从插槽里拿到的那一套，只列用例要用的四样。
 * ⚠ 不从 `EditorCanvas.vue` 里 import 那个接口：typescript-eslint 解析不出 `.vue` 的
 * 模块，一 import 整段就成了 error 类型（eslint 配置里 story 那一条同因）。名字对不上
 * 时这里编译照过，靠下面几条在运行期红。
 */
interface CanvasApi {
  view: Twin2dViewport
  toDesign: (at: { clientX: number; clientY: number }) => Pt | null
  toLocal: (design: Pt) => Pt
  startGesture: (spec: Twin2dGestureSpec) => boolean
}

/** 收下插槽递来的那一套；各层拿到的就是这一份。 */
interface ApiHolder {
  api: CanvasApi | null
}

/** 一次手势的现场记录。 */
interface Recorder {
  frames: Twin2dGestureFrame[]
  ends: Twin2dGestureEnd[]
}

afterEach(() => {
  vi.unstubAllGlobals()
})

function mountCanvas(box: Twin2dViewBox | null = BOX, panMode = false) {
  return mount(EditorCanvas, {
    props: { canvas: CANVAS, hostSize: box, panMode },
  })
}

type Wrapper = ReturnType<typeof mountCanvas>

function views(wrapper: Wrapper): Twin2dViewport[] {
  const events = wrapper.emitted<[Twin2dViewport]>('viewChange') ?? []
  return events.map((args) => args[0])
}

function lastView(wrapper: Wrapper): Twin2dViewport {
  const last = views(wrapper).at(-1)
  if (last === undefined) throw new Error('视口一次都没广播')
  return last
}

function stageStyleOf(wrapper: Wrapper): string {
  return wrapper.get('[data-test="canvas-stage"]').attributes('style') ?? ''
}

async function press(
  wrapper: Wrapper,
  button: number,
  at: { x: number; y: number } = { x: 100, y: 100 },
): Promise<void> {
  await wrapper.get('[data-test="canvas-host"]').trigger('pointerdown', {
    button,
    clientX: at.x,
    clientY: at.y,
  })
}

function fire(
  type: 'pointermove' | 'pointerup' | 'pointercancel',
  x: number,
  y: number,
): void {
  window.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y }))
}

describe('sprite 宿主', () => {
  it('画布里挂了一次，且只挂一次', () => {
    const wrapper = mountCanvas()

    expect(wrapper.findAllComponents(Twin2dIconSprite)).toHaveLength(1)
  })
})

describe('取景', () => {
  it('头一次量到容器就自动取一次景', () => {
    const wrapper = mountCanvas()

    expect(lastView(wrapper)).toEqual(fitView(CANVAS, BOX))
    expect(stageStyleOf(wrapper)).toContain('width: 400px')
  })

  it('容器 0×0 时既不取景也不产出 NaN', () => {
    const wrapper = mountCanvas({ width: 0, height: 0 })

    expect(wrapper.emitted('viewChange')).toBeUndefined()
    expect(stageStyleOf(wrapper)).not.toContain('NaN')
    expect(stageStyleOf(wrapper)).toContain('scale(1)')
  })

  it('「适应」信号每加一次就重新取一次景', async () => {
    const wrapper = mountCanvas()
    await wrapper.get('[data-test="canvas-host"]').trigger('wheel', {
      deltaY: -100,
      clientX: 300,
      clientY: 200,
    })
    expect(lastView(wrapper)).not.toEqual(fitView(CANVAS, BOX))

    await wrapper.setProps({ fitRequest: 1 })

    expect(lastView(wrapper)).toEqual(fitView(CANVAS, BOX))
  })
})

describe('缩放', () => {
  it('工具栏那一档锚在视口正中，正中底下的设计坐标一动不动', () => {
    const wrapper = mountCanvas()
    const center = { x: BOX.width / 2, y: BOX.height / 2 }
    const before = toDesignPoint(lastView(wrapper), center)

    wrapper.vm.zoomBy(2)

    const after = lastView(wrapper)
    expect(after.scale).toBeCloseTo(fitView(CANVAS, BOX).scale * 2)
    expect(toDesignPoint(after, center).x).toBeCloseTo(before.x)
    expect(toDesignPoint(after, center).y).toBeCloseTo(before.y)
  })

  it('滚轮以指针为锚：锚点底下的设计坐标一动不动', async () => {
    const wrapper = mountCanvas()
    const anchor = { x: 300, y: 200 }
    const before = toDesignPoint(lastView(wrapper), anchor)

    await wrapper.get('[data-test="canvas-host"]').trigger('wheel', {
      deltaY: -100,
      clientX: anchor.x,
      clientY: anchor.y,
    })

    const after = lastView(wrapper)
    expect(after.scale).toBeGreaterThan(fitView(CANVAS, BOX).scale)
    expect(toDesignPoint(after, anchor).x).toBeCloseTo(before.x)
    expect(toDesignPoint(after, anchor).y).toBeCloseTo(before.y)
  })
})

describe('平移', () => {
  it('中键拖动只挪视口，倍率一动不动', async () => {
    const wrapper = mountCanvas()
    const base = lastView(wrapper)

    await press(wrapper, 1)
    fire('pointermove', 140, 130)

    expect(lastView(wrapper)).toEqual({
      scale: base.scale,
      tx: base.tx + 40,
      ty: base.ty + 30,
    })
    fire('pointerup', 140, 130)
    wrapper.unmount()
  })

  it('每一帧都按起手以来的累计位移算，不是逐帧再加一次', async () => {
    const wrapper = mountCanvas()
    const base = lastView(wrapper)

    await press(wrapper, 1)
    fire('pointermove', 110, 100)
    fire('pointermove', 130, 100)

    expect(lastView(wrapper).tx).toBe(base.tx + 30)
    fire('pointerup', 130, 100)
    wrapper.unmount()
  })

  it('松手那一下收一次场，之后的指针移动不再改视口', async () => {
    const wrapper = mountCanvas()

    await press(wrapper, 1)
    fire('pointermove', 130, 100)
    fire('pointerup', 130, 100)
    const settled = lastView(wrapper)
    fire('pointermove', 400, 400)

    expect(lastView(wrapper)).toEqual(settled)
    wrapper.unmount()
  })

  it('手型工具下左键即平移，这一按不算点空白', async () => {
    const wrapper = mountCanvas(BOX, true)
    const base = lastView(wrapper)

    await press(wrapper, 0)
    fire('pointermove', 160, 100)

    expect(lastView(wrapper).tx).toBe(base.tx + 60)
    expect(wrapper.emitted('backgroundDown')).toBeUndefined()
    fire('pointerup', 160, 100)
    wrapper.unmount()
  })

  it('中途取消退回起手时的视口', async () => {
    const wrapper = mountCanvas()
    const base = lastView(wrapper)

    await press(wrapper, 1)
    fire('pointermove', 300, 300)
    fire('pointercancel', 300, 300)

    expect(lastView(wrapper)).toEqual(base)
    wrapper.unmount()
  })
})

describe('点空白', () => {
  it('左键按在空白上抛给页面去清选中或起框选', async () => {
    const wrapper = mountCanvas()

    await press(wrapper, 0)

    expect(wrapper.emitted('backgroundDown')).toHaveLength(1)
  })

  it('右键不抛：那一按留给右键菜单', async () => {
    const wrapper = mountCanvas()

    await press(wrapper, 2)

    expect(wrapper.emitted('backgroundDown')).toBeUndefined()
  })
})

describe('交给各层的那一套', () => {
  it('插槽递出视口与两个方向的换算', () => {
    const seen: ApiHolder = { api: null }
    const wrapper = mount(EditorCanvas, {
      props: { canvas: CANVAS, hostSize: BOX },
      slots: {
        default: (api: CanvasApi) => {
          seen.api = api
          return h('i', { 'data-test': 'layer' })
        },
      },
    })

    const api = seen.api
    if (api === null) throw new Error('插槽没拿到画布那一套')
    expect(api.view).toEqual(lastView(wrapper))
    expect(api.toDesign({ clientX: 240, clientY: 130 })).toEqual(
      toDesignPoint(api.view, { x: 240, y: 130 }),
    )
    expect(api.toLocal({ x: 0, y: 0 })).toEqual({
      x: api.view.tx,
      y: api.view.ty,
    })
  })

  it('宿主没了之后换算回 null，不是把 NaN 交给还攥着这一套的层', () => {
    const seen: ApiHolder = { api: null }
    const wrapper = mount(EditorCanvas, {
      props: { canvas: CANVAS, hostSize: BOX },
      slots: {
        default: (api: CanvasApi) => {
          seen.api = api
          return h('i')
        },
      },
    })
    const api = seen.api
    if (api === null) throw new Error('插槽没拿到画布那一套')

    wrapper.unmount()

    expect(api.toDesign({ clientX: 240, clientY: 130 })).toBeNull()
  })

  it('各层从插槽里起的手势按当前视口换算落点，且一点不碰视口', () => {
    const seen: ApiHolder = { api: null }
    const rec: Recorder = { frames: [], ends: [] }
    const wrapper = mount(EditorCanvas, {
      props: { canvas: CANVAS, hostSize: BOX },
      slots: {
        default: (api: CanvasApi) => {
          seen.api = api
          return h('i')
        },
      },
    })
    const api = seen.api
    if (api === null) throw new Error('插槽没拿到画布那一套')
    const settled = lastView(wrapper)

    api.startGesture({
      kind: 'move',
      event: new PointerEvent('pointerdown', { clientX: 200, clientY: 100 }),
      onMove: (frame) => rec.frames.push(frame),
      onEnd: (frame, end) => {
        rec.frames.push(frame)
        rec.ends.push(end)
      },
    })
    fire('pointermove', 240, 130)
    fire('pointerup', 240, 130)

    expect(rec.frames[0]?.to).toEqual(
      toDesignPoint(settled, { x: 240, y: 130 }),
    )
    expect(rec.ends).toEqual(['done'])
    expect(lastView(wrapper)).toEqual(settled)
  })
})

describe('卸载', () => {
  it('拖到一半卸载：补一次收场，拖出来的那段位移不退回去', async () => {
    const wrapper = mountCanvas()
    const base = lastView(wrapper)
    await press(wrapper, 1)
    fire('pointermove', 140, 100)

    wrapper.unmount()

    expect(lastView(wrapper).tx).toBe(base.tx + 40)
  })

  it('卸载之后 window 上不再留下任何一副指针监听', async () => {
    const wrapper = mountCanvas()
    await press(wrapper, 1)
    fire('pointermove', 140, 100)
    wrapper.unmount()
    const settled = views(wrapper).length

    fire('pointermove', 400, 400)
    fire('pointerup', 400, 400)

    expect(views(wrapper)).toHaveLength(settled)
  })

  it('卸载摘掉 ResizeObserver', () => {
    const disconnect = vi.fn()
    const observe = vi.fn()
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe = observe
        disconnect = disconnect
      },
    )
    const wrapper = mountCanvas(null)
    expect(observe).toHaveBeenCalledTimes(1)

    wrapper.unmount()

    expect(disconnect).toHaveBeenCalledTimes(1)
  })
})
