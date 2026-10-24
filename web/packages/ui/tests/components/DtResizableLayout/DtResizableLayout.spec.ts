/** @fileoverview 布局拖动、响应式切换、存档和资源清理行为。 */
import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, onUnmounted } from 'vue'
import DtResizableLayout from '../../../src/components/DtResizableLayout/DtResizableLayout.vue'

const panes = [
  { id: 'first', label: '第一块', size: 1, minSize: 100 },
  { id: 'second', label: '第二块', size: 1, minSize: 100 },
]
let width = 1000
let height = 600
let notifyResize = (): void => {}
let disconnect = vi.fn()

function render(props: Record<string, unknown> = {}) {
  return mount(DtResizableLayout, {
    props: { panes, ...props },
    slots: { first: '<div>第一块</div>', second: '<div>第二块</div>' },
  })
}
function pointer(type: string, init: PointerEventInit = {}): PointerEvent {
  return new PointerEvent(type, {
    pointerId: 1,
    isPrimary: true,
    button: 0,
    bubbles: true,
    ...init,
  })
}
function move(clientX: number, clientY = 0, pointerId = 1): void {
  window.dispatchEvent(pointer('pointermove', { clientX, clientY, pointerId }))
}
function firstSize(wrapper: ReturnType<typeof render>): number {
  return Number(wrapper.get('[role="separator"]').attributes('aria-valuenow'))
}

beforeEach(() => {
  width = 1000
  height = 600
  localStorage.clear()
  disconnect = vi.fn()
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    () => new DOMRect(0, 0, width, height),
  )
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = vi.fn()
      unobserve = vi.fn()
      disconnect = disconnect
      constructor(callback: ResizeObserverCallback) {
        notifyResize = () => callback([], this)
      }
    },
  )
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('指针调整布局', () => {
  it('水平拖动只按横坐标调整，放开后存档并停止监听', async () => {
    const wrapper = render({ storageKey: 'layout' })
    await nextTick()
    const before = firstSize(wrapper)
    wrapper
      .get('[role="separator"]')
      .element.dispatchEvent(pointer('pointerdown', { clientX: 100 }))
    move(200, 500)
    await nextTick()
    expect(firstSize(wrapper)).toBe(before + 100)
    expect(wrapper.classes()).toContain('dt-resizable-layout--resizing')
    window.dispatchEvent(pointer('pointerup'))
    await nextTick()
    expect(localStorage.getItem('layout.horizontal.first,second')).toContain(
      'first',
    )
    expect(wrapper.classes()).not.toContain('dt-resizable-layout--resizing')
    move(300)
    await nextTick()
    expect(firstSize(wrapper)).toBe(before + 100)
    wrapper.unmount()
  })
  it('纵向拖动按纵坐标调整', async () => {
    const wrapper = render({ direction: 'vertical' })
    await nextTick()
    const before = firstSize(wrapper)
    wrapper
      .get('[role="separator"]')
      .element.dispatchEvent(pointer('pointerdown', { clientY: 100 }))
    move(700, 150)
    await nextTick()
    expect(firstSize(wrapper)).toBe(before + 50)
    wrapper.unmount()
  })
  it('忽略副键、非主指针与其他指针的移动和抬起', async () => {
    const wrapper = render()
    await nextTick()
    const separator = wrapper.get('[role="separator"]').element
    const before = firstSize(wrapper)
    separator.dispatchEvent(pointer('pointerdown', { button: 2 }))
    move(200)
    separator.dispatchEvent(pointer('pointerdown', { isPrimary: false }))
    move(300)
    await nextTick()
    expect(firstSize(wrapper)).toBe(before)
    separator.dispatchEvent(pointer('pointerdown', { clientX: 100 }))
    move(400, 0, 2)
    window.dispatchEvent(pointer('pointerup', { pointerId: 2 }))
    await nextTick()
    expect(firstSize(wrapper)).toBe(before)
    move(130)
    await nextTick()
    expect(firstSize(wrapper)).toBe(before + 30)
    wrapper.unmount()
  })
  it.each(['pointercancel', 'blur'])(
    '%s 结束拖动，后续移动不改变尺寸',
    async (type) => {
      const wrapper = render()
      await nextTick()
      const before = firstSize(wrapper)
      wrapper
        .get('[role="separator"]')
        .element.dispatchEvent(pointer('pointerdown'))
      window.dispatchEvent(type === 'blur' ? new Event('blur') : pointer(type))
      move(100)
      await nextTick()
      expect(firstSize(wrapper)).toBe(before)
      wrapper.unmount()
    },
  )
  it('指针捕获可用时获取并在结束时释放', async () => {
    const wrapper = render()
    await nextTick()
    const target = wrapper.get('[role="separator"]').element
    const capture = vi.fn()
    const release = vi.fn()
    Object.defineProperty(target, 'setPointerCapture', { value: capture })
    Object.defineProperty(target, 'releasePointerCapture', { value: release })
    target.dispatchEvent(pointer('pointerdown'))
    window.dispatchEvent(pointer('pointerup'))
    expect(capture).toHaveBeenCalledWith(1)
    expect(release).toHaveBeenCalledWith(1)
    wrapper.unmount()
  })
})

