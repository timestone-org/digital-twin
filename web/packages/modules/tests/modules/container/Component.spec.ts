/**
 * @fileoverview 守容器的渲染契约：子节点走默认插槽、标题条的显隐与内容区内缩算的是
 * 同一件事（错开一边子节点整体偏 28px），以及背景色与背景图各写各的。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import Component from '../../../src/modules/container/Component.vue'
import manifest from '../../../src/modules/container/manifest'
import { configDefaults } from '../../../src/shared/config'
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
    expect(resolveContentInset({}, manifest).top).toBe(8)
  })

  it('开了标题条时两边一起多让出 28px', () => {
    const config = { showTitle: true, __container: { pad: 12 } }

    expect(render(config).find('.dt-container__bar').exists()).toBe(true)
    expect(resolveContentInset(config, manifest).top).toBe(40)
  })

  it('showTitle 存成字符串这类脏值按关着算，不让几何两边分裂', () => {
    const config = { showTitle: 'true' }

    expect(render(config).find('.dt-container__bar').exists()).toBe(false)
    expect(resolveContentInset(config, manifest).top).toBe(8)
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

describe('容器可配的观感', () => {
  function shellStyle(config: Record<string, unknown>): string {
    return render(config).get('.dt-container').attributes('style') ?? ''
  }

  it('空配置注入的观感变量就是容器现值', () => {
    const style = shellStyle({})

    expect(style).toContain('--dt-container-radius: 4px')
    expect(style).toContain('--dt-container-border-w: 0px')
    expect(style).toContain('--dt-container-dot-size: 1px')
    expect(style).toContain('--dt-container-dot-gap: 16px')
    expect(style).toContain('--dt-container-dot-opacity: 12%')
  })

  // ⚠ 只比外壳样式而不是整段 html：容器缺省开着标题条，而空配置一律按关着算，
  //   两者的**结构**本就不同（shared/container.ts），能比的是观感变量
  it('空配置与清单缺省摊出来的配置注入同一份观感变量', () => {
    const fromDefaults = shellStyle(configDefaults(manifest.configSchema))

    expect(fromDefaults).toBe(shellStyle({}))
  })

  it('圆角可配，脏值回落 4px', () => {
    expect(shellStyle({ radius: 12 })).toContain('--dt-container-radius: 12px')
    expect(shellStyle({ radius: '12' })).toContain('--dt-container-radius: 4px')
  })

  it('描边关着时线宽恒 0，粗细旋钮不生效', () => {
    expect(shellStyle({ borderWidth: 4 })).toContain(
      '--dt-container-border-w: 0px',
    )
    expect(shellStyle({ showBorder: false, borderWidth: 4 })).toContain(
      '--dt-container-border-w: 0px',
    )
  })

  it('开了描边才有线宽，缺省 1px', () => {
    expect(shellStyle({ showBorder: true })).toContain(
      '--dt-container-border-w: 1px',
    )
    expect(shellStyle({ showBorder: true, borderWidth: 2 })).toContain(
      '--dt-container-border-w: 2px',
    )
  })

  it('点阵的点径、点距、浓度三个旋钮各自落到变量上', () => {
    const style = shellStyle({ dotSize: 2, dotGap: 24, dotOpacity: 0.35 })

    expect(style).toContain('--dt-container-dot-size: 2px')
    expect(style).toContain('--dt-container-dot-gap: 24px')
    expect(style).toContain('--dt-container-dot-opacity: 35%')
  })

  it('点阵浓度按百分比注入，浮点尾数不外泄', () => {
    expect(shellStyle({ dotOpacity: 0.07 })).toContain(
      '--dt-container-dot-opacity: 7%',
    )
    expect(shellStyle({ dotOpacity: 0 })).toContain(
      '--dt-container-dot-opacity: 0%',
    )
  })

  it('点阵三项是脏值时逐项回落现值', () => {
    const style = shellStyle({
      dotSize: '2',
      dotGap: null,
      dotOpacity: Number.NaN,
    })

    expect(style).toContain('--dt-container-dot-size: 1px')
    expect(style).toContain('--dt-container-dot-gap: 16px')
    expect(style).toContain('--dt-container-dot-opacity: 12%')
  })
})
