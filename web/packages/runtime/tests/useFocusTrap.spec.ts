/**
 * @fileoverview 焦点圈养契约：挂载聚焦面板、Tab 到边缘折返、面板空了锁在面板上、
 * 卸载把焦点归还触发元素——键盘用户既出不去，也不会在关闭后被甩回文档开头。
 */
import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, h, ref, type PropType } from 'vue'

import { useFocusTrap } from '../src/useFocusTrap'

/** 圈养宿主：一块 tabindex=-1 的面板，里面按参数摆几颗按钮。 */
const Host = defineComponent({
  props: {
    buttons: { type: Array as PropType<string[]>, default: () => [] },
  },
  setup(props, { expose }) {
    const panel = ref<HTMLElement | null>(null)
    const { trapTab } = useFocusTrap(panel)
    expose({ panel, trapTab })
    return () =>
      h(
        'div',
        { ref: panel, tabindex: '-1', 'data-test': 'panel' },
        props.buttons.map((name) =>
          h('button', { type: 'button', 'data-test': name }, name),
        ),
      )
  },
})

type HostVm = { panel: HTMLElement | null; trapTab: (e: KeyboardEvent) => void }

function mountHost(buttons: string[] = []) {
  return mount(Host, { props: { buttons }, attachTo: document.body })
}

function tab(shiftKey = false): KeyboardEvent {
  return new KeyboardEvent('keydown', {
    key: 'Tab',
    shiftKey,
    cancelable: true,
  })
}

function el(wrapper: ReturnType<typeof mountHost>, name: string): HTMLElement {
  return wrapper.get(`[data-test="${name}"]`).element as HTMLElement
}

describe('挂载与归还', () => {
  it('挂载后初始焦点落在面板上', async () => {
    const wrapper = mountHost(['one'])

    await vi.waitFor(() =>
      expect(document.activeElement).toBe(el(wrapper, 'panel')),
    )
    wrapper.unmount()
  })

  it('卸载把焦点归还挂载前聚焦的元素', async () => {
    const outside = document.createElement('button')
    document.body.append(outside)
    outside.focus()

    const wrapper = mountHost(['one'])
    await vi.waitFor(() =>
      expect(document.activeElement).toBe(el(wrapper, 'panel')),
    )

    wrapper.unmount()
    expect(document.activeElement).toBe(outside)
    outside.remove()
  })
})

describe('Tab 折返', () => {
  it('在最后一个可聚焦元素上 Tab，折回第一个', () => {
    const wrapper = mountHost(['first', 'last'])
    el(wrapper, 'last').focus()

    const event = tab()
    ;(wrapper.vm as unknown as HostVm).trapTab(event)

    expect(event.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(el(wrapper, 'first'))
    wrapper.unmount()
  })

  it('不在边缘时不拦截，交给浏览器顺序走', () => {
    const wrapper = mountHost(['first', 'middle', 'last'])
    el(wrapper, 'first').focus()

    const event = tab()
    ;(wrapper.vm as unknown as HostVm).trapTab(event)

    expect(event.defaultPrevented).toBe(false)
    wrapper.unmount()
  })

  it('在第一个元素上 Shift+Tab，折到最后一个', () => {
    const wrapper = mountHost(['first', 'last'])
    el(wrapper, 'first').focus()

    const event = tab(true)
    ;(wrapper.vm as unknown as HostVm).trapTab(event)

    expect(event.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(el(wrapper, 'last'))
    wrapper.unmount()
  })

  // 初始焦点在面板自身（tabindex=-1 承接）时按 Shift+Tab 也算在开头
  it('焦点还停在面板自身时 Shift+Tab 落到最后一个', () => {
    const wrapper = mountHost(['first', 'last'])
    el(wrapper, 'panel').focus()

    const event = tab(true)
    ;(wrapper.vm as unknown as HostVm).trapTab(event)

    expect(document.activeElement).toBe(el(wrapper, 'last'))
    wrapper.unmount()
  })

  it('面板里一个可聚焦元素都没有时，Tab 锁在面板上', () => {
    const wrapper = mountHost([])
    el(wrapper, 'panel').focus()

    const event = tab()
    ;(wrapper.vm as unknown as HostVm).trapTab(event)

    expect(event.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(el(wrapper, 'panel'))
    wrapper.unmount()
  })

  // happy-dom 不做布局，offsetParent 是 undefined（≠null）故全员可见；
  // 这里用 getter 复刻真浏览器里 display:none 元素的 offsetParent === null
  it('藏起来的元素不算折返边缘', () => {
    const wrapper = mountHost(['first', 'visibleLast', 'hiddenLast'])
    Object.defineProperty(el(wrapper, 'hiddenLast'), 'offsetParent', {
      get: () => null,
    })
    el(wrapper, 'visibleLast').focus()

    const event = tab()
    ;(wrapper.vm as unknown as HostVm).trapTab(event)

    expect(event.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(el(wrapper, 'first'))
    wrapper.unmount()
  })
})
