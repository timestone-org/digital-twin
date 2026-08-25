/**
 * @fileoverview 契约：助手图标同屏会出现多份（面板徽标 + 空态），
 * SVG 的渐变/滤镜 id 必须按实例隔离——同名的话后一份会引用到前一份的
 * defs 上，实例一卸载另一份就整只失色。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { defineComponent, h } from 'vue'

import AiCoreIcon from '@/components/ai/AiCoreIcon.vue'

describe('AiCoreIcon', () => {
  it('按 size 出方形', () => {
    const svg = mount(AiCoreIcon, { props: { size: 52 } }).find('svg')
    expect(svg.attributes('width')).toBe('52')
    expect(svg.attributes('height')).toBe('52')
  })

  it('对读屏是装饰件，标签由宿主自己给', () => {
    const svg = mount(AiCoreIcon).find('svg')
    expect(svg.attributes('aria-hidden')).toBe('true')
  })

  it('同一个应用里挂两份，defs id 互不相同', () => {
    // ⚠ 必须挂在同一个 app 下：useId 的计数是按 app 算的，
    // 两次独立 mount 各起一个 app，id 恒撞车，测不出真实形态
    const pair = defineComponent({
      render: () => h('div', [h(AiCoreIcon), h(AiCoreIcon)]),
    })
    const ids = mount(pair)
      .findAll('[id]')
      .map((node) => node.attributes('id'))
    expect(ids.length).toBeGreaterThan(0)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('子件的元素挂在 SVG 命名空间里，而不是 HTML', () => {
    // ⚠ 机器人本体隔着一层子组件：Vue 若没把 SVG 命名空间传过组件边界，
    // 元素会按 HTML 建出来——DOM 树看着一样，真浏览器里整只空白
    const g = mount(AiCoreIcon).find('g.bot')
    expect(g.exists()).toBe(true)
    expect(g.element.namespaceURI).toBe('http://www.w3.org/2000/svg')
  })

  it('url(#…) 引用全部指向自己实例的 defs', () => {
    const wrapper = mount(AiCoreIcon)
    const ids = wrapper.findAll('[id]').map((node) => node.attributes('id'))
    const marker = 'url(#'
    const refs = wrapper
      .findAll('[fill], [stroke], [filter], [clip-path]')
      .flatMap((node) =>
        ['fill', 'stroke', 'filter', 'clip-path'].map((key) =>
          node.attributes(key),
        ),
      )
      .filter((value): value is string => value?.startsWith(marker) === true)
      .map((value) => value.slice(marker.length, -1))
    expect(refs.length).toBeGreaterThan(0)
    for (const target of refs) expect(ids).toContain(target)
  })
})
