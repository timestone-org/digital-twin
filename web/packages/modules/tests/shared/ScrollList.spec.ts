/**
 * @fileoverview 守自动滚动视口：溢出才滚、滚起来才复制第二份内容，
 * ⚠ 「减少动态」必须退回**原生滚动**而不是只停动画——视口是 overflow:hidden，
 * 光停动画会让折叠线以下的条目再也看不到，那是数据被静默截断。
 * 另守卸载清理：大屏一开就是几天，漏一个 Observer 就持续累积一份。
 */
import { mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import ScrollList from '../../src/shared/ScrollList.vue'

// 桩住 ResizeObserver 是为了拿到量高回调的把手（happy-dom 自带一份，但不会真的布局）
let remeasure: () => void = () => undefined
let disconnectCount = 0

class ObserverStub {
  constructor(callback: () => void) {
    remeasure = callback
  }

  observe(): void {
    return undefined
  }

  unobserve(): void {
    return undefined
  }

  disconnect(): void {
    disconnectCount += 1
  }
}

/** 桩住「减少动态」偏好，并留下改主意的口子。 */
function stubMotion(matches: boolean) {
  const listeners = new Set<(event: { matches: boolean }) => void>()
  const addEventListener = vi.fn(
    (_type: string, listener: (event: { matches: boolean }) => void) => {
      listeners.add(listener)
    },
  )
  const removeEventListener = vi.fn(
    (_type: string, listener: (event: { matches: boolean }) => void) => {
      listeners.delete(listener)
    },
  )
  vi.stubGlobal('matchMedia', () => ({
    matches,
    addEventListener,
    removeEventListener,
  }))
  return {
    removeEventListener,
    change(next: boolean) {
      for (const listener of listeners) listener({ matches: next })
    },
  }
}

/** 可控帧：手动放帧才跑回调，方便断言「连发只保留最后一帧」。 */
function stubFrames() {
  const frames = new Map<number, FrameRequestCallback>()
  let nextId = 0
  const cancel = vi.fn((handle: number) => {
    frames.delete(handle)
  })
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    nextId += 1
    frames.set(nextId, callback)
    return nextId
  })
  vi.stubGlobal('cancelAnimationFrame', cancel)
  return {
    cancel,
    pending: () => frames.size,
    flush() {
      const callbacks = [...frames.values()]
      frames.clear()
      for (const callback of callbacks) callback(0)
    },
  }
}

interface Scene {
  /** 一份内容的高度。 */
  contentPx: number
  viewportPx: number
  itemCount?: number
  autoScroll?: boolean
  secondsPerItem?: number
}

async function render(scene: Scene) {
  vi.stubGlobal('ResizeObserver', ObserverStub)
  const wrapper = mount(ScrollList, {
    props: {
      itemCount: scene.itemCount ?? 5,
      autoScroll: scene.autoScroll ?? true,
      secondsPerItem: scene.secondsPerItem ?? 3,
    },
    slots: { default: '<div class="row">一行</div>' },
  })
  Object.defineProperty(
    wrapper.get('.dt-scrolllist__copy').element,
    'scrollHeight',
    {
      configurable: true,
      get: () => scene.contentPx,
    },
  )
  Object.defineProperty(wrapper.get('.dt-scrolllist').element, 'clientHeight', {
    configurable: true,
    get: () => scene.viewportPx,
  })
  remeasure()
  await wrapper.vm.$nextTick()
  return wrapper
}

function isRolling(wrapper: VueWrapper): boolean {
  return wrapper
    .get('.dt-scrolllist__track')
    .classes()
    .includes('dt-scrolllist__track--anim')
}

afterEach(() => {
  disconnectCount = 0
  vi.unstubAllGlobals()
})

describe('滚不滚', () => {
  it('溢出且开着自动滚动就滚起来', async () => {
    stubMotion(false)
    const wrapper = await render({ contentPx: 300, viewportPx: 200 })

    expect(isRolling(wrapper)).toBe(true)
    expect(wrapper.get('.dt-scrolllist').classes()).not.toContain(
      'dt-scrolllist--static',
    )
    wrapper.unmount()
  })

  it('不溢出就退回原生滚动条', async () => {
    stubMotion(false)
    const wrapper = await render({ contentPx: 100, viewportPx: 200 })

    expect(isRolling(wrapper)).toBe(false)
    expect(wrapper.get('.dt-scrolllist').classes()).toContain(
      'dt-scrolllist--static',
    )
    wrapper.unmount()
  })

  it('只差一像素不算溢出', async () => {
    stubMotion(false)
    const wrapper = await render({ contentPx: 201, viewportPx: 200 })

    expect(isRolling(wrapper)).toBe(false)
    wrapper.unmount()
  })

  it('关了自动滚动就算溢出也不滚', async () => {
    stubMotion(false)
    const wrapper = await render({
      contentPx: 800,
      viewportPx: 200,
      autoScroll: false,
    })

    expect(isRolling(wrapper)).toBe(false)
    wrapper.unmount()
  })

  it('一个条目都没有时不滚', async () => {
    stubMotion(false)
    const wrapper = await render({
      contentPx: 800,
      viewportPx: 200,
      itemCount: 0,
    })

    expect(isRolling(wrapper)).toBe(false)
    wrapper.unmount()
  })
})

