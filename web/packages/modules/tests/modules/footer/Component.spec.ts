/**
 * @fileoverview 守页脚的渲染契约：子节点走默认插槽（插槽名写错既不报错也不渲染）、
 * 壳里没有标题条（存量配置里遗留的 showTitle 也不该长回来）、背景底图与顶边观感，
 * 以及「空配置」与「清单缺省摊出来的配置」渲染逐字相同。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import Component from '../../../src/modules/footer/Component.vue'
import footerManifest from '../../../src/modules/footer/manifest'
import { configDefaults } from '../../../src/shared/config'
import { resolveContentInset } from '../../../src/shared/container'

const CHILD = '<b class="child">版权子节点</b>'

function render(config: Record<string, unknown>) {
  return mount(Component, {
    props: { config, values: {} },
    slots: { default: CHILD },
  })
}

describe('页脚外壳', () => {
  it('子节点渲染在默认插槽里', () => {
    const wrapper = render({})

    expect(wrapper.get('.dt-footer__content .child').text()).toBe('版权子节点')
  })

  // 标题是拖进来的文字块子节点；壳再给一份就会与它抢位置
  it('壳里没有标题条，存量配置里遗留的开关也长不回来', () => {
    const wrapper = render({ showTitle: true, title: '运行状态' })

    expect(wrapper.find('.dt-footer__bar').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('运行状态')
  })

  it('遗留的标题条开关也不占内容区的位', () => {
    const config = { showTitle: true }

    expect(resolveContentInset(config, footerManifest).top).toBe(8)
  })

  it('空配置与清单缺省摊出来的配置渲染逐字相同', () => {
    const fromEmpty = render({}).html()
    const fromDefaults = render(configDefaults(footerManifest.configSchema))

    expect(fromDefaults.html()).toBe(fromEmpty)
  })
})

describe('页脚外观', () => {
  it('内边距落到内容区', () => {
    const wrapper = render({ __container: { pad: 20 } })

    expect(wrapper.get('.dt-footer__content').attributes('style')).toContain(
      'padding: 20px',
    )
  })

  it('缺内部布局时用缺省内边距', () => {
    const wrapper = render({})

    expect(wrapper.get('.dt-footer__content').attributes('style')).toContain(
      'padding: 8px',
    )
  })

  it('强调色写进外壳的自定义属性', () => {
    const wrapper = render({ accent: 'var(--state-warning)' })

    expect(wrapper.get('.dt-footer').attributes('style')).toContain(
      '--dt-footer-accent: var(--state-warning)',
    )
  })

  it('强调色留空时回落主色，而不是把变量注入成空值', () => {
    const wrapper = render({ accent: 42 })

    expect(wrapper.get('.dt-footer').attributes('style')).toContain(
      '--dt-footer-accent: var(--accent-primary)',
    )
  })

  it('背景色与背景底图都留空时，底色不注入、底图那一层也不出', () => {
    const wrapper = render({})

    expect(wrapper.get('.dt-footer').attributes('style')).not.toContain(
      'background-color',
    )
    expect(wrapper.find('.dt-footer__bg').exists()).toBe(false)
  })

  it('填了背景才写背景色', () => {
    const wrapper = render({ background: 'var(--surface-panel)' })

    expect(wrapper.get('.dt-footer').attributes('style')).toContain(
      'background-color: var(--surface-panel)',
    )
  })

  // 底图独立一层：整条 background 简写落在它身上，抹不掉外壳的底色
  it('只填了背景底图时不连带写死背景色', () => {
    const style =
      render({
        backgroundImage: 'linear-gradient(var(--accent-primary), transparent)',
      })
        .get('.dt-footer')
        .attributes('style') ?? ''

    expect(style).toContain('--dt-footer-bg: linear-gradient')
    expect(style).not.toContain('background-color')
  })

  it('图片地址包成铺满整条的横幅，CSS 简写则原样透传', () => {
    const url = render({ backgroundImage: '/a.png' })
      .get('.dt-footer')
      .attributes('style')
    const css = render({ backgroundImage: 'var(--fx-decor-topbg) center' })
      .get('.dt-footer')
      .attributes('style')

    expect(url).toContain('center bottom / 100% 100% no-repeat')
    expect(css).toContain('--dt-footer-bg: var(--fx-decor-topbg)')
    expect(css).not.toContain('url(')
  })

  it('缺省不铺点阵，开了才铺', () => {
    expect(render({}).get('.dt-footer__content').classes()).not.toContain(
      'dt-footer__content--dotted',
    )
    expect(
      render({ showDotGrid: true }).get('.dt-footer__content').classes(),
    ).toContain('dt-footer__content--dotted')
  })
})

describe('页脚可配的观感', () => {
  function shellStyle(config: Record<string, unknown>): string {
    return render(config).get('.dt-footer').attributes('style') ?? ''
  }

  it('空配置注入的观感变量就是页脚现值', () => {
    const style = shellStyle({})

    expect(style).toContain('--dt-footer-divider-w: 1px')
    expect(style).toContain('--dt-footer-sweep-opacity: 60%')
  })

  it('分隔线粗细可配，0 就是不画线', () => {
    expect(shellStyle({ dividerWidth: 3 })).toContain(
      '--dt-footer-divider-w: 3px',
    )
    expect(shellStyle({ dividerWidth: 0 })).toContain(
      '--dt-footer-divider-w: 0px',
    )
  })

  it('分隔线粗细是脏值时回落 1px', () => {
    expect(shellStyle({ dividerWidth: '3' })).toContain(
      '--dt-footer-divider-w: 1px',
    )
  })

  it('扫光浓度按百分比注入，浮点尾数不外泄', () => {
    expect(shellStyle({ sweepOpacity: 0.35 })).toContain(
      '--dt-footer-sweep-opacity: 35%',
    )
  })

  // 留 0 浓度的话伪元素仍在顶边压着一层，会吃掉贴顶那一排子节点的点击
  it('浓度归零时整条扫光伪元素退场', () => {
    expect(render({}).get('.dt-footer').classes()).not.toContain(
      'dt-footer--sweepless',
    )
    expect(render({ sweepOpacity: 0 }).get('.dt-footer').classes()).toContain(
      'dt-footer--sweepless',
    )
  })
})