describe('键盘和偏好', () => {
  it('方向键及 Shift 微调，Home/End 遵守两侧最小尺寸', async () => {
    const wrapper = render()
    await nextTick()
    const separator = wrapper.get('[role="separator"]')
    const before = firstSize(wrapper)
    await separator.trigger('keydown', { key: 'ArrowRight' })
    expect(firstSize(wrapper)).toBe(before + 16)
    await separator.trigger('keydown', { key: 'ArrowLeft', shiftKey: true })
    expect(firstSize(wrapper)).toBe(before - 48)
    await separator.trigger('keydown', { key: 'Home' })
    expect(firstSize(wrapper)).toBe(100)
    await separator.trigger('keydown', { key: 'End' })
    expect(firstSize(wrapper)).toBe(888)
    wrapper.unmount()
  })
  it('纵向只响应上下键，无关键不改变尺寸', async () => {
    const wrapper = render({ direction: 'vertical' })
    await nextTick()
    const before = firstSize(wrapper)
    const separator = wrapper.get('[role="separator"]')
    await separator.trigger('keydown', { key: 'ArrowRight' })
    await separator.trigger('keydown', { key: 'Tab' })
    expect(firstSize(wrapper)).toBe(before)
    await separator.trigger('keydown', { key: 'ArrowDown' })
    expect(firstSize(wrapper)).toBe(before + 16)
    await separator.trigger('keydown', { key: 'ArrowUp' })
    expect(firstSize(wrapper)).toBe(before)
    wrapper.unmount()
  })
  it.each(['dblclick', 'Enter'])('%s 恢复初始比例', async (action) => {
    const wrapper = render()
    await nextTick()
    const before = firstSize(wrapper)
    const separator = wrapper.get('[role="separator"]')
    await separator.trigger('keydown', { key: 'ArrowRight' })
    await separator.trigger(
      action === 'Enter' ? 'keydown' : 'dblclick',
      action === 'Enter' ? { key: 'Enter' } : {},
    )
    expect(firstSize(wrapper)).toBe(before)
    wrapper.unmount()
  })
  it('水平和垂直偏好独立保存，变窄后切换方向并响应高度变化', async () => {
    localStorage.setItem(
      'layout.horizontal.first,second',
      '{"first":1,"second":3}',
    )
    localStorage.setItem(
      'layout.vertical.first,second',
      '{"first":3,"second":1}',
    )
    const wrapper = render({ storageKey: 'layout', stackAt: 700 })
    await nextTick()
    expect(firstSize(wrapper)).toBe(247)
    width = 500
    notifyResize()
    await nextTick()
    expect(wrapper.attributes('data-direction')).toBe('vertical')
    expect(firstSize(wrapper)).toBe(441)
    height = 800
    notifyResize()
    await nextTick()
    expect(firstSize(wrapper)).toBe(591)
    width = 1000
    notifyResize()
    await nextTick()
    expect(firstSize(wrapper)).toBe(247)
    wrapper.unmount()
  })
  it('偏好键改变后读取新布局，而非沿用旧布局尺寸', async () => {
    localStorage.setItem(
      'other.horizontal.first,second',
      '{"first":1,"second":3}',
    )
    const wrapper = render({ storageKey: 'layout' })
    await nextTick()
    await wrapper.setProps({ storageKey: 'other' })
    expect(firstSize(wrapper)).toBe(247)
    wrapper.unmount()
  })
})

