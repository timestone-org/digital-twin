/**
 * @fileoverview 守视点切换的口径：关掉就不显示、`items` 决定显示哪几个与顺序、
 * 悬空 id 不占位、数字键与方括号键切换、输入框里打字不抢键。
 */
import { normalizeTwinConfig, type TwinConfig } from '@dt/twin-config'
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { defineComponent, h, type PropType } from 'vue'

import {
  useViewpointSwitch,
  type ViewpointSwitch,
} from '../src/useViewpointSwitch'

function config(viewpoints: Record<string, unknown> = {}): TwinConfig {
  return normalizeTwinConfig({
    model: { asset: 'asset:0192f0aa-0000-7000-8000-000000000001' },
    cameras: [
      { id: 'c1', name: '总览', position: [1, 0, 0], target: [0, 0, 0] },
      { id: 'c2', name: '侧面', position: [0, 1, 0], target: [0, 0, 0] },
      { id: 'c3', name: '顶视', position: [0, 0, 1], target: [0, 0, 0] },
    ],
    // 归一化里 enabled / keyboard 都默认关，用例基线一律显式打开
    viewpoints: { enabled: true, keyboard: true, ...viewpoints },
  })
}

/**
 * 在真组件里装配：这个组合式函数自己注册 `onBeforeUnmount`，
 * 脱离组件上下文调用拿不到卸载路径，也一路刷 Vue 警告。
 */
function setup(viewpoints: Record<string, unknown> = {}) {
  const switched: string[] = []
  const settings = config(viewpoints)
  // 装在对象上而不是裸 let：赋值发生在 setup 的闭包里，TS 的控制流分析看不到，
  // 裸变量会被缩窄成 never
  const held: { api: ViewpointSwitch | null } = { api: null }

  const Host = defineComponent({
    props: {
      config: { type: Object as PropType<TwinConfig>, required: true },
    },
    setup(props) {
      const element = { current: null as HTMLElement | null }
      held.api = useViewpointSwitch({
        element: () => element.current,
        config: () => props.config,
        onSwitch: (camera) => switched.push(camera.id),
      })
      return () =>
        h('div', { ref: (el) => (element.current = el as HTMLElement) })
    },
  })

  const wrapper = mount(Host, {
    props: { config: settings },
    attachTo: document.body,
  })
  const api = held.api
  if (api === null) throw new Error('组合式函数还没挂起来')
  api.attach()
  return {
    api,
    element: wrapper.element as HTMLElement,
    switched,
    wrapper,
  }
}

function press(element: HTMLElement, key: string): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, cancelable: true })
  element.dispatchEvent(event)
  return event
}

describe('要显示哪几个', () => {
  it('开关关着时一个都不显示', () => {
    const { api } = setup({ enabled: false })

    expect(api.items.value).toHaveLength(0)
  })

  it('没列 items 时按视点的文档序全显示', () => {
    const { api } = setup()

    expect(api.items.value.map((item) => item.id)).toEqual(['c1', 'c2', 'c3'])
  })

  it('列了 items 就按它的顺序，且只显示列到的', () => {
    const { api } = setup({ items: ['c3', 'c1'] })

    expect(api.items.value.map((item) => item.id)).toEqual(['c3', 'c1'])
  })

  // 留着会画出一个点了没反应的按钮
  it('指向已删视点的 id 直接跳过，不占位', () => {
    const { api } = setup({ items: ['c1', 'ghost', 'c2'] })

    expect(api.items.value.map((item) => item.id)).toEqual(['c1', 'c2'])
  })
})

describe('切换', () => {
  it('点一个视点把它交给宿主，并记成当前', () => {
    const { api, switched } = setup()

    api.switchTo('c2')

    expect(switched).toEqual(['c2'])
    expect(api.activeId.value).toBe('c2')
  })

  it('切一个不在清单里的 id 什么都不做', () => {
    const { api, switched } = setup({ items: ['c1'] })

    api.switchTo('c3')

    expect(switched).toEqual([])
    expect(api.activeId.value).toBe('')
  })
})

describe('键盘', () => {
  it('数字键切到对应那一个', () => {
    const { element, switched } = setup()

    press(element, '2')

    expect(switched).toEqual(['c2'])
  })

  it('数字超出清单长度时不动，也不拦掉这次按键', () => {
    const { element, switched } = setup({ items: ['c1'] })

    const event = press(element, '5')

    expect(switched).toEqual([])
    expect(event.defaultPrevented).toBe(false)
  })

  it('方括号在清单里前后翻，且首尾相接', () => {
    const { api, element, switched } = setup()
    api.switchTo('c1')

    press(element, ']')
    press(element, ']')
    press(element, ']')

    expect(switched).toEqual(['c1', 'c2', 'c3', 'c1'])
  })

  it('左方括号往回翻', () => {
    const { api, element, switched } = setup()
    api.switchTo('c2')

    press(element, '[')

    expect(switched.at(-1)).toBe('c1')
  })

  it('还没切过时从第一个开始翻', () => {
    const { element, switched } = setup()

    press(element, ']')

    expect(switched).toEqual(['c2'])
  })

  it('keyboard 关着时数字键不响应', () => {
    const { element, switched } = setup({ keyboard: false })

    press(element, '1')

    expect(switched).toEqual([])
  })

  // ⚠ 在输入框里按数字不该把镜头甩走
  it('焦点在输入框里时不抢键', () => {
    const { element, switched } = setup()
    const input = document.createElement('input')
    element.append(input)

    const event = new KeyboardEvent('keydown', { key: '1', cancelable: true })
    input.dispatchEvent(event)

    expect(switched).toEqual([])
  })

  it('摘掉监听之后不再响应', () => {
    const { api, element, switched } = setup()

    api.detach()
    press(element, '1')

    expect(switched).toEqual([])
  })

  // ⚠ 不指望宿主记得调 detach：漏一次就是一个吃着按键的死监听
  it('组件卸载后监听自己摘掉', () => {
    const { element, switched, wrapper } = setup()

    wrapper.unmount()
    press(element, '1')

    expect(switched).toEqual([])
  })
})

describe('清单为空时', () => {
  it('键盘什么都不做，不炸', () => {
    const { element, switched } = setup({ enabled: false })

    expect(() => press(element, '1')).not.toThrow()
    expect(switched).toEqual([])
  })
})

describe('只挂在宿主上', () => {
  // 同一页放两块大屏时，键盘只该管鼠标所在的那块
  it('不往 window 上挂监听', () => {
    const spy = vi.spyOn(window, 'addEventListener')

    setup()

    expect(spy).not.toHaveBeenCalledWith('keydown', expect.anything())
    spy.mockRestore()
  })
})