describe('减少动态', () => {
  it('挂载时就开着偏好，直接退回原生滚动而不是停在原地', async () => {
    stubMotion(true)
    const wrapper = await render({ contentPx: 800, viewportPx: 200 })

    expect(isRolling(wrapper)).toBe(false)
    expect(wrapper.get('.dt-scrolllist').classes()).toContain(
      'dt-scrolllist--static',
    )
    wrapper.unmount()
  })

  it('运行期改了偏好也跟着退回原生滚动', async () => {
    const motion = stubMotion(false)
    const wrapper = await render({ contentPx: 800, viewportPx: 200 })
    expect(isRolling(wrapper)).toBe(true)

    motion.change(true)
    await wrapper.vm.$nextTick()

    expect(isRolling(wrapper)).toBe(false)
    expect(wrapper.get('.dt-scrolllist').classes()).toContain(
      'dt-scrolllist--static',
    )
    wrapper.unmount()
  })
})

describe('滚起来之后', () => {
  it('复制第二份内容做无缝衔接，副本读屏跳过', async () => {
    stubMotion(false)
    const wrapper = await render({ contentPx: 300, viewportPx: 200 })
    const copies = wrapper.findAll('.dt-scrolllist__copy')

    expect(copies).toHaveLength(2)
    expect(copies[1]?.attributes('aria-hidden')).toBe('true')
    expect(copies[1]?.find('.row').exists()).toBe(true)
    wrapper.unmount()
  })

  it('不滚时只有一份内容', async () => {
    stubMotion(false)
    const wrapper = await render({ contentPx: 100, viewportPx: 200 })

    expect(wrapper.findAll('.dt-scrolllist__copy')).toHaveLength(1)
    wrapper.unmount()
  })

  it('位移一份内容的高度，时长按每项秒数算', async () => {
    stubMotion(false)
    const wrapper = await render({
      contentPx: 300,
      viewportPx: 200,
      itemCount: 5,
    })
    const style = wrapper.get('.dt-scrolllist__track').attributes('style') ?? ''

    expect(style).toContain('--dt-scroll-distance: -300px')
    expect(style).toContain('animation-duration: 15s')
    wrapper.unmount()
  })

  it('条目少时按下限 4 秒，不至于一闪而过', async () => {
    stubMotion(false)
    const wrapper = await render({
      contentPx: 300,
      viewportPx: 200,
      itemCount: 1,
    })

    expect(wrapper.get('.dt-scrolllist__track').attributes('style')).toContain(
      'animation-duration: 4s',
    )
    wrapper.unmount()
  })

  it('不滚时不写内联样式', async () => {
    stubMotion(false)
    const wrapper = await render({ contentPx: 100, viewportPx: 200 })

    expect(
      wrapper.get('.dt-scrolllist__track').attributes('style'),
    ).toBeUndefined()
    wrapper.unmount()
  })
})

describe('条目数变化', () => {
  it('等下一帧再量，这一帧的 DOM 还是上一批', async () => {
    stubMotion(false)
    const frames = stubFrames()
    const wrapper = await render({ contentPx: 100, viewportPx: 200 })

    Object.defineProperty(
      wrapper.get('.dt-scrolllist__copy').element,
      'scrollHeight',
      { configurable: true, get: () => 900 },
    )
    await wrapper.setProps({ itemCount: 20 })
    expect(isRolling(wrapper)).toBe(false)

    frames.flush()
    await wrapper.vm.$nextTick()

    expect(isRolling(wrapper)).toBe(true)
    wrapper.unmount()
  })

  it('连着变只保留最后一帧', async () => {
    stubMotion(false)
    const frames = stubFrames()
    const wrapper = await render({ contentPx: 100, viewportPx: 200 })

    await wrapper.setProps({ itemCount: 6 })
    await wrapper.setProps({ itemCount: 7 })

    expect(frames.cancel).toHaveBeenCalledTimes(1)
    expect(frames.pending()).toBe(1)
    wrapper.unmount()
  })
})

describe('卸载清理', () => {
  it('Observer 与偏好监听都摘掉', async () => {
    const motion = stubMotion(false)
    const wrapper = await render({ contentPx: 300, viewportPx: 200 })

    wrapper.unmount()

    expect(disconnectCount).toBe(1)
    expect(motion.removeEventListener).toHaveBeenCalledTimes(1)
  })

  it('挂起的量高帧一并取消', async () => {
    stubMotion(false)
    const frames = stubFrames()
    const wrapper = await render({ contentPx: 100, viewportPx: 200 })
    await wrapper.setProps({ itemCount: 9 })

    wrapper.unmount()

    expect(frames.pending()).toBe(0)
  })

  it('没有挂起的帧时不多此一举', async () => {
    stubMotion(false)
    const frames = stubFrames()
    const wrapper = await render({ contentPx: 100, viewportPx: 200 })

    wrapper.unmount()

    expect(frames.cancel).not.toHaveBeenCalled()
  })
})