describe('布局生命周期', () => {
  it('切换可见区块时保留稳定 id 对应的业务实例', async () => {
    const unmounted = vi.fn()
    const Content = defineComponent({
      setup() {
        onUnmounted(unmounted)
        return () => h('div', 'keep')
      },
    })
    const wrapper = mount(DtResizableLayout, {
      props: { panes: [{ id: 'second' }] },
      slots: { second: () => h(Content), first: () => h('div', 'first') },
    })
    const original = wrapper.get('[data-pane="second"]').element
    await wrapper.setProps({ panes })
    expect(wrapper.get('[data-pane="second"]').element).toBe(original)
    expect(unmounted).not.toHaveBeenCalled()
    wrapper.unmount()
  })
  it('隐藏区块后的调整单独存档，重新显示时恢复完整布局偏好', async () => {
    const full = [...panes, { id: 'third', size: 1, minSize: 100 }]
    const wrapper = render({ panes: full, storageKey: 'layout' })
    await nextTick()
    await wrapper
      .findAll('[role="separator"]')[0]
      ?.trigger('keydown', { key: 'ArrowRight' })
    const saved = firstSize(wrapper)
    await wrapper.setProps({ panes })
    await wrapper
      .get('[role="separator"]')
      .trigger('keydown', { key: 'ArrowRight', shiftKey: true })
    await wrapper.setProps({ panes: full })
    expect(firstSize(wrapper)).toBe(saved)
    wrapper.unmount()
  })
  it('分隔条快捷键不冒泡到画布快捷键', async () => {
    const wrapper = render()
    await nextTick()
    const parentKey = vi.fn()
    wrapper
      .get('.dt-resizable-layout')
      .element.addEventListener('keydown', parentKey)
    const separator = wrapper.get('[role="separator"]')
    await separator.trigger('keydown', { key: 'ArrowRight' })
    await separator.trigger('keydown', { key: 'Enter' })
    expect(parentKey).not.toHaveBeenCalled()
    wrapper.unmount()
  })
  it('丢失指针捕获时结束拖动，捕获不可用时仍能调整', async () => {
    const wrapper = render()
    await nextTick()
    const target = wrapper.get('[role="separator"]').element
    Object.defineProperty(target, 'setPointerCapture', {
      value: () => {
        throw new Error('unavailable')
      },
    })
    target.dispatchEvent(pointer('pointerdown'))
    move(30)
    await nextTick()
    const saved = firstSize(wrapper)
    target.dispatchEvent(pointer('lostpointercapture'))
    move(60)
    await nextTick()
    expect(firstSize(wrapper)).toBe(saved)
    wrapper.unmount()
  })
  it('卸载时移除事件监听并断开尺寸观察器', async () => {
    const removed = vi.spyOn(window, 'removeEventListener')
    const wrapper = render()
    await nextTick()
    wrapper
      .get('[role="separator"]')
      .element.dispatchEvent(pointer('pointerdown'))
    wrapper.unmount()
    expect(disconnect).toHaveBeenCalledOnce()
    for (const event of [
      'pointermove',
      'pointerup',
      'pointercancel',
      'blur',
      'resize',
    ])
      expect(removed.mock.calls.some(([name]) => name === event)).toBe(true)
  })
  it('空布局仍提供有效的栅格尺寸', () => {
    const wrapper = render({ panes: [] })
    expect(wrapper.find('[role="separator"]').exists()).toBe(false)
    expect(wrapper.attributes('style')).toContain('minmax(0, 1fr)')
    wrapper.unmount()
  })
  it('浏览器提前释放捕获不会中断正常结束', async () => {
    const wrapper = render()
    await nextTick()
    const target = wrapper.get('[role="separator"]').element
    Object.defineProperty(target, 'setPointerCapture', { value: vi.fn() })
    Object.defineProperty(target, 'releasePointerCapture', {
      value: () => {
        throw new Error('already released')
      },
    })
    target.dispatchEvent(pointer('pointerdown'))
    expect(() => window.dispatchEvent(pointer('pointerup'))).not.toThrow()
    wrapper.unmount()
  })
  it('缺少 ResizeObserver 时仍可响应窗口调整；零尺寸不会破坏布局', async () => {
    vi.stubGlobal('ResizeObserver', undefined)
    const wrapper = render()
    await nextTick()
    const before = firstSize(wrapper)
    width = 0
    height = 0
    window.dispatchEvent(new Event('resize'))
    await nextTick()
    expect(firstSize(wrapper)).toBe(before)
    width = 600
    height = 500
    window.dispatchEvent(new Event('resize'))
    await nextTick()
    expect(firstSize(wrapper)).toBe(294)
    wrapper.unmount()
  })
})
