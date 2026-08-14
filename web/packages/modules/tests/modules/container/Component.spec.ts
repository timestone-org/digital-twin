/**
 * @fileoverview 守容器的渲染契约：子节点走默认插槽、标题条的显隐与内容区内缩算的是
 * 同一件事（错开一边子节点整体偏 28px），以及背景色与背景图各写各的。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import Component from '../../../src/modules/container/Component.vue'
import { resolveContentInset } from '../../../src/shared/container'

const CHILD = '<b class="child">读数子节点</b>'

function render(config: Record<string, unknown>) {
  return mount(Component, {
    props: { config, values: {} },
    slots: { default: CHILD },
  })
}

describe('容器外壳', () => {
  it('子节点渲染在默认插槽里', () => {
    const wrapper = render({})

    expect(wrapper.get('.dt-container__content .child').text()).toBe(
      '读数子节点',
    )
  })

  it('开了标题条才画，并显示标题文字', () => {
    const wrapper = render({ showTitle: true, title: '一号机组' })

    expect(wrapper.get('.dt-container__title').text()).toBe('一号机组')
  })

  it('缺 showTitle 一律按没有标题条算，与内容区内缩同口径', () => {
    const wrapper = render({})

    expect(wrapper.find('.dt-container__bar').exists()).toBe(false)
    expect(resolveContentInset({}).top).toBe(8)
  })

  it('开了标题条时两边一起多让出 28px', () => {
    const config = { showTitle: true, __container: { pad: 12 } }

    expect(render(config).find('.dt-container__bar').exists()).toBe(true)
    expect(resolveContentInset(config).top).toBe(40)
  })

  it('showTitle 存成字符串这类脏值按关着算，不让几何两边分裂', () => {
    const config = { showTitle: 'true' }

    expect(render(config).find('.dt-container__bar').exists()).toBe(false)
    expect(resolveContentInset(config).top).toBe(8)
  })
})

describe('容器外观', () => {
  it('内边距落到内容区', () => {
    const wrapper = render({ __container: { pad: 20 } })

    expect(wrapper.get('.dt-container__content').attributes('style')).toContain(
      'padding: 20px',
    )
  })

  it('内部布局是脏值时回落缺省内边距', () => {
    const wrapper = render({ __container: { pad: 'wide' } })

    expect(wrapper.get('.dt-container__content').attributes('style')).toContain(
      'padding: 8px',
    )
  })

  it('强调色写进外壳的自定义属性', () => {
    const wrapper = render({ accent: 'var(--state-success)' })

    expect(wrapper.get('.dt-container').attributes('style')).toContain(
      '--dt-container-accent: var(--state-success)',
    )
  })

  it('背景色与背景图都留空时一个都不注入', () => {
    const style = render({}).get('.dt-container').attributes('style') ?? ''

    expect(style).not.toContain('background')
  })

  it('只填了背景图时不连带写死背景色', () => {
    const wrapper = render({
      backgroundImage: 'linear-gradient(var(--accent-primary), transparent)',
    })
    const style = wrapper.get('.dt-container').attributes('style') ?? ''

    expect(style).toContain('background-image: linear-gradient')
    expect(style).not.toContain('background-color')
  })

  it('缺省铺点阵，关掉后不再铺', () => {
    expect(render({}).get('.dt-container__content').classes()).toContain(
      'dt-container__content--dotted',
    )
    expect(
      render({ showDotGrid: false }).get('.dt-container__content').classes(),
    ).not.toContain('dt-container__content--dotted')
  })
})
